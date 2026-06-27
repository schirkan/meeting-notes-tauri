#requires -Version 5.1
<#
.SYNOPSIS
    Run a command with the meeting-notes-tauri toolchain on PATH.

.DESCRIPTION
    Sets PATH to include cargo, .NET 8, and w64devkit (GCC/ld) and
    exports DOTNET_ROOT so the .NET runtime is discovered. Useful as
    a wrapper for npm/npx/cargo when the toolchain isn't on the
    system PATH yet.

.EXAMPLE
    pwsh scripts/run-with-toolchain.ps1 npm install
    pwsh scripts/run-with-toolchain.ps1 npm run tauri build
    pwsh scripts/run-with-toolchain.ps1 npm run dist:portable

.NOTES
    Does NOT modify the global PATH or DOTNET_ROOT — only the
    current process. After exiting, the system PATH is unchanged.
#>

[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments=$true)]
  [string[]]$Command
)

if ($Command.Count -eq 0) {
  Write-Error 'Usage: run-with-toolchain.ps1 <command> [args...]'
  exit 1
}

$w64 = Join-Path $env:USERPROFILE 'w64devkit\w64devkit'
$dotnet = Join-Path $env:USERPROFILE 'dotnet'
$cargo = Join-Path $env:USERPROFILE '.cargo\bin'

$env:Path = "$cargo;$dotnet;$w64\bin;$env:Path"
$env:DOTNET_ROOT = $dotnet

& $Command[0] @($Command | Select-Object -Skip 1)
exit $LASTEXITCODE