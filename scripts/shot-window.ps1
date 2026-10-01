param(
  [string]$Out = '',
  [string]$Process = 'modulo',
  [long]$Hwnd = 0,
  [switch]$FullSession,
  [switch]$State,
  [switch]$Restore
)

# 桌面壳的真机取证：抓窗口截图，以及读窗口的 Win32 状态（图标态/可见/矩形/样式位）。
# 用 PrintWindow(PW_RENDERFULLCONTENT) 而不是 CopyFromScreen —— 后者截的是屏幕区域，
# 目标窗口没抢到前台时会把 IDE 截进去（实测踩过），而抢前台又会打断用户。

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$native = @'
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);

  /// 取该进程面积最大的可见/图标态顶层窗口。.NET 的 MainWindowHandle 不可靠：
  /// 窗口最小化时它会漂到一个 6×6 的辅助窗口上，重启瞬间也可能直接命中那个辅助窗口。
  public static IntPtr FindLargestWindow(uint pid) {
    IntPtr best = IntPtr.Zero;
    long bestArea = 0;
    EnumWindows((h, l) => {
      uint p;
      GetWindowThreadProcessId(h, out p);
      if (p != pid) return true;
      if (!IsWindowVisible(h) && !IsIconic(h)) return true;
      RECT r;
      if (!GetWindowRect(h, out r)) return true;
      long a = Math.Abs((long)(r.Right - r.Left) * (long)(r.Bottom - r.Top));
      if (a > bestArea) { bestArea = a; best = h; }
      return true;
    }, IntPtr.Zero);
    return best;
  }
}
'@
Add-Type -TypeDefinition $native

[void][Win32]::SetProcessDPIAware()

$PW_RENDERFULLCONTENT = 2
$GWL_STYLE = -16
$SW_RESTORE = 9

function Find-MainWindow([string]$name) {
  $p = Get-Process -Name $name -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $p) { return [IntPtr]::Zero }
  $h = [Win32]::FindLargestWindow([uint32]$p.Id)
  if ($h -ne [IntPtr]::Zero) { return $h }
  return $p.MainWindowHandle
}

function Save-Bmp([System.Drawing.Bitmap]$bmp, [string]$path) {
  $full = [System.IO.Path]::GetFullPath($path)
  $dir = [System.IO.Path]::GetDirectoryName($full)
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output "$full $($bmp.Width)x$($bmp.Height)"
}

if ($FullSession) {
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $b.Size)
  $g.Dispose()
  Save-Bmp $bmp $Out
  $bmp.Dispose()
  exit 0
}

# 句柄要钉死：最小化期间 .NET 的 MainWindowHandle 会漂到一个 6×6 的辅助窗口上（实测），
# 于是 IsIconic 永远读到 false、rect 全是垃圾。调用方第一次拿到 hwnd 后必须回传。
if ($Hwnd -ne 0 -and [Win32]::IsWindow([IntPtr]$Hwnd)) {
  $hwnd = [IntPtr]$Hwnd
} else {
  $hwnd = Find-MainWindow $Process
}

if ($State) {
  if ($hwnd -eq [IntPtr]::Zero) {
    Write-Output (@{ running = $false } | ConvertTo-Json -Compress)
    exit 1
  }
  $r = New-Object Win32+RECT
  [void][Win32]::GetWindowRect($hwnd, [ref]$r)
  # 无符号化：JS 侧要按位与 WS_THICKFRAME(0x40000)，带符号的 int 也能算，但输出成无符号更好读
  $style = [uint32]([uint32][Win32]::GetWindowLong($hwnd, $GWL_STYLE))
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  Write-Output (@{
    running = $true
    hwnd    = [int64]$hwnd
    iconic  = [Win32]::IsIconic($hwnd)
    visible = [Win32]::IsWindowVisible($hwnd)
    style   = $style
    work    = @{ x = $wa.X; y = $wa.Y; w = $wa.Width; h = $wa.Height }
    rect    = @{ x = $r.Left; y = $r.Top; w = ($r.Right - $r.Left); h = ($r.Bottom - $r.Top) }
  } | ConvertTo-Json -Compress)
  exit 0
}

if ($Restore) {
  if ($hwnd -eq [IntPtr]::Zero) { Write-Error "找不到进程 $Process 的主窗口"; exit 2 }
  [void][Win32]::ShowWindow($hwnd, $SW_RESTORE)
  exit 0
}

if (-not $Out) { Write-Error '需要 -Out <png> 或 -State / -Restore'; exit 2 }
if ($hwnd -eq [IntPtr]::Zero) { Write-Error "找不到进程 $Process 的主窗口"; exit 2 }

if ([Win32]::IsIconic($hwnd)) { [void][Win32]::ShowWindow($hwnd, $SW_RESTORE); Start-Sleep -Milliseconds 500 }

# PrintWindow 画的是「整个窗口」，含 Win10+ 那圈透明的可调边框；按 DWM 可见框建位图会裁掉右下边，
# 所以尺寸取 GetWindowRect。多出来的几像素黑边不影响判断。
$r = New-Object Win32+RECT
[void][Win32]::GetWindowRect($hwnd, [ref]$r)
$w = $r.Right - $r.Left
$h = $r.Bottom - $r.Top
if ($w -lt 2 -or $h -lt 2) { Write-Error "窗口尺寸异常 ${w}x${h}"; exit 3 }

$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [Win32]::PrintWindow($hwnd, $hdc, $PW_RENDERFULLCONTENT)
$g.ReleaseHdc($hdc)
if (-not $ok) { $g.Dispose(); $bmp.Dispose(); Write-Error "PrintWindow 失败"; exit 4 }
Save-Bmp $bmp $Out
$g.Dispose(); $bmp.Dispose()
