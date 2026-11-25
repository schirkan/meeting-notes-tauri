param(
  [string]$ExePath = 'C:\Users\Admin\.openclaw\workspace\projects\meeting-notes-tauri\dist\portable\MeetingNotes.exe',
  [string]$OutDir = 'C:\Users\Admin\.openclaw\workspace\projects\meeting-notes-tauri\docs\native',
  [string]$LogPath = 'C:\Users\Admin\.openclaw\workspace\temp\native-capture.log'
)

# Runs INSIDE the interactive Windows session (scheduled task, LogonType Interactive).
# Captures the real Tauri window with PrintWindow(PW_RENDERFULLCONTENT) and drives the
# real WebView2 UI through the accessibility tree.
# ASCII only on purpose: PowerShell 5.1 reads this file without BOM.

$ErrorActionPreference = 'Continue'
$lines = New-Object System.Collections.ArrayList
function L($m) { [void]$script:lines.Add(('[' + (Get-Date -Format 'HH:mm:ss.fff') + '] ' + $m)) }

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$cs = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class NC {
  public delegate bool EnumProc(IntPtr h, IntPtr l);

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int a);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr m);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetMenuStringW(IntPtr m, uint id, StringBuilder s, int max, uint flag);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

  public static string Text(IntPtr h) { StringBuilder s = new StringBuilder(512); GetWindowTextW(h, s, 512); return s.ToString(); }
  public static string Cls(IntPtr h) { StringBuilder s = new StringBuilder(256); GetClassNameW(h, s, 256); return s.ToString(); }

  public static void LeftClick(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(120);
    mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(60);
    mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
  }

  public static void DoubleClick(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(120);
    mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(40);
    mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(70);
    mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(40);
    mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
  }

  public static void RightClick(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(120);
    mouse_event(0x0008, 0, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(70);
    mouse_event(0x0010, 0, 0, 0, IntPtr.Zero);
  }
}
'@
Add-Type -TypeDefinition $cs

# Per-Monitor-V2 so client coordinates and accessibility rectangles use the same
# physical pixels. Without it the click coordinates are scaled and miss.
if (-not [NC]::SetProcessDpiAwarenessContext([IntPtr](-4))) { [void][NC]::SetProcessDpiAwareness(2) }

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility'
L ('session=' + (Get-Process -Id $PID).SessionId + ' interactive=' + [Environment]::UserInteractive)

# Dummy Azure configuration WITHOUT a proxy section: an empty proxy object makes
# isConfigComplete() fail and forces the settings dialog open at startup.
# Written without BOM: PowerShell 5.1 Set-Content -Encoding UTF8 adds one and the
# Rust config loader then rejects the file.
# Run from a scratch copy so the shipped build folder stays untouched and the
# dummy configuration never lands next to the real EXE.
$sourceDir = Split-Path $ExePath
$workDir = Join-Path ([System.IO.Path]::GetTempPath()) 'meeting-notes-native-capture'
if (Test-Path $workDir) { Remove-Item $workDir -Recurse -Force }
New-Item -ItemType Directory -Path $workDir -Force | Out-Null
foreach ($file in @('MeetingNotes.exe', 'MeetingNotes.Sidecar.exe')) {
  $src = Join-Path $sourceDir $file
  if (Test-Path $src) { Copy-Item $src $workDir -Force }
}
$ExePath = Join-Path $workDir 'MeetingNotes.exe'
L ('work copy: ' + $workDir)

$configPath = Join-Path $workDir 'MeetingNotes.config.json'
$cfg = @{
  azure = @{ endpoint = 'https://westeurope.stt.speech.microsoft.com'; region = 'westeurope'; speechKey = 'dummy-key-for-screenshot-capture'; interimResults = $true }
  user = @{ language = 'de-DE'; transcription = @{ mic = $true; speaker = $true }; autoLanguageDetection = $true; diarization = $true; devices = @{ micId = $null; speakerLoopbackId = $null }; transcript = @{ markdownExport = @{ enabled = $true; path = $null } }; autoStart = @{ enabled = $true; processes = @() }; window = @{ minimizeToTrayOnClose = $true } }
} | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($configPath, $cfg, (New-Object System.Text.UTF8Encoding($false)))
L ('wrote dummy config (no BOM, no proxy): ' + $configPath)

Get-Process MeetingNotes -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

if (-not (Test-Path $ExePath)) { L ('EXE missing: ' + $ExePath); $lines | Set-Content -Path $LogPath -Encoding UTF8; exit 4 }
$app = Start-Process $ExePath -WorkingDirectory $workDir -PassThru
L ('app pid=' + $app.Id)

$script:tops = New-Object System.Collections.ArrayList
function Refresh-Tops() {
  $script:tops = New-Object System.Collections.ArrayList
  $cb = [NC+EnumProc]{ param($h, $l); $p2 = 0; [void][NC]::GetWindowThreadProcessId($h, [ref]$p2); [void]$script:tops.Add([PSCustomObject]@{ H = $h; Pid = $p2; Cls = [NC]::Cls($h); T = [NC]::Text($h); V = [NC]::IsWindowVisible($h) }); return $true }
  [void][NC]::EnumWindows($cb, [IntPtr]::Zero)
  return $script:tops
}

$main = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  $t = (Refresh-Tops) | Where-Object { $_.Pid -eq $app.Id -and $_.V -and $_.Cls -eq 'Tauri Window' } | Select-Object -First 1
  if ($t) { $main = $t; L ('window after ' + ($i * 0.5) + 's'); break }
}
if (-not $main) { L 'NO MAIN WINDOW'; $lines | Set-Content -Path $LogPath -Encoding UTF8; exit 5 }

[void][NC]::SetWindowPos($main.H, [IntPtr]::Zero, 20, 20, 1500, 940, 0x0040)
[void][NC]::SetForegroundWindow($main.H)
Start-Sleep -Seconds 10

$script:kids = New-Object System.Collections.ArrayList
$kcb = [NC+EnumProc]{ param($h, $l); [void]$script:kids.Add([PSCustomObject]@{ H = $h; Cls = [NC]::Cls($h); V = [NC]::IsWindowVisible($h) }); return $true }
[void][NC]::EnumChildWindows($main.H, $kcb, [IntPtr]::Zero)
$render = $script:kids | Where-Object { $_.Cls -eq 'Chrome_RenderWidgetHostHWND' } | Select-Object -First 1
if (-not $render) { L 'NO RENDER HOST'; $lines | Set-Content -Path $LogPath -Encoding UTF8; exit 6 }
$origin = New-Object NC+POINT
[void][NC]::ClientToScreen($render.H, [ref]$origin)
L ('render host origin=' + $origin.X + ',' + $origin.Y)

function Grab([string]$tag) {
  $r = New-Object NC+RECT
  [void][NC]::GetWindowRect($main.H, [ref]$r)
  $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
  if ($w -le 0 -or $h -le 0) { L ('grab skipped ' + $tag); return }
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [void][NC]::PrintWindow($main.H, $hdc, 2)
  $g.ReleaseHdc($hdc); $g.Dispose()
  $p = Join-Path $OutDir ($tag + '.png')
  $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  L ('grab ' + $tag + ' ' + $w + 'x' + $h + ' bytes=' + (Get-Item $p).Length)
}

function Grab-Hwnd([IntPtr]$hwnd, [string]$tag) {
  $r = New-Object NC+RECT
  [void][NC]::GetWindowRect($hwnd, [ref]$r)
  $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
  if ($w -le 0 -or $h -le 0) { L ('grab skipped ' + $tag); return }
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [void][NC]::PrintWindow($hwnd, $hdc, 2)
  $g.ReleaseHdc($hdc); $g.Dispose()
  $p = Join-Path $OutDir ($tag + '.png')
  $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  L ('grab ' + $tag + ' ' + $w + 'x' + $h + ' bytes=' + (Get-Item $p).Length)
}

function All-Elements() {
  $el = [System.Windows.Automation.AutomationElement]::FromHandle($main.H)
  if ($el -eq $null) { return $null }
  return $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
}

function Find-El([string]$needle, [string]$type) {
  $all = All-Elements
  if ($all -eq $null) { return $null }
  $fallback = $null
  foreach ($e in $all) {
    $n = $e.Current.Name
    if (-not $n) { continue }
    if ($n -like ('*' + $needle + '*')) {
      $t = $e.Current.ControlType.ProgrammaticName
      if (-not $type -or $t -eq $type) { return $e }
      if ($fallback -eq $null) { $fallback = $e }
    }
  }
  return $fallback
}

function Click([string]$needle, [string]$type) {
  $el = Find-El $needle $type
  if ($el -eq $null) {
    L ('click MISS: ' + $needle)
    $all = All-Elements
    if ($all) {
      $names = @()
      foreach ($e in $all) { if ($e.Current.Name) { $names += $e.Current.Name } }
      L ('  available: ' + (($names | Select-Object -Unique) -join ' | '))
    }
    return $false
  }
  L ('click ' + $needle + ' -> ' + $el.Current.Name + ' [' + $el.Current.ControlType.ProgrammaticName + ']')
  try {
    $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
    L '  select ok'
    Start-Sleep -Milliseconds 1200
    return $true
  } catch { }
  try {
    $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    L '  invoke ok'
    Start-Sleep -Milliseconds 1200
    return $true
  } catch { }
  $b = $el.Current.BoundingRectangle
  $cx = [int]($b.Left + $b.Width / 2) - $origin.X
  $cy = [int]($b.Top + $b.Height / 2) - $origin.Y
  $lp = [IntPtr](($cy -shl 16) -bor ($cx -band 0xFFFF))
  [void][NC]::PostMessage($render.H, 0x0200, [IntPtr]::Zero, $lp)
  [void][NC]::PostMessage($render.H, 0x0201, [IntPtr]1, $lp)
  [void][NC]::PostMessage($render.H, 0x0202, [IntPtr]::Zero, $lp)
  L ('  posted click at client ' + $cx + ',' + $cy)
  Start-Sleep -Milliseconds 1200
  return $true
}

# Exact name match. A substring match would hit 'Audio devices' in the
# background panel behind the dialog and scroll the wrong element.
function Find-El-Exact([string]$name, [string]$type) {
  $all = All-Elements
  if ($all -eq $null) { return $null }
  foreach ($e in $all) {
    if ($e.Current.Name -ne $name) { continue }
    $t = $e.Current.ControlType.ProgrammaticName
    if (-not $type -or $t -eq $type) { return $e }
  }
  return $null
}

# Scroll position of a section heading in screen pixels, or $null when it is not
# in the accessibility tree.
function Section-Y([string]$name) {
  $el = Find-El-Exact $name 'ControlType.Text'
  if ($null -eq $el) { return $null }
  return [int]$el.Current.BoundingRectangle.Top
}

# Scroll the dialog with the mouse wheel. The WebView2 document exposes a
# ScrollPattern without usable values, and ScrollItemPattern.ScrollIntoView
# scrolls the page root instead of the settings grid, so the wheel message is
# the reliable way to move the content.
function Wheel([int]$notches) {
  $delta = -120 * $notches
  $w = (($delta -band 0xFFFF) -shl 16)
  $cr = New-Object NC+RECT
  [void][NC]::GetClientRect($render.H, [ref]$cr)
  $cx = [int](($cr.Right - $cr.Left) / 2)
  $cy = [int](($cr.Bottom - $cr.Top) * 0.55)
  $sx = $origin.X + $cx
  $sy = $origin.Y + $cy
  $l = (($sy -band 0xFFFF) -shl 16) -bor ($sx -band 0xFFFF)
  for ($i = 0; $i -lt [math]::Abs($notches); $i++) {
    [void][NC]::PostMessage($render.H, 0x020A, [IntPtr]$w, [IntPtr]$l)
    Start-Sleep -Milliseconds 150
  }
}

# Bring a section heading into the upper part of the settings grid. The wheel
# step is about 190 px at this window size, so the position is checked after
# every step and corrected in both directions.
function Scroll-To([string]$name, [int]$band) {
  # Ein Mausrad-Schritt bewegt etwa 190 px. Das Zielband ist so breit wie ein
  # Schritt, damit das Raster nicht zwischen zwei Positionen pendelt.
  $seen = @{}
  for ($i = 0; $i -lt 24; $i++) {
    $y = Section-Y $name
    if ($null -eq $y) { throw ('Section not found: ' + $name) }
    if ($seen.ContainsKey($y)) {
      L ('  ' + $name + ' bei y=' + $y + ' (naechstliegende Position erreicht)')
      return
    }
    $seen[$y] = $true
    if ($y -le $band -and $y -gt ($band - 190)) { L ('  ' + $name + ' at y=' + $y); return }
    $before = $y
    if ($y -gt $band) { Wheel 1 } else { Wheel -1 }
    Start-Sleep -Milliseconds 250
    $after = Section-Y $name
    if ($null -eq $after -or $after -eq $before) {
      L ('  ' + $name + ' stuck at y=' + $before + ' (scroll limit reached)')
      return
    }
  }
  L ('  ' + $name + ' not aligned after 24 steps')
}

L '=== 1 main window ==='
Click 'Close error message' $null | Out-Null
Click 'Close dialog' $null | Out-Null
Start-Sleep -Seconds 1
Grab '01-start-screen'

L '=== 2 settings general ==='
Click 'Open settings dialog' $null | Out-Null
Grab '02-settings-top'

L '=== 3 settings unten ==='
Wheel 10
Start-Sleep -Milliseconds 900
Grab '03-settings-bottom'

L '=== 6 connection test ==='
Click 'Test connection' $null | Out-Null
# Starting the test opens this dialog and closes Settings immediately.
# The reopen-result buttons are therefore not in the accessibility tree here.
Start-Sleep -Seconds 5
if (-not (Find-El 'Connection test' $null)) {
  throw 'Connection test dialog not found; refusing to capture the wrong state.'
}
L '  connection dialog open; capturing live diagnostics (not a completed-test assertion)'
Grab '04-connection-test'
# First close the connection dialog, then the settings dialog.
Click 'Close dialog' $null | Out-Null
Start-Sleep -Milliseconds 900
Click 'Close dialog' $null | Out-Null
Start-Sleep -Milliseconds 900

L '=== 7 speakers ==='
Click 'Speaker mapping' $null | Out-Null
Grab '05-speaker-mapping'

L '=== 8 debug log ==='
Click 'More actions' $null | Out-Null
Click 'Debug log' $null | Out-Null
Start-Sleep -Milliseconds 800
Grab '06-debug-log'

L '=== 9 about dialog ==='
Click 'More actions' $null | Out-Null
Click 'About' $null | Out-Null
Start-Sleep -Milliseconds 900
Grab '07-about-dialog'

L '=== 8 tray acceptance ==='
try {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $trayCond = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ClassNameProperty), 'Shell_TrayWnd'
  $tray = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $trayCond)
  $icon = $null
  # The overflow flyout is a separate top level window, so search the whole tree first.
  foreach ($e in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    if ($e.Current.Name -eq 'Meeting Notes' -and $e.Current.ClassName -like 'SystemTray*') { $icon = $e; break }
  }
  if (-not $icon) {
    L '  icon not visible, expanding hidden icons'
    foreach ($e in $tray.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
      if ($e.Current.Name -like 'Ausgeblendete*') {
        try { $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); L '  expanded'; Start-Sleep -Seconds 3 } catch { L ('  expand failed: ' + $_.Exception.Message) }
        break
      }
    }
    for ($i = 0; $i -lt 10; $i++) {
      foreach ($e in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
        if ($e.Current.Name -eq 'Meeting Notes' -and $e.Current.ClassName -like 'SystemTray*') { $icon = $e; break }
      }
      if ($icon) { break }
      Start-Sleep -Seconds 1
    }
  }
  if (-not $icon) { L '  TRAY ICON NOT FOUND' } else {
    $r = $icon.Current.BoundingRectangle
    L ('  tray icon: class=' + $icon.Current.ClassName + ' rect=' + $r)

    # Acceptance A: double click restores the main window.
    [void][NC]::ShowWindow($main.H, 6)
    Start-Sleep -Seconds 1
    L ('  window visible before double click: ' + [NC]::IsWindowVisible($main.H))
    [NC]::DoubleClick([int]($r.Left + $r.Width / 2), [int]($r.Top + $r.Height / 2))
    Start-Sleep -Seconds 3
    $vis = [NC]::IsWindowVisible($main.H)
    L ('  window visible after double click: ' + $vis)

    # Acceptance B: right click opens the context menu with Anzeigen and Beenden.
    [NC]::RightClick([int]($r.Left + $r.Width / 2), [int]($r.Top + $r.Height / 2))
    Start-Sleep -Seconds 3
    $menuHwnd = [IntPtr]::Zero
    foreach ($t in (Refresh-Tops)) {
      if ($t.V -and $t.Cls -eq '#32768') { $menuHwnd = $t.H; L ('  context menu window: ' + $t.H); break }
    }
    if ($menuHwnd -ne [IntPtr]::Zero) {
      Grab-Hwnd $menuHwnd '10-systray-kontextmenu'
      $hMenu = [NC]::GetMenu($menuHwnd)
      $count = [NC]::GetMenuItemCount($hMenu)
      L ('  menu items: ' + $count)
      for ($i = 0; $i -lt $count; $i++) {
        $sb = New-Object System.Text.StringBuilder 256
        [void][NC]::GetMenuStringW($hMenu, [uint32]$i, $sb, 256, 0x400)
        L ('    menu[' + $i + '] = ' + $sb.ToString())
      }
    } else { L '  NO CONTEXT MENU WINDOW' }
  }
} catch { L ('tray error: ' + $_.Exception.Message) }

Get-Process MeetingNotes -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
$lines | Set-Content -Path $LogPath -Encoding UTF8
Write-Output 'NATIVE-CAPTURE-DONE'
