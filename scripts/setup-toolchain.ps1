#requires -Version 5.1
<#
.SYNOPSIS
    Installiert .NET 10 SDK und Rust stable fuer Windows x64/MSVC.
.DESCRIPTION
    Voraussetzung: Node gemaess package.json und Visual Studio/Build Tools
    mit Desktopentwicklung mit C++ sowie Windows SDK. Diese Komponenten
    werden nicht automatisch installiert. Kein MinGW, kein GCC-Patch.
    Rusts globale Standard-Toolchain und der persistente PATH bleiben gleich.
.EXAMPLE
    powershell -File scripts\setup-toolchain.ps1
#>
[CmdletBinding()]
param([switch]$SkipRust, [switch]$SkipDotnet)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not $SkipDotnet -or -not $SkipRust) {
    $installerDir = Join-Path ([IO.Path]::GetTempPath()) ('meeting-notes-toolchain-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $installerDir | Out-Null
    try {
        if (-not $SkipDotnet) {
            $installer = Join-Path $installerDir 'dotnet-install.ps1'
            Invoke-WebRequest -UseBasicParsing -Uri 'https://dot.net/v1/dotnet-install.ps1' -OutFile $installer
            & powershell -NoProfile -File $installer -Channel 10.0 -InstallDir (Join-Path $env:USERPROFILE 'dotnet') -NoPath
            if ($LASTEXITCODE -ne 0) { throw ".NET-Installation fehlgeschlagen: $LASTEXITCODE" }
        }
        if (-not $SkipRust) {
            $rustup = Join-Path $env:USERPROFILE '.cargo\bin\rustup.exe'
            if (-not (Test-Path $rustup)) {
                $installer = Join-Path $installerDir 'rustup-init.exe'
                Invoke-WebRequest -UseBasicParsing -Uri 'https://win.rustup.rs/x86_64' -OutFile $installer
                & $installer -y --default-host x86_64-pc-windows-msvc --default-toolchain none --no-modify-path
                if ($LASTEXITCODE -ne 0) { throw "rustup-Installation fehlgeschlagen: $LASTEXITCODE" }
            }
            & $rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal
            if ($LASTEXITCODE -ne 0) { throw "Rust-Installation fehlgeschlagen: $LASTEXITCODE" }
        }
    } finally {
        Remove-Item -LiteralPath $installerDir -Recurse -Force
    }
}

& powershell -NoProfile -File (Join-Path $PSScriptRoot 'check-toolchain.ps1')
exit $LASTEXITCODE
