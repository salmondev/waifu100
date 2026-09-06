# Registers a daily local backup as a Windows scheduled task.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-backup-task.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-backup-task.ps1 -Remove
#
# This is the copy that survives losing the Vercel account itself - it pulls
# Redis *and* downloads every uploaded image, which the daily cron in the cloud
# deliberately does not (those images already live in Blob, so copying Blob to
# Blob would protect against nothing).
#
# Runs at 03:00, and again shortly after login if the machine was off - a backup
# that only happens when the PC is awake at 3am is not a backup.

param(
    [switch]$Remove,
    [string]$Time = "03:00",
    [int]$Keep = 7
)

$ErrorActionPreference = "Stop"
$taskName = "Waifu100 daily backup"
$projectDir = Split-Path -Parent $PSScriptRoot

if ($Remove) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed scheduled task '$taskName'." -ForegroundColor Green
    exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node is not on PATH" }

# Back up, then keep only the newest $Keep folders - 200 MB a day fills a disk
# faster than anyone expects to notice.
$command = @"
Set-Location -LiteralPath '$projectDir'
& '$node' scripts/backup.mjs --assets
Get-ChildItem -LiteralPath '$projectDir\backups' -Directory |
    Sort-Object Name -Descending |
    Select-Object -Skip $Keep |
    Remove-Item -Recurse -Force
"@

$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -EncodedCommand $encoded"

$triggers = @(
    (New-ScheduledTaskTrigger -Daily -At $Time),
    (New-ScheduledTaskTrigger -AtLogOn)
)
# Missed runs matter more than punctual ones here.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers `
    -Settings $settings -Description "Local copy of the Waifu100 Redis data and uploaded images." `
    -Force | Out-Null

Write-Host "Registered '$taskName'." -ForegroundColor Green
Write-Host "  runs   : daily at $Time, and at logon if a run was missed"
Write-Host "  keeps  : the newest $Keep backups in $projectDir\backups"
Write-Host "  run now: Start-ScheduledTask -TaskName '$taskName'"
Write-Host "  remove : powershell -ExecutionPolicy Bypass -File scripts\install-backup-task.ps1 -Remove"
