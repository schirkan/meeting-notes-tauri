#requires -Version 5.1
<#
.SYNOPSIS
    Install the full Rust + .NET + MinGW toolchain required for
    `npm run tauri build` and `npm run dist:portable` on a fresh
    Windows machine.

.DESCRIPTION
    This script:
      1. Installs .NET 8 SDK + Runtime to %USERPROFILE%\dotnet
      2. Installs Rust stable-x86_64-pc-windows-gnu via rustup-init
      3. Extracts w64devkit-x64 (MinGW-w64) to %USERPROFILE%\w64devkit
      4. Patches w64devkit's libgcc_eh.a stub so Rust 1.96 prebuilt
         rlibs can link (GCC 14+ removed libgcc_eh; Rust still passes -lgcc_eh)

    All components are installed into the user profile (no admin
    required, no system-wide mutation). Use scripts/run-with-toolchain.ps1
    to set the right PATH + DOTNET_ROOT for subsequent commands.

.PARAMETER SkipRust
.PARAMETER SkipDotnet
.PARAMETER SkipMingw
    Skip individual components if they are already installed.

.EXAMPLE
    pwsh scripts/setup-toolchain.ps1

.NOTES
    Requires ~1 GB free disk space for toolchains + ~10 MB for installers.
#>

[CmdletBinding()]
param(
  [switch]$SkipRust,
  [switch]$SkipDotnet,
  [switch]$SkipMingw
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Section([string]$msg) {
  Write-Host ""
  Write-Host "== $msg ==" -ForegroundColor Cyan
}

$installerDir = Join-Path $env:TEMP 'meeting-notes-tauri-installers'
New-Item -ItemType Directory -Path $installerDir -Force | Out-Null

# --- .NET 8 SDK + Runtime --------------------------------------------------

if (-not $SkipDotnet) {
  Write-Section '.NET 8 SDK + Runtime'
  $dotnetInstall = Join-Path $installerDir 'dotnet-install.ps1'
  if (-not (Test-Path $dotnetInstall)) {
    Invoke-WebRequest -UseBasicParsing `
      -Uri 'https://dot.net/v1/dotnet-install.ps1' `
      -OutFile $dotnetInstall
  }

  $dotnetRoot = Join-Path $env:USERPROFILE 'dotnet'
  New-Item -ItemType Directory -Path $dotnetRoot -Force | Out-Null

  Write-Host 'Installing .NET 8 SDK...'
  & $dotnetInstall -Channel 8.0 -InstallDir $dotnetRoot -NoPath | Out-Host
  Write-Host 'Installing .NET 8 Runtime...'
  & $dotnetInstall -Channel 8.0 -Runtime dotnet -InstallDir $dotnetRoot -NoPath | Out-Host

  & (Join-Path $dotnetRoot 'dotnet.exe') --list-sdks | Out-Host
  & (Join-Path $dotnetRoot 'dotnet.exe') --list-runtimes | Out-Host
}

# --- Rust stable + GNU target ---------------------------------------------

if (-not $SkipRust) {
  Write-Section 'Rust stable (GNU target)'
  $rustupInit = Join-Path $installerDir 'rustup-init.exe'
  if (-not (Test-Path $rustupInit)) {
    Invoke-WebRequest -UseBasicParsing `
      -Uri 'https://win.rustup.rs/x86_64' `
      -OutFile $rustupInit
  }

  Write-Host 'Installing rustup + stable-x86_64-pc-windows-msvc...'
  & $rustupInit -y --default-toolchain stable --default-host x86_64-pc-windows-msvc --no-modify-path | Out-Host

  Write-Host 'Installing stable-x86_64-pc-windows-gnu (minimal profile)...'
  & (Join-Path $env:USERPROFILE '.cargo\bin\rustup.exe') toolchain install stable-x86_64-pc-windows-gnu --profile minimal | Out-Host
  & (Join-Path $env:USERPROFILE '.cargo\bin\rustup.exe') default stable-x86_64-pc-windows-gnu | Out-Host
}

# --- MinGW-w64 (w64devkit) ------------------------------------------------

if (-not $SkipMingw) {
  Write-Section 'w64devkit-x64 (MinGW-w64)'
  $w64Exe = Join-Path $installerDir 'w64devkit-x64-2.8.0.7z.exe'
  if (-not (Test-Path $w64Exe)) {
    Invoke-WebRequest -UseBasicParsing `
      -Uri 'https://github.com/skeeto/w64devkit/releases/download/v2.8.0/w64devkit-x64-2.8.0.7z.exe' `
      -OutFile $w64Exe
  }

  $w64Parent = Join-Path $env:USERPROFILE 'w64devkit'
  if (-not (Test-Path (Join-Path $w64Parent 'w64devkit\bin\gcc.exe'))) {
    Write-Host "Extracting $w64Exe -> $w64Parent"
    New-Item -ItemType Directory -Path $w64Parent -Force | Out-Null
    $proc = Start-Process -FilePath $w64Exe -ArgumentList "-y", "-o`"$w64Parent`"" -Wait -PassThru -NoNewWindow
    if ($proc.ExitCode -ne 0) { throw "w64devkit extraction failed (exit=$($proc.ExitCode))" }
  } else {
    Write-Host 'w64devkit already extracted.'
  }

  # Patch libgcc_eh.a stub for Rust 1.96 GNU target compatibility.
  & (Join-Path $PSScriptRoot 'patch-w64devkit-gcc-eh.ps1') | Out-Host
}

Write-Section 'Done'
Write-Host "Toolchain installiert."
Write-Host ""
Write-Host "Naechste Schritte:"
Write-Host "  pwsh scripts/run-with-toolchain.ps1 npm install"
Write-Host "  pwsh scripts/run-with-toolchain.ps1 npm run tauri build"
Write-Host "  pwsh scripts/run-with-toolchain.ps1 npm run dist:portable"