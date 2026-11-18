param(
  [string]$Script = '',
  [string]$ScriptArgs = '',
  [string]$LogPath = '',
  [string]$TaskName = 'openclaw-native-capture',
  [int]$TimeoutSec = 420
)
$ErrorActionPreference = 'Stop'

# Bridge into the interactive Windows session.
#
# The OpenClaw gateway runs in session 0 and therefore cannot reach the window
# station or the desktop of the logged-on user. A scheduled task created with
# LogonType=Interactive is executed inside that user session instead, which gives
# the script a real desktop, a real Explorer taskbar and real windows.

$here = Split-Path $PSCommandPath -Parent
if (-not $Script) { $Script = Join-Path $here 'capture-native-screenshots.ps1' }
if (-not [System.IO.Path]::IsPathRooted($Script)) { $Script = Join-Path $here (Split-Path $Script -Leaf) }
if (-not $LogPath) {
  $workspace = Split-Path (Split-Path (Split-Path $here -Parent) -Parent) -Parent
  $LogPath = Join-Path $workspace 'temp\native-capture.log'
}
Write-Output ('script: ' + $Script)
Write-Output ('log:    ' + $LogPath)

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
Remove-Item $LogPath -ErrorAction SilentlyContinue

$argument = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $Script + '"'
if ($ScriptArgs) { $argument += ' ' + $ScriptArgs }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument
$principal = New-ScheduledTaskPrincipal -UserId 'OPENCLAWPC\Admin' -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Write-Output 'task registered'
Start-ScheduledTask -TaskName $TaskName

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  if (Test-Path $LogPath) { break }
  Start-Sleep -Milliseconds 500
}
Start-Sleep -Seconds 1
Write-Output '--- log ---'
if (Test-Path $LogPath) { Get-Content $LogPath | Out-String } else { Write-Output 'NO LOG FILE' }
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Output 'task removed'
