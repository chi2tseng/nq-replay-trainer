# Register the daily PATs + Thomas Wade review-list refresh as a Windows scheduled task.
# Runs scripts\run_daily_reviews.vbs (hidden) every day at 09:00 local; catches up if the machine was off (StartWhenAvailable).
# 09:00 keeps clear of the ImportNTTicks task (07:30 + 4 h slots). Re-run this script to (re)create the task.
$vbs = Join-Path $PSScriptRoot "run_daily_reviews.vbs"
$action   = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`""
$trigger  = New-ScheduledTaskTrigger -Daily -At 9:00am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName "ReplayTrainer-ReviewsDaily" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Daily update of the replay trainer's PATs and Thomas Wade review lists (pats_reviews.json / wade_reviews.json). Local only, no git." -Force
Write-Output "Registered ReplayTrainer-ReviewsDaily (daily 09:00). Run now with: Start-ScheduledTask -TaskName ReplayTrainer-ReviewsDaily"
