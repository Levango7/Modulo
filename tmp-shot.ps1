Add-Type -AssemblyName System.Drawing, System.Windows.Forms

$out = 'F:\Nexus\Modulo\evidence'
New-Item -ItemType Directory -Force -Path $out | Out-Null

# 等主窗口句柄与尺寸就位（不看标题，Modulo 主窗口标题就是产品名）
$proc = $null
for ($i = 0; $i -lt 40; $i++) {
  $proc = Get-Process modulo -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($proc) { break }
  Start-Sleep -Milliseconds 500
}
if (-not $proc) { throw '主窗口未出现' }

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
'@

$h = $proc.MainWindowHandle
[W]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 800

$r = New-Object W+RECT
[W]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L; $ht = $r.B - $r.T
Write-Output "窗口尺寸 ${w}x${ht} @ ($($r.L),$($r.T))"

if ($w -lt 400 -or $ht -lt 300) { throw "窗口太小($w x $ht)，拒绝截图（避免截到 4x4 辅助窗口）" }

$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$path = Join-Path $out 'live-0.8.0.png'
$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "已保存 $path ($([math]::Round((Get-Item $path).Length/1KB,1)) KB)"