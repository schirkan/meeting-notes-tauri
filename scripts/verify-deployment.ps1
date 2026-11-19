#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Prueft eine Portable-Distribution auf einem fremden Rechner.

.DESCRIPTION
    Setzt die Checkliste aus specs/T-510-clean-machine-deployment-windows-11.md
    als ausfuehrbaren Nachweis um. Das Skript ist selbststaendig: es braucht
    weder Node noch Rust noch das Repository - nur den Portable-Ordner.

    Auf dem Zielsystem wird der Ordner komplett kopiert und dieses Skript
    daneben ausgefuehrt:

        powershell -ExecutionPolicy Bypass -File .\verify-deployment.ps1

    AUSGABE: eine Zeile je Pruefung mit Status (PASS/FAIL/INFO/MANUELL) und
    Begruendung. Exit-Code 0 = keine FAIL-Pruefung, 1 = mindestens eine FAIL.

    KOMPATIBELITAET: laeuft unter Windows PowerShell 5.1 (auf jedem
    Windows 11 vorhanden) wie auch unter PowerShell 7. Die Datei ist bewusst
    ASCII-only und ohne BOM: Windows PowerShell 5.1 liest Skripte ohne BOM
    als ANSI, wodurch UTF-8-Umlaute den Parser brechen koennten.

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

# SHA256 ohne Get-FileHash: das Cmdlet stammt aus dem Modul
# Microsoft.PowerShell.Utility, das auf einem Build-Runner nicht zwingend
# geladen ist. Die .NET-API ist ueberall vorhanden - auch unter
# Windows PowerShell 5.1 ohne Utility-Modul.
function Get-Sha256Hex {
    param([string]$Path)
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $bytes = $sha.ComputeHash($stream)
        }
        finally { $sha.Dispose() }
    }
    finally { $stream.Dispose() }
    return ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
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
Write-Host '=== Meeting Notes - Deployment-Pruefung ===' -ForegroundColor Cyan
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
    Add-Result 'PASS' 'Keine Entwickler-Toolchain' 'Weder dotnet, noch node, noch cargo im PATH - entspricht dem Clean-Machine-Ziel.'
} else {
    Add-Result 'INFO' 'Entwickler-Toolchain vorhanden' ("Im PATH gefunden: {0}. Fuer den Clean-Machine-Nachweis idealerweise nicht vorhanden." -f ($tools -join ', '))
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
    Add-Result 'FAIL' 'WebView2 Runtime' 'Nicht im Registry gefunden - die App startet ohne WebView2 nicht.'
}

# --- 4. Self-contained-Runtime ----------------------------------------------
$sidecarExe = Join-Path $PortableDir 'MeetingNotes.Sidecar.exe'
$sidecarProbe = $null
if (Test-Path $sidecarExe) {
    $process = New-Object System.Diagnostics.Process
    $probeDeps = $null
    try {
        $start = New-Object System.Diagnostics.ProcessStartInfo
        $start.FileName = (Resolve-Path $sidecarExe -ErrorAction Stop).Path
        $start.Arguments = '--list-devices'
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $missingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
        $probeDeps = $missingRoot + '.deps.json'
        [System.IO.File]::WriteAllText($probeDeps, '{')
        # Additional deps are ignored ONLY by self-contained applications.
        # A missing file may be ignored too, so use an EXISTING malformed one.
        $start.EnvironmentVariables['DOTNET_ADDITIONAL_DEPS'] = $probeDeps
        $start.EnvironmentVariables['DOTNET_ROOT'] = $missingRoot
        $start.EnvironmentVariables['DOTNET_ROOT_X64'] = $missingRoot
        $start.EnvironmentVariables['DOTNET_ROOT_ARM64'] = $missingRoot
        $start.EnvironmentVariables['DOTNET_MULTILEVEL_LOOKUP'] = '0'
        $process.StartInfo = $start
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(15000)) {
            Stop-Process -Id $process.Id -ErrorAction Stop
            throw 'Sidecar antwortet nicht innerhalb von 15 s.'
        }
        $sidecarProbe = [PSCustomObject]@{ ExitCode = $process.ExitCode; Stdout = $stdout.Result; Stderr = $stderr.Result }
        if ($sidecarProbe.ExitCode -ne 0 -or $sidecarProbe.Stderr.Trim() -ne '') {
            throw ("Exit {0}: {1}" -f $sidecarProbe.ExitCode, $sidecarProbe.Stderr.Trim())
        }
        $event = $sidecarProbe.Stdout.Trim() | ConvertFrom-Json -ErrorAction Stop
        if ($event.type -ne 'device_list') { throw 'Kein device_list-Event erhalten.' }
        Add-Result 'PASS' '.NET Self-contained' 'Sidecar startet mit ungueltigem DOTNET_ROOT und defekten Additional-Deps. Keine installierte .NET-Runtime erforderlich.'
    } catch {
        Add-Result 'FAIL' '.NET Self-contained' $_.Exception.Message
    } finally {
        $process.Dispose()
        if ($probeDeps -and (Test-Path -LiteralPath $probeDeps)) {
            Remove-Item -LiteralPath $probeDeps -ErrorAction Stop
        }
    }
} else {
    Add-Result 'FAIL' '.NET Self-contained' 'MeetingNotes.Sidecar.exe fehlt.'
}

# --- 5. Integritaet: SHA256SUMS --------------------------------------------
$sumsFile = Join-Path $PortableDir 'SHA256SUMS'
if (-not (Test-Path $sumsFile)) {
    Add-Result 'FAIL' 'SHA256SUMS' 'Datei fehlt - Integritaet der Distribution nicht nachweisbar.'
} else {
    $lines = @(Get-Content $sumsFile | Where-Object { $_.Trim() -ne '' })
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
            $actual = Get-Sha256Hex -Path $file
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
$personalConfig = Join-Path $PortableDir 'MeetingNotes.config.json'
$legacyConfig = Join-Path $PortableDir 'meeting-notes.config.json'
if ((Test-Path $personalConfig) -or (Test-Path $legacyConfig)) {
    Add-Result 'FAIL' 'Keine persoenliche Config' 'MeetingNotes.config.json oder die alte meeting-notes.config.json liegt im Ordner - nicht verteilen (enthaelt ggf. Credentials).'
} else {
    Add-Result 'PASS' 'Keine persoenliche Config' 'Weder MeetingNotes.config.json noch die alte meeting-notes.config.json ist enthalten.'
}

$example = Join-Path $PortableDir 'MeetingNotes.config.example.json'
if (Test-Path $example) {
    $raw = Get-Content $example -Raw
    # Der Platzhalter ist ein <...>-Marker; zusaetzlich gilt ein leerer Wert
    # als unauffaellig. Ein konkreter Wert waere ein Credential-Leak.
    $placeholder = $raw -match '"speechKey"\s*:\s*"(<[^>]*>|\s*)"'
    if ($placeholder) {
        Add-Result 'PASS' 'Config-Template ohne Credentials' 'speechKey ist ein Platzhalter.'
    } else {
        Add-Result 'FAIL' 'Config-Template ohne Credentials' 'speechKey enthaelt einen konkreten Wert - nicht verteilen.'
    }
} else {
    Add-Result 'INFO' 'Config-Template' 'MeetingNotes.config.example.json fehlt im Ordner.'
}

# --- 7. Sidecar: device_list ------------------------------------------------
if (-not (Test-Path $sidecarExe)) {
    Add-Result 'FAIL' 'Sidecar-EXE' 'MeetingNotes.Sidecar.exe fehlt - der Ordner muss vollstaendig kopiert werden.'
} else {
    $subsystem = Get-PeSubsystem $sidecarExe
    Add-Result 'PASS' 'Sidecar-EXE' ("{0:N2} MB, Subsystem {1} (3 = Konsole, erwartet)." -f ((Get-Item $sidecarExe).Length / 1MB), $subsystem)
    try {
        if ($null -eq $sidecarProbe -or $sidecarProbe.ExitCode -ne 0) {
            throw 'Sidecar-Runtime-Probe fehlgeschlagen.'
        }
        $out = $sidecarProbe.Stdout
        $first = ($out -split '\r?\n' | Where-Object { $_.Trim() -ne '' } | Select-Object -First 1)
        try {
            $json = $first | ConvertFrom-Json
            if ($json.type -eq 'device_list') {
                $inCount = @($json.payload.Inputs).Count
                $outCount = @($json.payload.Outputs).Count
                Add-Result 'PASS' 'Sidecar --list-devices' ("device_list empfangen - {0} Eingaenge, {1} Ausgaenge." -f $inCount, $outCount)
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
$appExe = Join-Path $PortableDir 'MeetingNotes.exe'
if (-not (Test-Path $appExe)) {
    Add-Result 'FAIL' 'Haupt-EXE' 'MeetingNotes.exe fehlt.'
} else {
    $subsystem = Get-PeSubsystem $appExe
    if ($subsystem -eq 2) {
        Add-Result 'PASS' 'Haupt-EXE ohne Konsolenfenster' 'PE-Subsystem 2 (Windows GUI).'
    } elseif ($subsystem -eq 3) {
        Add-Result 'FAIL' 'Haupt-EXE ohne Konsolenfenster' 'PE-Subsystem 3 (Konsole) - beim Start erscheint ein Konsolenfenster.'
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
$results | Format-Table -AutoSize -Property Status, Check, Detail
$failCount = @($results | Where-Object { $_.Status -eq 'FAIL' }).Count
$passCount = @($results | Where-Object { $_.Status -eq 'PASS' }).Count
$infoCount = @($results | Where-Object { $_.Status -eq 'INFO' -or $_.Status -eq 'MANUELL' }).Count
Write-Host ''
Write-Host ("PASS: {0} | FAIL: {1} | INFO/MANUELL: {2}" -f $passCount, $failCount, $infoCount)
if ($failCount -gt 0) {
    Write-Host 'Deployment-Nachweis fehlgeschlagen.' -ForegroundColor Red
    exit 1
}
Write-Host 'Deployment-Nachweis: keine FAIL-Pruefung. Offene Punkte siehe MANUELL-Zeilen.' -ForegroundColor Green
exit 0
