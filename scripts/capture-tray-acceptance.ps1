param(
  [string]$ExePath = 'C:\Users\Admin\.openclaw\workspace\projects\meeting-notes-tauri\dist\portable\MeetingNotes.exe',
  [string]$LogPath = 'C:\Users\Admin\.openclaw\workspace\temp\tray-menu.log'
)
$ErrorActionPreference = 'Continue'
$lines = New-Object System.Collections.ArrayList
function L($m) { [void]$script:lines.Add(('[' + (Get-Date -Format 'HH:mm:ss.fff') + '] ' + $m)) }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$cs = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class TM {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int a);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static string Text(IntPtr h) { StringBuilder s = new StringBuilder(512); GetWindowTextW(h, s, 512); return s.ToString(); }
  public static string Cls(IntPtr h) { StringBuilder s = new StringBuilder(256); GetClassNameW(h, s, 256); return s.ToString(); }
  public static void AbsoluteClick(int x, int y, bool right) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
    int ax = (int)(((double)(x - vx) / Math.Max(1, vw)) * 65535.0);
    int ay = (int)(((double)(y - vy) / Math.Max(1, vh)) * 65535.0);
    mouse_event(0x8000, ax, ay, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(200);
    uint down = right ? 0x0008u : 0x0002u;
    uint up = right ? 0x0010u : 0x0004u;
    mouse_event(down, ax, ay, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(120);
    mouse_event(up, ax, ay, 0, IntPtr.Zero);
  }
}
'@
Add-Type -TypeDefinition $cs
if (-not [TM]::SetProcessDpiAwarenessContext([IntPtr](-4))) { [void][TM]::SetProcessDpiAwareness(2) }
L ('session=' + (Get-Process -Id $PID).SessionId + ' interactive=' + [Environment]::UserInteractive)
L ('virtual screen: ' + [TM]::GetSystemMetrics(78) + 'x' + [TM]::GetSystemMetrics(79) + ' origin ' + [TM]::GetSystemMetrics(76) + ',' + [TM]::GetSystemMetrics(77))
Get-Process MeetingNotes -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Get-Process Notepad -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
$app = Start-Process $ExePath -WorkingDirectory (Split-Path $ExePath) -PassThru
L ('app pid=' + $app.Id)
Start-Sleep -Seconds 12
$script:tops = New-Object System.Collections.ArrayList
function Refresh-Tops() {
  $script:tops = New-Object System.Collections.ArrayList
  $cb = [TM+EnumProc]{ param($h, $l); $p2 = 0; [void][TM]::GetWindowThreadProcessId($h, [ref]$p2); [void]$script:tops.Add([PSCustomObject]@{ H = $h; Pid = $p2; Cls = [TM]::Cls($h); T = [TM]::Text($h); V = [TM]::IsWindowVisible($h) }); return $true }
  [void][TM]::EnumWindows($cb, [IntPtr]::Zero)
  return $script:tops
}
$root = [System.Windows.Automation.AutomationElement]::RootElement
$icon = $null
foreach ($e in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
  if ($e.Current.Name -eq 'Meeting Notes' -and $e.Current.ClassName -like 'SystemTray*') { $icon = $e; break }
}
if (-not $icon) { L 'tray icon not visible'; $lines | Set-Content -Path $LogPath -Encoding UTF8; exit 6 }
$r = $icon.Current.BoundingRectangle
L ('icon rect=' + $r)
$before = @()
foreach ($t in (Refresh-Tops)) { $before += $t.H.ToString() }
L '--- absolute right click ---'
[TM]::AbsoluteClick([int]($r.Left + $r.Width / 2), [int]($r.Top + $r.Height / 2), $true)
Start-Sleep -Seconds 4
foreach ($t in (Refresh-Tops)) {
  if (-not $t.V) { continue }
  $isNew = ($before -notcontains $t.H.ToString())
  if ($isNew) { L ('  NEW window: hwnd=' + $t.H + ' class=' + $t.Cls + ' title=' + $t.T) }
}
$miCond = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty), ([System.Windows.Automation.ControlType]::MenuItem)
$items = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $miCond)
L ('menu items: ' + $items.Count)
foreach ($it in $items) { L ('  item: ' + $it.Current.Name + ' class=' + $it.Current.ClassName) }
[void][TM]::mouse_event(0x0001, 0, 0, 0, [IntPtr]::Zero)
Get-Process MeetingNotes -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
$lines | Set-Content -Path $LogPath -Encoding UTF8
Write-Output 'DONE'
