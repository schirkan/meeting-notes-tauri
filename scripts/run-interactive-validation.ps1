param(
  [string]$Exe = 'C:\Users\Admin\.openclaw\workspace\projects\meeting-notes-tauri\sidecar\Validation\bin\Release\net10.0-windows\MeetingNotes.Sidecar.Validation.exe',
  [string]$Sidecar = 'C:\Users\Admin\.openclaw\workspace\projects\meeting-notes-tauri\dist\portable\MeetingNotes.Sidecar.exe',
  [string]$OutDir = 'C:\Users\Admin\.openclaw\workspace\temp\validation-run',
  [string]$LogPath = 'C:\Users\Admin\.openclaw\workspace\temp\validation-interactive.log',
  [int]$TimeoutSec = 300
)
$ErrorActionPreference = 'Continue'
$lines = New-Object System.Collections.ArrayList
function L($m) { [void]$script:lines.Add($m); $lines | Set-Content -Path $LogPath -Encoding UTF8 }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
$stdout = Join-Path $OutDir 'stdout.txt'
$stderr = Join-Path $OutDir 'stderr.txt'
Remove-Item $stdout, $stderr -ErrorAction SilentlyContinue
L ('session=' + (Get-Process -Id $PID).SessionId + ' interactive=' + [Environment]::UserInteractive)
L ('exe=' + $Exe)
try {
  $p = Start-Process -FilePath $Exe -ArgumentList @('--sidecar-exe', $Sidecar) -WorkingDirectory (Split-Path $Exe) -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
} catch {
  L ('start failed: ' + $_.Exception.Message)
  exit 3
}
L ('validation pid=' + $p.Id)
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while (-not $p.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
if (-not $p.HasExited) { L ('validation TIMEOUT after ' + $TimeoutSec + 's'); Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } else { L ('validation exit code: ' + $p.ExitCode) }
$text = ''
if (Test-Path $stdout) { $text += (Get-Content $stdout -Raw) }
if (Test-Path $stderr) { $text += (Get-Content $stderr -Raw) }
L '--- output ---'
L $text
