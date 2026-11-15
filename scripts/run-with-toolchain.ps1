#requires -Version 5.1
<#
.SYNOPSIS
    Fuehrt einen Befehl mit .NET 10 und Rust-MSVC aus.
.DESCRIPTION
    Bevorzugt ein passendes dotnet im bestehenden PATH, danach die System-
    und Benutzerinstallation. Aendert nur die Prozessumgebung, nicht den
    persistenten PATH oder die globale Rust-Toolchain.
    Dot-Sourcing ohne Befehl initialisiert nur die Umgebung fuer den Checker.
.EXAMPLE
    powershell -File scripts\run-with-toolchain.ps1 npm run tauri -- build --no-bundle
#>
$executable = if ($args.Count -gt 0) { $args[0] }
$commandArguments = @($args | Select-Object -Skip 1)

$ErrorActionPreference = 'Stop'
$cargo = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path $cargo) { $env:Path = "$cargo;$env:Path" }

$existingDotnet = Get-Command dotnet -ErrorAction SilentlyContinue
$candidates = @(
    if ($existingDotnet) { $existingDotnet.Source }
    Join-Path $env:ProgramFiles 'dotnet\dotnet.exe'
    Join-Path $env:USERPROFILE 'dotnet\dotnet.exe'
) | Select-Object -Unique

$dotnetRoot = $null
foreach ($candidate in $candidates) {
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    $sdks = & $candidate --list-sdks
    if ($LASTEXITCODE -eq 0 -and ($sdks -match '^10\.0\.')) {
        $dotnetRoot = Split-Path $candidate -Parent
        break
    }
}
if (-not $dotnetRoot) { throw '.NET 10 SDK fehlt. Bitte setup-toolchain.ps1 ausfuehren.' }

$env:Path = "$dotnetRoot;$env:Path"
$env:DOTNET_ROOT = $dotnetRoot
$env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-msvc'

if (-not $executable) {
    if ($MyInvocation.InvocationName -eq '.') { return }
    throw 'Aufruf: run-with-toolchain.ps1 <Befehl> [Argumente...]'
}

& $executable @commandArguments
exit $LASTEXITCODE
