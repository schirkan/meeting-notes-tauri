#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Prueft eine Portable-Distribution auf einem fremden Rechner.

.DESCRIPTION
    Umsetzt die Checkliste aus specs/T-510-clean-machine-deployment-windows-11.md
    als ausfuehrbaren Nachweis. Das Skript ist selbststaendig: es braucht weder
    Node noch Rust noch das Repository - nur den Portable-Ordner.

    Auf dem Zielsystem wird der Ordner komplett kopiert und dieses Skript
    daneben (oder mit -PortableDir darauf) ausgefuehrt:

        powershell -ExecutionPolicy Bypass -File .\verify-deployment.ps1

    Ausgabe: eine Zeile je Pruefung mit Status (PASS/FAIL/INFO/MANUELL) und
    Begründung. Exit-Code 0 = keine FAIL-Pruefung, 1 = mindestens eine FAIL.

.PARAMETER PortableDir
    Pfad zum Portable-Ordner (Standard: neben diesem Skript).

.PARAMETER LaunchApp
    Startet zusaetzlich die App und prueft, ob sie am Leben bleibt.
    Auf einem Clean-Machine-Test sinnvoll; laesst ein Fenster aufgehen.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\verify-deployment.ps1 -PortableDir D:\Apps\MeetingNotes
#>
[CmdletBinding()]
param(
    [string]$PortableDir = $PSScriptRoot,
    [switch]$LaunchApp
)

$ErrorActionPreference = 'Continue'
$results = New-Object System.Collections.ArrayList

function Add-Result {
    param([string]$Status, [string]$Check, [string]$Detail)
    [void]$results.Add([PSCustomObject]@{ Status = $Status; Check = $Check; Detail = $Detail })
}

function Get-PeSubsystem {
    # PE-Subsystem: 2 = Windows GUI, 3 = Konsole. Damit laesst sich pruefen,
    # ob die Haupt-EXE kein Konsolenfenster oeffnet.
    param([string]$Path)
    try {
        $bytes = [System.IO.File]::ReadAllBytes($Path)
        $peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
        if ($bytes[$peOffset] -ne 0x50 -or $bytes[$peOffset + 1] -ne 0x45) { return $null }
        return [BitConverter]::ToUInt16($bytes, $peOffset + 24 + 68)
    } catch { return $null }
}

Write-Host ''
Write-Host '=== Meeting Notes — Deployment-Pruefung ===' -ForegroundColor Cyan
Write-Host ("Zielordner: {0}" -f (Resolve-Path $PortableDir -ErrorAction SilentlyContinue))
Write-Host ''

# --- 1. System ---------------------------------------------------------------
$os = Get-CimInstance Win32_OperatingSystem
$caption = $os.Caption
$build = $os.BuildNumber
$arch = $env:PROCESSOR_ARCHITECTURE
Add-Result 'INFO' 'System' ("{0} (Build {1}), {2}" -f $caption, $build, $arch)

$isWin11 = ($caption -match 'Windows 11') -or ([int]$build -ge 22000)
Add-Result $(if ($isWin11) { 'PASS' } else { 'INFO' }) 'Windows 11 x64' ("Build {0}, {1}" -f $build, $arch)

# --- 2. Entwickler-Werkzeuge (nur Info: Clean-Machine ist das Ideal) -------
$tools = @()
foreach ($t in @(@('dotnet SDK', 'dotnet'), @('node', 'node'), @('cargo', 'cargo'))) {
    $cmd = Get-Command $t[1] -ErrorAction SilentlyContinue
    if ($cmd) { $tools += $t[0] }
}
if ($tools.Count -eq 0) {
    Add-Result 'PASS' 'Keine Entwickler-Toolchain' 'Weder dotnet, noch node, noch cargo im PATH — entspricht dem Clean-Machine-Ziel.'
} else {
    Add-Result 'INFO' 'Entwickler-Toolchain vorhanden' ("Im PATH gefunden: {0}. Für den Clean-Machine-Nachweis idealerweise nicht vorhanden." -f ($tools -join ', '))
}

# --- 3. WebView2 Runtime -----------------------------------------------------
$webView2Key = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$webView2Version = $null
foreach ($base in @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients', 'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients', 'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients')) {
    try {
        $item = Get-ItemProperty -Path (Join-Path $base $webView2Key) -ErrorAction Stop
        if ($item.pv) { $webView2Version = $item.pv; break }
    } catch { }
}
if ($webView2Version) {
    Add-Result 'PASS' 'WebView2 Runtime' ("Version {0}" -f $webView2Version)
} else {
    Add-Result 'FAIL' 'WebView2 Runtime' 'Nicht im Registry gefunden — die App startet ohne WebView2 nicht.'
}

# --- 4. .NET-Runtime ---------------------------------------------------------
# Runtime-Erkennung an drei Quellen: Registry, Shared-Framework-Verzeichnis
# und 'dotnet --list-runtimes'. Script-basiert installierte Runtimes
# (dotnet-install.ps1) schreiben keinen Registry-Schlüssel - ohne das
# Dateisystem wuerde ein vorhandenes Runtime faelschlich als fehlend gelten.
$netCoreVersions = @()
$desktopVersions = @()
foreach ($base in @('HKLM:\SOFTWARE\dotnet\Shared\Microsoft.NETCore.App', 'HKCU:\SOFTWARE\dotnet\Shared\Microsoft.NETCore.App')) {
    if (Test-Path $base) {
        $netCoreVersions += (Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
    }
}
foreach ($root in @("$env:ProgramFiles\dotnet\shared\Microsoft.NETCore.App", "${env:ProgramFiles(x86)}\dotnet\shared\Microsoft.NETCore.App")) {
    if ($root -and (Test-Path $root)) {
        $netCoreVersions += (Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
    }
}
if ($netCoreVersions.Count -eq 0 -and (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    $netCoreVersions += (& dotnet --list-runtimes 2>$null |
        Select-String '^Microsoft\.NETCore\.App\s+(\S+)' |
        ForEach-Object { $_.Matches[0].Groups[1].Value })
}
$netCoreVersions = @($netCoreVersions | Sort-Object -Unique)
foreach ($base in @('HKLM:\SOFTWARE\dotnet\Shared\Microsoft.WindowsDesktop.App')) {
    if (Test-Path $base) {
        $desktopVersions += (Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
    }
}

$sidecarExe = Join-Path $PortableDir 'sidecar\MeetingNotes.Sidecar.exe'
$runtimeConfig = Join-Path $PortableDir 'sidecar\MeetingNotes.Sidecar.runtimeconfig.json'
$requiredMajor = $null
if (Test-Path $runtimeConfig) {
    try {
        $rc = Get-Content $runtimeConfig -Raw | ConvertFrom-Json
        $requiredMajor = [int](($rc.framework.version -split '\.')[0])
    } catch { }
}
if (-not $requiredMajor) { $requiredMajor = 10 }

$installed = @($netCoreVersions | Where-Object { $_ -match '^(\d+)\.' } | ForEach-Object { [int]($_ -split '\.')[0] } | Sort-Object -Descending)
$hasRuntime = ($installed | Where-Object { $_ -ge $requiredMajor }).Count -gt 0
if ($hasRuntime) {
    Add-Result 'PASS' ('.NET ' + $requiredMajor + ' Runtime') ("Installiert: {0}" -f (($netCoreVersions | Sort-Object -Descending) -join ', '))
} else {
    Add-Result 'FAIL' ('.NET ' + $requiredMajor + ' Runtime') ("Nicht installiert. Gefunden: {0}. Der Sidecar ist framework-dependent und startet ohne Runtime nicht." -f ($(if ($netCoreVersions) { $netCoreVersions -join ', ' } else { 'keine' })))
}
Add-Result 'INFO' '.NET WindowsDesktop.App' ($(if ($desktopVersions) { ($desktopVersions -join ', ') } else { 'nicht vorhanden (fuer den Sidecar nicht noetig)' }))

# --- 5. Integritaet: SHA256SUMS --------------------------------------------
$sumsFile = Join-Path $PortableDir 'SHA256SUMS'
if (-not (Test-Path $sumsFile)) {
    Add-Result 'FAIL' 'SHA256SUMS' 'Datei fehlt — Integritaet der Distribution nicht nachweisbar.'
} else {
    $lines = Get-Content $sumsFile | Where-Object { $_.Trim() -ne '' }
    $bad = New-Object System.Collections.ArrayList
    foreach ($line in $lines) {
        if ($line -match '^([0-9a-fA-F]{64})\s+(.+)$') {
            $expected = $Matches[1].ToLower()
            $rel = $Matches[2].Trim() -replace '/', '\'
            $file = Join-Path $PortableDir $rel
            if (-not (Test-Path $file)) {
                [void]$bad.Add("$rel (fehlt)")
                continue
            }
            $actual = (Get-FileHash -Algorithm SHA256 -Path $file).Hash.ToLower()
            if ($actual -ne $expected) { [void]$bad.Add("$rel (Hash weicht ab)") }
        }
    }
    if ($bad.Count -eq 0) {
        Add-Result 'PASS' 'SHA256SUMS' ("{0}/{0} Dateien verifiziert." -f $lines.Count)
    } else {
        Add-Result 'FAIL' 'SHA256SUMS' ("{0} von {1} Dateien abweichend: {2}" -f $bad.Count, $lines.Count, ($bad -join '; '))
    }
}

# --- 6. Hygiene: keine persoenlichen Daten im Ordner -----------------------
$personalConfig = Join-Path $PortableDir 'meeting-notes.config.json'
if (Test-Path $personalConfig) {
    Add-Result 'FAIL' 'Keine persoenliche Config' 'meeting-notes.config.json liegt im Ordner — nicht verteilen (enthaelt ggf. Credentials).'
} else {
    Add-Result 'PASS' 'Keine persoenliche Config' 'meeting-notes.config.json ist nicht enthalten.'
}

$example = Join-Path $PortableDir 'meeting-notes.config.example.json'
if (Test-Path $example) {
    $raw = Get-Content $example -Raw
    # Der Platzhalter ist ein <...>-Marker; zusaetzlich gilt ein leerer Wert
    # als unauffaellig. Ein konkreter Wert waere ein Credential-Leak.
    $placeholder = $raw -match '"speechKey"\s*:\s*"(<[^>]*>|\s*)"'
    if ($placeholder) {
        Add-Result 'PASS' 'Config-Template ohne Credentials' 'speechKey ist ein Platzhalter.'
    } else {
        Add-Result 'FAIL' 'Config-Template ohne Credentials' 'speechKey enthaelt einen konkreten Wert — nicht verteilen.'
    }
} else {
    Add-Result 'INFO' 'Config-Template' 'meeting-notes.config.example.json fehlt im Ordner.'
}

# --- 7. Sidecar: device_list ------------------------------------------------
if (-not (Test-Path $sidecarExe)) {
    Add-Result 'FAIL' 'Sidecar-EXE' ("{0} fehlt — der Ordner muss vollstaendig kopiert werden." -f 'sidecar\MeetingNotes.Sidecar.exe')
} else {
    $subsystem = Get-PeSubsystem $sidecarExe
    Add-Result 'PASS' 'Sidecar-EXE' ("{0:N2} MB, Subsystem {1} (3 = Konsole, erwartet)." -f ((Get-Item $sidecarExe).Length / 1MB), $subsystem)
    try {
        $out = & $sidecarExe --list-devices 2>&1 | Out-String
        $first = ($out -split '\r?\n' | Where-Object { $_.Trim() -ne '' } | Select-Object -First 1)
        try {
            $json = $first | ConvertFrom-Json
            if ($json.type -eq 'device_list') {
                $inCount = @($json.payload.Inputs).Count
                $outCount = @($json.payload.Outputs).Count
                Add-Result 'PASS' 'Sidecar --list-devices' ("device_list empfangen — {0} Eingänge, {1} Ausgänge." -f $inCount, $outCount)
            } else {
                Add-Result 'FAIL' 'Sidecar --list-devices' ("Unerwartetes Event: {0}" -f $json.type)
            }
        } catch {
            Add-Result 'FAIL' 'Sidecar --list-devices' ("Kein gueltiges JSON-Lines-Event: {0}" -f $first)
        }
    } catch {
        Add-Result 'FAIL' 'Sidecar --list-devices' ("Start fehlgeschlagen: {0}" -f $_.Exception.Message)
    }
}

# --- 8. Haupt-EXE: kein Konsolenfenster ------------------------------------
$appExe = Join-Path $PortableDir 'meeting-notes.exe'
if (-not (Test-Path $appExe)) {
    Add-Result 'FAIL' 'Haupt-EXE' 'meeting-notes.exe fehlt.'
} else {
    $subsystem = Get-PeSubsystem $appExe
    if ($subsystem -eq 2) {
        Add-Result 'PASS' 'Haupt-EXE ohne Konsolenfenster' 'PE-Subsystem 2 (Windows GUI).'
    } elseif ($subsystem -eq 3) {
        Add-Result 'FAIL' 'Haupt-EXE ohne Konsolenfenster' 'PE-Subsystem 3 (Konsole) — beim Start erscheint ein Konsolenfenster.'
    } else {
        Add-Result 'INFO' 'Haupt-EXE' ("PE-Subsystem {0}" -f $subsystem)
    }
}

if ($LaunchApp) {
    if (Test-Path $appExe) {
        try {
            $proc = Start-Process -FilePath $appExe -PassThru
            Start-Sleep -Seconds 6
            if ($proc.HasExited) {
                Add-Result 'FAIL' 'App laeuft' ("Beendet sich sofort (Exit-Code {0})." -f $proc.ExitCode)
            } else {
                Add-Result 'PASS' 'App laeuft' 'Prozess laeuft nach 6 s. Fenster bitte per Hand pruefen.'
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            }
        } catch {
            Add-Result 'FAIL' 'App laeuft' ("Start fehlgeschlagen: {0}" -f $_.Exception.Message)
        }
    }
} else {
    Add-Result 'MANUELL' 'App-Start und Settings-Dialog' 'Mit -LaunchApp zusaetzlich pruefen: Fenster oeffnet, Einstellungen automatisch (ohne Azure-Config), Config-Datei entsteht direkt neben der EXE.'
}

# --- Bericht ----------------------------------------------------------------
Write-Host ''
$results | Format-Table -AutoSize -Wrap Status, Check, Detail
$failCount = @($results | Where-Object { $_.Status -eq 'FAIL' }).Count
$passCount = @($results | Where-Object { $_.Status -eq 'PASS' }).Count
Write-Host ''
Write-Host ("PASS: {0} | FAIL: {1} | INFO/MANUELL: {2}" -f $passCount, $failCount, (@($results | Where-Object { $_.Status -in @('INFO', 'MANUELL') }).Count))
if ($failCount -gt 0) {
    Write-Host 'Deployment-Nachweis fehlgeschlagen.' -ForegroundColor Red
    exit 1
}
Write-Host 'Deployment-Nachweis: keine FAIL-Pruefung. Offene Punkte siehe MANUELL-Zeilen.' -ForegroundColor Green
exit 0
