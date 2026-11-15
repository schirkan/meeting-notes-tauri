#requires -Version 5.1
<#
.SYNOPSIS
    Prueft Node gemaess package.json, .NET 10, Rust-MSVC und C++-Buildtools.
.EXAMPLE
    powershell -File scripts\check-toolchain.ps1
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'run-with-toolchain.ps1')
$root = Split-Path $PSScriptRoot -Parent
$failures = @()

function Probe([string]$label, [string]$executable, [string[]]$arguments, [string]$pattern) {
    $tool = Get-Command $executable -ErrorAction SilentlyContinue
    if (-not $tool) {
        Write-Host "FEHLER: $label - $executable nicht gefunden."
        $script:failures += $label
        return
    }
    $output = & $tool.Source @arguments
    $code = $LASTEXITCODE
    $text = $output -join "`n"
    if ($code -ne 0 -or ($pattern -and $text -notmatch $pattern)) {
        Write-Host "FEHLER: $label (Exit $code)`n$text"
        $script:failures += $label
    } else {
        Write-Host "OK: $label`n$text"
    }
}

$nodeCheck = @'
const fs = require('node:fs');
const range = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).engines.node;
const bounds = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)$/.exec(range);
if (!bounds) throw new Error('Nicht unterstuetztes engines.node-Format: ' + range);
const current = process.versions.node.split('.').map(Number);
const minimum = bounds.slice(1, 4).map(Number);
const comparison = current.map((n, i) => n - minimum[i]).find(n => n !== 0) || 0;
console.log('Node ' + process.versions.node + ' (erlaubt: ' + range + ')');
if (comparison < 0 || current[0] >= Number(bounds[4])) process.exit(1);
'@
Probe 'Node' 'node' @('-e', $nodeCheck, (Join-Path $root 'package.json')) ''
Probe '.NET 10 SDK' 'dotnet' @('--list-sdks') '(?m)^10\.0\.'
Probe '.NET 10 Runtime' 'dotnet' @('--list-runtimes') '(?m)^Microsoft.NETCore.App 10\.0\.'
Probe 'Cargo' 'cargo' @('--version') '^cargo \d+\.'
Probe 'Rust-MSVC x64' 'rustc' @('-vV') '(?m)^host: x86_64-pc-windows-msvc$'

$manifest = Get-Content (Join-Path $root 'src-tauri\Cargo.toml') -Raw
$minimumRust = [regex]::Match($manifest, '(?m)^rust-version\s*=\s*"([^"]+)"').Groups[1].Value
$rustc = Get-Command rustc -ErrorAction SilentlyContinue
if ($rustc) {
    $versionText = & $rustc.Source --version
    $version = [regex]::Match(($versionText -join ''), '^rustc (\d+\.\d+\.\d+)').Groups[1].Value
    if (-not $version -or -not $minimumRust -or [version]$version -lt [version]$minimumRust) {
        Write-Host "FEHLER: Rust-Version; benoetigt mindestens $minimumRust."
        $failures += 'Rust-Mindestversion'
    }
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$visualStudio = if (Test-Path $vswhere) {
    & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
}
$linkers = if ($visualStudio) {
    Get-ChildItem (Join-Path ($visualStudio | Select-Object -First 1) 'VC\Tools\MSVC') -Directory |
        Where-Object { Test-Path (Join-Path $_.FullName 'bin\Hostx64\x64\link.exe') }
}
$sdkInclude = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\Include'
$windowsSdks = if (Test-Path $sdkInclude) {
    Get-ChildItem $sdkInclude -Directory |
        Where-Object { (Test-Path (Join-Path $_.FullName 'um\Windows.h')) -and (Test-Path (Join-Path $_.FullName 'ucrt\stdio.h')) }
}
if (-not $linkers -or -not $windowsSdks) {
    Write-Host 'FEHLER: Visual Studio C++-Buildtools und Windows SDK erforderlich (Desktopentwicklung mit C++).'
    $failures += 'MSVC/Windows SDK'
} else {
    Write-Host 'OK: Visual Studio C++-Buildtools und Windows SDK vorhanden.'
}

if ($failures.Count -gt 0) {
    Write-Host "Toolchain unvollstaendig: $($failures -join ', ')"
    exit 1
}
Write-Host 'Alle Toolchain-Pruefungen erfolgreich.'
exit 0
