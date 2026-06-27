#requires -Version 5.1
<#
.SYNOPSIS
    Verify that the meeting-notes-tauri toolchain is installed and
    functional. Exits 0 if all components are OK, 1 otherwise.

.DESCRIPTION
    Checks:
      * Node >= 22.12.0 (per package.json engines)
      * .NET SDK 8.0.x (sidecar build target)
      * Rust (cargo) — any toolchain
      * MinGW-w64 gcc (w64devkit) — required for the GNU build target

    Searches the user profile (%USERPROFILE%\.cargo\bin,
    %USERPROFILE%\dotnet, %USERPROFILE%\w64devkit\w64devkit\bin) so
    the check works even when the system PATH doesn't include them.

    The script invokes each tool via cmd.exe (which handles the
    process startup reliably under PowerShell 5.1 where `& $cmd`
    can hang on certain short-output native binaries).

.EXAMPLE
    powershell -File scripts/check-toolchain.ps1
#>

$ErrorActionPreference = 'Continue'

# Extend PATH for this session so toolchain binaries are discoverable.
$toolchainPaths = @(
  (Join-Path $env:USERPROFILE '.cargo\bin'),
  (Join-Path $env:USERPROFILE 'dotnet'),
  (Join-Path $env:USERPROFILE 'w64devkit\w64devkit\bin')
) | Where-Object { Test-Path $_ }
if ($toolchainPaths.Count -gt 0) {
  $env:Path = ($toolchainPaths -join ';') + ';' + $env:Path
}
if (-not $env:DOTNET_ROOT) {
  $dotnetExe = Join-Path $env:USERPROFILE 'dotnet\dotnet.exe'
  if (Test-Path $dotnetExe) { $env:DOTNET_ROOT = Join-Path $env:USERPROFILE 'dotnet' }
}

$outFile = Join-Path $env:TEMP 'check-toolchain.out'
$errFile = Join-Path $env:TEMP 'check-toolchain.err'

$failures = @()

function Probe([string]$label, [string]$cmdLine, [string]$pattern) {
  Write-Host -NoNewline "  $label ... "
  Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue
  cmd /c "$cmdLine > `"$outFile`" 2> `"$errFile`""
  $output = ''
  if (Test-Path $outFile) { $output += (Get-Content $outFile -Raw) }
  if (Test-Path $errFile) { $output += "`n" + (Get-Content $errFile -Raw) }
  Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue

  if ($pattern -and $output -notmatch $pattern) {
    Write-Host "FAIL" -ForegroundColor Red
    $snippet = $output.Substring(0, [Math]::Min(120, $output.Length)).Trim()
    Write-Host "    Output: $snippet"
    Write-Host "    Pattern: $pattern"
    $script:failures += $label
  } else {
    $firstLine = ($output -split "`r?`n" | Select-Object -First 1).Trim()
    Write-Host "OK" -ForegroundColor Green
    if ($firstLine) { Write-Host "    $firstLine" -ForegroundColor DarkGray }
  }
}

Write-Host ''
Write-Host '== Toolchain-Check fuer meeting-notes-tauri ==' -ForegroundColor Cyan

Probe 'Node (>=22.12.0)' 'node --version' '^v(2[2-9]|[3-9]\d)\.'
Probe '.NET 8 SDK' 'dotnet --list-sdks' '8\.0\.'
Probe 'Rust (cargo)' 'cargo --version' '\d+\.\d+\.\d+'
Probe 'MinGW-w64 (gcc)' 'gcc --version' 'GCC'

Write-Host ''
if ($failures.Count -eq 0) {
  Write-Host "Alle Toolchain-Komponenten OK." -ForegroundColor Green
  exit 0
} else {
  Write-Host "Fehlende Komponenten: $($failures -join ', ')" -ForegroundColor Red
  Write-Host "Setup: powershell -File scripts/setup-toolchain.ps1" -ForegroundColor Yellow
  exit 1
}