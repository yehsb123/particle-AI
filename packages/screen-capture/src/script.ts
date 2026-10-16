/**
 * The script that takes one picture of one window, through Windows' own API.
 *
 * It is PowerShell for the same reason the desktop agent's window reader is: that is how this
 * repository reaches a Windows API without taking a native dependency, and a native screen-capture
 * module is exactly the kind of thing whose licence would have to be argued about one package at a
 * time. Everything it uses ships with Windows — user32 for the window, System.Drawing for the
 * bitmap — so the default capture path in this repository carries no third-party licence at all.
 *
 * The drawing call is PrintWindow with PW_RENDERFULLCONTENT (2). The older way to photograph a
 * window is to copy the screen where it happens to be, which copies whatever is on top of it and
 * fails outright when the window is behind another one. PrintWindow asks the window to draw
 * itself, so a window that is not in front still produces its own picture. The flag is what makes
 * that work for windows the desktop compositor draws, which since Windows 8 is all of them.
 *
 * The script takes nothing by interpolation. The window to point at and the file to write arrive
 * as environment variables, so no caller's text is ever part of a statement this machine runs.
 */
const SCRIPT_LINES: readonly string[] = [
  // the window titles on this desktop are not ASCII; without this they come back as question marks
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "$ErrorActionPreference = 'Stop'",
  "function Write-Capture($o) { Write-Output ($o | ConvertTo-Json -Compress) }",
  "try {",
  "  Add-Type -AssemblyName System.Drawing",
  "  Add-Type -TypeDefinition @\"",
  "using System;",
  "using System.Text;",
  "using System.Runtime.InteropServices;",
  "public class ParticleCapture {",
  "  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }",
  "  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);",
  "  [DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);",
  "  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
  "  [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr hwnd);",
  "  [DllImport(\"user32.dll\")] public static extern bool IsIconic(IntPtr hwnd);",
  "  [DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);",
  "  [DllImport(\"user32.dll\")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);",
  "  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);",
  "  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hwnd);",
  "  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);",
  "  public static string TitleOf(IntPtr hwnd) {",
  "    int n = GetWindowTextLength(hwnd);",
  "    if (n <= 0) return \"\";",
  "    StringBuilder sb = new StringBuilder(n + 1);",
  "    GetWindowText(hwnd, sb, sb.Capacity);",
  "    return sb.ToString();",
  "  }",
  "}",
  "\"@",
  "  $target = $env:DM_CAPTURE_TARGET",
  "  $wanted = $env:DM_CAPTURE_APP",
  "  $file = $env:DM_CAPTURE_PATH",
  "  $hwnd = [IntPtr]::Zero",
  "  $reason = ''",
  "  if (-not $file) { $reason = 'no file to write was named' }",
  "  elseif ($target -eq 'foreground') { $hwnd = [ParticleCapture]::GetForegroundWindow() }",
  "  elseif ($target -eq 'app') {",
  "    $seen = New-Object System.Collections.ArrayList",
  "    $walk = [ParticleCapture+EnumProc]{",
  "      param([IntPtr]$h, [IntPtr]$lp)",
  "      if ([ParticleCapture]::IsWindowVisible($h) -and -not [ParticleCapture]::IsIconic($h)) {",
  "        $owner = 0",
  "        [void][ParticleCapture]::GetWindowThreadProcessId($h, [ref]$owner)",
  "        $proc = Get-Process -Id $owner -ErrorAction SilentlyContinue",
  "        if ($proc -and $proc.ProcessName -eq $wanted -and [ParticleCapture]::TitleOf($h) -ne '') {",
  "          $r = New-Object ParticleCapture+RECT",
  "          [void][ParticleCapture]::GetWindowRect($h, [ref]$r)",
  "          $w = $r.Right - $r.Left",
  "          $ht = $r.Bottom - $r.Top",
  // a program keeps internal windows that are visible and not minimised but are 0x0 or 1x1;
  // picking the biggest of only those drew a one pixel picture and called it a capture
  "          if ($w -ge 32 -and $ht -ge 32) {",
  "            [void]$seen.Add([pscustomobject]@{ H = $h; Area = ($w * $ht) })",
  "          }",
  "        }",
  "      }",
  "      return $true",
  "    }",
  "    [void][ParticleCapture]::EnumWindows($walk, [IntPtr]::Zero)",
  // a program can own several windows; the biggest one is the one somebody works in
  "    $pick = $seen | Sort-Object Area -Descending | Select-Object -First 1",
  "    if ($pick) { $hwnd = $pick.H } else { $reason = 'that program has no window open big enough to draw; it may be minimised' }",
  "  }",
  "  else { $reason = 'the window to point at was not named' }",
  "  if (-not $reason -and $hwnd -eq [IntPtr]::Zero) { $reason = 'there is no window in front' }",
  "  if (-not $reason -and [ParticleCapture]::IsIconic($hwnd)) { $reason = 'that window is minimised and has nothing to draw' }",
  "  if (-not $reason) {",
  "    $rect = New-Object ParticleCapture+RECT",
  "    [void][ParticleCapture]::GetWindowRect($hwnd, [ref]$rect)",
  "    $w = $rect.Right - $rect.Left",
  "    $h2 = $rect.Bottom - $rect.Top",
  "    if ($w -lt 1 -or $h2 -lt 1) { $reason = 'that window has no size on screen' }",
  "    else {",
  "      $owner2 = 0",
  "      [void][ParticleCapture]::GetWindowThreadProcessId($hwnd, [ref]$owner2)",
  "      $op = Get-Process -Id $owner2 -ErrorAction SilentlyContinue",
  "      $appName = ''",
  "      if ($op) { $appName = $op.ProcessName }",
  "      $title = [ParticleCapture]::TitleOf($hwnd)",
  "      $bmp = New-Object System.Drawing.Bitmap($w, $h2)",
  "      $gfx = [System.Drawing.Graphics]::FromImage($bmp)",
  "      $hdc = $gfx.GetHdc()",
  // 2 is PW_RENDERFULLCONTENT: ask the window to draw itself the way the compositor draws it
  "      $drew = [ParticleCapture]::PrintWindow($hwnd, $hdc, 2)",
  "      $gfx.ReleaseHdc($hdc)",
  "      $gfx.Dispose()",
  "      if ($drew) {",
  "        $dir = Split-Path -Parent $file",
  "        if ($dir -and -not (Test-Path $dir)) { [void](New-Item -ItemType Directory -Force -Path $dir) }",
  "        $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)",
  "        Write-Capture @{ ok = $true; app = $appName; window = $title; width = $bmp.Width; height = $bmp.Height; path = $file }",
  "      } else { $reason = 'that window refused to draw itself' }",
  "      $bmp.Dispose()",
  "    }",
  "  }",
  "  if ($reason) { Write-Capture @{ ok = $false; reason = $reason } }",
  "} catch {",
  "  Write-Capture @{ ok = $false; reason = $_.Exception.Message }",
  "}",
];

/** The capture script, which is the same every time: it carries no caller's text. */
export function captureScript(): string {
  return SCRIPT_LINES.join("\n");
}
