param(
    [string]$PortableDir = (Join-Path $PSScriptRoot '..\dist\portable'),
    [string]$TestRoot = [IO.Path]::GetTempPath(),
    [switch]$CompileOnly
)
$ErrorActionPreference = 'Stop'
# Native callback-chain test, not proof of physical mouse interaction or icon appearance.
# Every process/window is selected by the PID of an isolated test-owned app.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class TrayProbeNative {
    public delegate bool EnumProc(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr menu);
    [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr menu, int position);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetMenuString(IntPtr menu, uint item, StringBuilder text, int count, uint flags);
    public static IntPtr Find(uint pid, string className, string title) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hwnd, data) => {
            uint owner; GetWindowThreadProcessId(hwnd, out owner);
            if (owner != pid) return true;
            var cls = new StringBuilder(256); GetClassName(hwnd, cls, cls.Capacity);
            var caption = new StringBuilder(512); GetWindowText(hwnd, caption, caption.Capacity);
            if ((className == null || cls.ToString() == className) && (title == null || caption.ToString() == title)) {
                found = hwnd; return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static IntPtr PopupMenu(IntPtr hwnd) {
        UIntPtr result;
        if (SendMessageTimeout(hwnd, 0x01E1, IntPtr.Zero, IntPtr.Zero, 2, 1000, out result) == IntPtr.Zero) return IntPtr.Zero;
        return new IntPtr(unchecked((long)result.ToUInt64()));
    }
    public static string MenuText(IntPtr menu, uint position) {
        var text = new StringBuilder(256); GetMenuString(menu, position, text, text.Capacity, 0x400); return text.ToString();
    }
}
'@
if ($CompileOnly) {
    Write-Output 'PASS: PowerShell native probe and Win32 P/Invoke helper compile (no GUI interaction).'
    exit 0
}
if (-not [Environment]::UserInteractive -or -not (Get-Process explorer -ErrorAction SilentlyContinue)) {
    Write-Output 'SKIPPED: Native tray test requires an interactive Windows desktop with Explorer.'
    exit 0
}
$checks = 0
function Check([bool]$Condition, [string]$Description) {
    if (-not $Condition) { throw $Description }
    $script:checks++
    Write-Output ('PASS: ' + $Description)
}
function Wait-For([scriptblock]$Condition, [string]$Description) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($timer.Elapsed.TotalSeconds -lt 12) {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 100
    }
    throw ('Timed out: ' + $Description)
}
$root = Join-Path $TestRoot ('meeting-notes-tray-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
try {
    foreach ($enabled in @($false, $true)) {
        $caseDir = Join-Path $root ([string]$enabled)
        New-Item -ItemType Directory -Path $caseDir -Force | Out-Null
        foreach ($name in @('MeetingNotes.exe', 'MeetingNotes.Sidecar.exe')) {
            Copy-Item (Join-Path $PortableDir $name) (Join-Path $caseDir $name)
        }
        # No personal configuration, Azure credentials, recording, or audio files.
        $config = @{ azure = $null; user = @{
            window = @{ minimizeToTrayOnClose = $enabled }
            autoStart = @{ enabled = $enabled; processes = @('tray-probe-no-match') }
        } }
        [IO.File]::WriteAllText((Join-Path $caseDir 'MeetingNotes.config.json'), ($config | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
        $app = Start-Process (Join-Path $caseDir 'MeetingNotes.exe') -WorkingDirectory $caseDir -PassThru
        $ownedChildren = @()
        try {
            Wait-For { $script:main = [TrayProbeNative]::Find([uint32]$app.Id, $null, 'Meeting Notes'); $script:main -ne [IntPtr]::Zero } 'main window'
            Wait-For { $script:tray = [TrayProbeNative]::Find([uint32]$app.Id, 'tray_icon_app', $null); $script:tray -ne [IntPtr]::Zero } 'native tray window'
            Check ($tray -ne [IntPtr]::Zero) ('Native tray exists (setting ' + $enabled + ')')
            if (-not $enabled) {
                [TrayProbeNative]::PostMessage($main, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
                Wait-For { $app.Refresh(); $app.HasExited } 'explicitly disabled close-to-tray exits'
                Check $app.HasExited 'Explicit false: close exits app'
                continue
            }
            Wait-For {
                $script:ownedChildren = @(Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $app.Id) |
                    Where-Object { $_.Name -eq 'MeetingNotes.Sidecar.exe' } | Select-Object -ExpandProperty ProcessId)
                $script:ownedChildren.Count -gt 0
            } 'detector child'
            [TrayProbeNative]::PostMessage($main, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
            Wait-For { -not [TrayProbeNative]::IsWindowVisible($main) } 'enabled close hides'
            $app.Refresh()
            Check (-not $app.HasExited) 'Enabled: close hides without exiting'
            Check (@($ownedChildren | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count -eq $ownedChildren.Count) 'Detector remains alive while hidden'
            # Message 6002 is the installed tray-icon 0.25.x Windows callback message.
            [TrayProbeNative]::PostMessage($tray, 6002, [IntPtr]::Zero, [IntPtr]0x0203) | Out-Null
            Wait-For { [TrayProbeNative]::IsWindowVisible($main) -and -not [TrayProbeNative]::IsIconic($main) } 'double-click restores'
            Check ([TrayProbeNative]::IsWindowVisible($main)) 'Native left-double-click callback shows main window'
            [TrayProbeNative]::ShowWindow($main, 6) | Out-Null
            Wait-For { [TrayProbeNative]::IsIconic($main) } 'minimized window'
            [TrayProbeNative]::PostMessage($tray, 6002, [IntPtr]::Zero, [IntPtr]0x0203) | Out-Null
            Wait-For { -not [TrayProbeNative]::IsIconic($main) } 'double-click unminimizes'
            Check (-not [TrayProbeNative]::IsIconic($main)) 'Double-click restores minimized main window'
            [TrayProbeNative]::PostMessage($main, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
            Wait-For { -not [TrayProbeNative]::IsWindowVisible($main) } 'hide before menu'
            [TrayProbeNative]::PostMessage($tray, 6002, [IntPtr]::Zero, [IntPtr]0x0205) | Out-Null
            Wait-For { $script:popup = [TrayProbeNative]::Find([uint32]$app.Id, '#32768', $null); $script:popup -ne [IntPtr]::Zero } 'context menu'
            $menu = [TrayProbeNative]::PopupMenu($popup)
            Check ($menu -ne [IntPtr]::Zero -and [TrayProbeNative]::GetMenuItemCount($menu) -eq 2) 'Native context menu has exactly two entries'
            Check ([TrayProbeNative]::MenuText($menu, 0) -eq 'Anzeigen') 'First menu entry is Anzeigen'
            Check ([TrayProbeNative]::MenuText($menu, 1) -eq 'Beenden') 'Second menu entry is Beenden'
            $showId = [TrayProbeNative]::GetMenuItemID($menu, 0)
            $quitId = [TrayProbeNative]::GetMenuItemID($menu, 1)
            [TrayProbeNative]::PostMessage($popup, 0x0100, [IntPtr]27, [IntPtr]::Zero) | Out-Null
            [TrayProbeNative]::PostMessage($tray, 0x0111, [IntPtr]$showId, [IntPtr]::Zero) | Out-Null
            Wait-For { [TrayProbeNative]::IsWindowVisible($main) } 'menu Anzeigen'
            Check ([TrayProbeNative]::IsWindowVisible($main)) 'Native Anzeigen command restores main window'
            [TrayProbeNative]::PostMessage($main, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
            Wait-For { -not [TrayProbeNative]::IsWindowVisible($main) } 'hide before Quit'
            [TrayProbeNative]::PostMessage($tray, 0x0111, [IntPtr]$quitId, [IntPtr]::Zero) | Out-Null
            Wait-For { $app.Refresh(); $app.HasExited } 'tray Quit'
            Check $app.HasExited 'Beenden exits even with close-to-tray enabled'
            Wait-For { @($ownedChildren | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count -eq 0 } 'owned detector cleanup'
            Check (@($ownedChildren | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count -eq 0) 'Quit cleans up the owned detector'
        }
        finally {
            # Recheck ownership/path before cleanup; never kill an unrelated reused PID.
            $remaining = @(Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $app.Id) |
                Where-Object { $_.Name -eq 'MeetingNotes.Sidecar.exe' -and $_.ExecutablePath -eq (Join-Path $caseDir 'MeetingNotes.Sidecar.exe') })
            foreach ($child in $remaining) { Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue }
            $app.Refresh()
            if (-not $app.HasExited) { $app.Kill(); $app.WaitForExit() }
            $app.Dispose()
        }
    }
    Write-Output ('PASS: ' + $checks + ' native tray assertions. Synthesized callbacks, not physical mouse/visual acceptance.')
}
finally { Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue }
