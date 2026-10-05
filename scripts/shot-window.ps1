param(
  [string]$Out = '',
  [string]$Process = 'modulo',
  [int]$ProcId = 0,
  [long]$Hwnd = 0,
  [string]$SendKeys = '',
  [int]$WatchMs = 0,
  # 连投几次同一组合键：SendKeys 在本机**不是「投一次到一次」**（实测 Ctrl+Alt+Shift+T
  # 要到第 3 次才真的送达，见下面 SendKeys 块的说明）。-SendTimes N = 最多投 N 次，
  # 每投一次后仍继续高频跟踪，整趟共用一个 PowerShell 进程。
  [int]$SendTimes = 1,
  [int]$SendGapMs = 600,
  [switch]$FullSession,
  [switch]$State,
  [switch]$Restore,
  # ---- 高频轮询模式（见文件末尾的说明：这才是能测准窗口动画的那条路）----
  [string]$Until = '',
  [int]$TimeoutMs = 8000,
  [int]$StepMs = 40,
  [int]$Tol = 40,
  [int]$TargetW = 0,
  [int]$TargetH = 0,
  [int]$MinW = 0
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
      // 只在「可见且非图标态」的窗口里挑：这里被调用的时机是"还没钉住句柄"的那一次（启动首轮），
      // 而主窗口还没建起来时，进程里先出现的往往是图标态窗口（GetWindowRect 给出 -32000 那种垃圾值）。
      // 让它赢，后面所有读数都是错的 —— 探针实测因此成对红了「夹取尺寸 + 居中」两条。
      // 已经钉住句柄之后的最小化/隐藏状态走 -Hwnd 直读，不经过这里，所以这个收紧不影响那些检查。
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
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
  # 给了 -ProcId 就只认那个进程，且不做任何按名字的兜底：
  # 自检脚本按进程名取「第一个同名进程」时，用户自己也开着应用就会钉到他的窗口上，
  # 于是 -Restore / 点关闭打在别人的实例里，读到的状态也不是探针那一份。
  if ($ProcId -ne 0) {
    $p = Get-Process -Id $ProcId -ErrorAction SilentlyContinue
    if (-not $p) { return [IntPtr]::Zero }
    return [Win32]::FindLargestWindow([uint32]$p.Id)
  }
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

# SendKeys 走 SendInput 进系统输入队列，RegisterHotKey 注册的热键能收到 —— 这是唯一能在
# 不碰物理键盘的前提下验证「全局快捷键真的被 OS 投递」的办法（CDP 合成键只在页面里，到不了系统）。
if ($SendKeys) {
  # SendKeys 在这台机器上**不是「投一次到一次」**。
# 实测：modulo 的两条热键（Ctrl+Alt+Shift+M 收起/唤出、Ctrl+Alt+Shift+T 置顶）
# 都已成功 RegisterHotKey（反查确认过：modulo 运行时再注册同一组合键返回
# 1409=ERROR_HOTKEY_ALREADY_REGISTERED），但单次 SendKeys 常常送不到 ——
# 置顶那条实测前两次 EXSTYLE 完全没动，第 3 次才生效。
# 原因不在这份脚本里（WScript.Shell.SendKeys 走系统输入队列，修饰键有时序），
# 但探针必须扛住它：所以连投若干次，而不是假设一次就中。
# 断言仍可证伪 —— 真坏的话 N 次全空，everHidden 仍是 false，照样红。
  $wsh = New-Object -ComObject WScript.Shell
  # 投递之前先在同一个进程里读一次可见性。JS 侧每次采样都要重新起一个 PowerShell（实测 1.3–2.0 秒），
  # 而 hide/show 就在投递后几十毫秒内发生完 —— 事后再读只能看到"最后是什么状态"，
  # 分不清是热键真的翻转过，还是压根没动（第一轮改就是这个歧义，"唤出"那条其实白过）。
  $preSendVisible = $null
  if ($WatchMs -gt 0 -and $Hwnd -ne 0) { $preSendVisible = [Win32]::IsWindowVisible([IntPtr]$Hwnd) }

  $h = [IntPtr]$Hwnd
  $everHidden = $preSendVisible -eq $false
  $everVisible = $preSendVisible -eq $true
  $samples = 0
  $hiddenSamples = 0
  $visibleSamples = 0
  $v = $preSendVisible
  $sends = 0
  $deadline = (Get-Date).AddMilliseconds($WatchMs)

  $track = $WatchMs -gt 0 -and $Hwnd -ne 0
  $flipped = $false

  # 第一投无条件发出去：此刻还没有「有没有翻转」可看，用 preSendVisible 当基线。
  $wsh.SendKeys($SendKeys)
  $sends = 1
  $v = $preSendVisible
  $nextSend = (Get-Date).AddMilliseconds($SendGapMs)

  while ((Get-Date) -lt $deadline) {
    if ($track) {
      $v = [Win32]::IsWindowVisible($h)
      $samples++
      if ($v) { $visibleSamples++; $everVisible = $true } else { $hiddenSamples++; $everHidden = $true }
      # 翻转了就停：多投一次就等于多触发一次「收起」，会把后面的「唤出」测成「又收起来了」
      if ($v -ne $preSendVisible) { $flipped = $true; break }
    }
    if ($sends -lt $SendTimes -and (Get-Date) -ge $nextSend) {
      $wsh.SendKeys($SendKeys)
      $sends++
      $nextSend = (Get-Date).AddMilliseconds($SendGapMs)
    }
    Start-Sleep -Milliseconds 50
  }

  # 时间到还没翻转：把剩下的次数立刻补掉（有的机器需要连着快速敲几下）
  if (-not $flipped -and $sends -lt $SendTimes) {
    for ($i = $sends; $i -lt $SendTimes; $i++) { $wsh.SendKeys($SendKeys); Start-Sleep -Milliseconds $SendGapMs }
    $sends = $SendTimes
    if ($track) {
      $v = [Win32]::IsWindowVisible($h)
      $samples++
      if ($v) { $visibleSamples++; $everVisible = $true } else { $hiddenSamples++; $everHidden = $true }
    }
  }

  Write-Output (@{
    preSendVisible  = $preSendVisible
    finalVisible    = $v
    everHidden      = $everHidden
    everVisible     = $everVisible
    hiddenSamples   = $hiddenSamples
    visibleSamples  = $visibleSamples
    samples         = $samples
    sends           = $sends
  } | ConvertTo-Json -Compress)
  exit 0
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

function Get-State() {
  $r = New-Object Win32+RECT
  [void][Win32]::GetWindowRect($hwnd, [ref]$r)
  # 无符号化：JS 侧要按位与 WS_THICKFRAME(0x40000)，带符号的 int 也能算，但输出成无符号更好读
  $style = [uint32]([uint32][Win32]::GetWindowLong($hwnd, $GWL_STYLE))
  $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  @{
    running = $true
    hwnd    = [int64]$hwnd
    iconic  = [Win32]::IsIconic($hwnd)
    visible = [Win32]::IsWindowVisible($hwnd)
    style   = $style
    work    = @{ x = $wa.X; y = $wa.Y; w = $wa.Width; h = $wa.Height }
    rect    = @{ x = $r.Left; y = $r.Top; w = ($r.Right - $r.Left); h = ($r.Bottom - $r.Top) }
  }
}

if ($State) {
  if ($hwnd -eq [IntPtr]::Zero) {
    Write-Output (@{ running = $false } | ConvertTo-Json -Compress)
    exit 1
  }
  Write-Output ((Get-State) | ConvertTo-Json -Compress)
  exit 0
}

# ---------------------------------------------------------------- 高频轮询
# 为什么必须在这里轮、而不是让 JS 每 150ms 起一次 PowerShell 来轮：
#
# 每次起一个 powershell.exe 要 1.3–2.0 秒（实测，含 CLR 启动 + Add-Type 编译 C# 类型）。
# JS 侧那个 `step = 150` 的轮询，实际采样间隔是 1.5 秒上下 —— 名义 8 秒的窗口
# 实际只拿到 5 个样本。而窗口动画（最小化 / 最大化 / 还原）是**几百毫秒的瞬态**：
# 5 个样本里能不能恰好落在动画之后，全靠运气。实测「点关闭藏进托盘」和
# 「夹取后居中」这两条就是这么成对红的 —— 有时读到动画途中的 -32000 垃圾矩形，
# 有时错过瞬态直接读旧值。
#
# 所以：一次 PowerShell 进程内按 -StepMs 高频轮询，命中即返回。
# 40ms 一步，8 秒窗口内 200 个样本，瞬态必然被抓住。
#
# 谓词名（-Until）刻意用命名 token 而不是表达式：PowerShell 里 eval 字符串既慢又危险，
# 而实际需要的谓词只有下面这几种，列出来比 eval 更能一眼看出测的是什么。
if ($Until) {
  if ($hwnd -eq [IntPtr]::Zero) {
    Write-Output (@{ running = $false; hit = $false } | ConvertTo-Json -Compress)
    exit 1
  }

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $last = $null
  $hit = $false
  while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
    if (-not [Win32]::IsWindow($hwnd)) { break }   # 窗口没了（真退出了）：立刻停，别再空转
    $s = Get-State
    $last = $s
    $r = $s.rect
    $ok = switch ($Until) {
      'iconic'    { $s.iconic }
      'visible'   { $s.visible }
      'hidden'    { (-not $s.visible) -and (-not $s.iconic) }
      # 铺满工作区：两轴都贴到工作区，且比 MinW 更宽（排除「本来就等于工作区」的巧合）
      'maximized' { [Math]::Abs($r.w - $s.work.w) -le $Tol -and [Math]::Abs($r.h - $s.work.h) -le $Tol -and $r.w -gt $MinW }
      # 回到某个已知尺寸：给 TargetW/TargetH，±Tol 像素
      'size'      { [Math]::Abs($r.w - $TargetW) -le $Tol -and [Math]::Abs($r.h - $TargetH) -le $Tol }
      'closed'    { -not [Win32]::IsWindow($hwnd) }
      default     { throw "未知的 -Until 谓词：$Until" }
    }
    if ($ok) { $hit = $true; break }
    Start-Sleep -Milliseconds $StepMs
  }
  if ($last) {
    $last['hit'] = $hit
    $last['waitedMs'] = [int]$sw.ElapsedMilliseconds
    $last['samples'] = [int]([Math]::Floor($sw.ElapsedMilliseconds / $StepMs)) + 1
    Write-Output ($last | ConvertTo-Json -Compress)
  } else {
    Write-Output (@{ running = $false; hit = $false; waitedMs = [int]$sw.ElapsedMilliseconds } | ConvertTo-Json -Compress)
  }
  if ($hit) { exit 0 } else { exit 3 }
}

if ($Restore) {
  if ($hwnd -eq [IntPtr]::Zero) { Write-Error "找不到窗口（ProcId=$ProcId 进程名=$Process）"; exit 2 }
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
