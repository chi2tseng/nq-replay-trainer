# Register the FREE daily Yahoo data update as a Windows scheduled task.
# Runs scripts\run_yahoo_update.vbs (hidden) every day at 08:00 local; catches up if the
# machine was off (StartWhenAvailable). Re-run this script to (re)create the task.
$vbs = Join-Path $PSScriptRoot "run_yahoo_update.vbs"
$action   = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`""
$trigger  = New-ScheduledTaskTrigger -Daily -At 8:00am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
Register-ScheduledTask -TaskName "ReplayTrainer-YahooDaily" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Free daily NQ/ES 1m + 5m data update from Yahoo Finance for the replay trainer (no API cost)." -Force
Write-Output "Registered ReplayTrainer-YahooDaily (daily 08:00). Run now with: Start-ScheduledTask -TaskName ReplayTrainer-YahooDaily"
