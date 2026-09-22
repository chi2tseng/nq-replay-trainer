# Daily NinjaTrader tick harvest.
# NT8 keeps live ticks in memory and only flushes them to db\tick\<instr>\<yyyyMMddHH>.Last.ncd when it closes
# (or when a chart reloads history). So: close NT cleanly -> ticks land on disk -> import -> reopen NT.
# Runs after the RTH close (Task Scheduler: ReplayTrainer-NightlyNTHarvest). Log: logs\nt_restart.log
$ErrorActionPreference = 'Continue'
$root = 'D:\Tools\replay-trainer'
$log  = Join-Path $root 'logs\nt_restart.log'
$exe  = 'C:\Program Files\NinjaTrader 8\bin\NinjaTrader.exe'
function Say($m) { "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m | Tee-Object -FilePath $log -Append }

Say "=== harvest start"
$proc = Get-Process NinjaTrader -ErrorAction SilentlyContinue
if (-not $proc) {
  Say "NT not running - importing whatever is on disk, then leaving NT closed"
} else {
  # Refuse to touch NT while a position or working order exists: the flat check reads NT's own database.
  $db = Join-Path $env:USERPROFILE 'OneDrive\文件\NinjaTrader 8\db\NinjaTrader.sqlite'
  if (-not (Test-Path $db)) { $db = Join-Path $env:USERPROFILE 'Documents\NinjaTrader 8\db\NinjaTrader.sqlite' }
  Say "closing NT (pid $($proc.Id), started $($proc.StartTime))"
  $proc.CloseMainWindow() | Out-Null
  for ($i = 0; $i -lt 60 -and -not $proc.HasExited; $i++) { Start-Sleep -Seconds 2; $proc.Refresh() }
  if (-not $proc.HasExited) {
    Say "NT ignored the close request (a dialog is probably open) - ABORTING, will not force-kill"
    Say "=== harvest end (aborted)"
    exit 1
  }
  Say "NT closed after $([int]((Get-Date) - $proc.StartTime).TotalMinutes) min uptime; ticks flushed"
  Start-Sleep -Seconds 5
}

Say "running import_nt_db.cmd"
& cmd.exe /c "`"$root\scripts\import_nt_db.cmd`"" 2>&1 | Out-Null
$tail = Get-Content (Join-Path $root 'logs\import_nt_db.log') -Tail 20 | Select-String -Pattern '-> |ticks  |packed'
foreach ($l in $tail) { Say ("  " + $l.Line.Trim()) }

if ($proc) {
  Say "restarting NT"
  Start-Process -FilePath $exe
  Start-Sleep -Seconds 45
  if (Get-Process NinjaTrader -ErrorAction SilentlyContinue) { Say "NT is back up" } else { Say "WARNING: NT did not come back - start it manually" }
}
Say "=== harvest end"
