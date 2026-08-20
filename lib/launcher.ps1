# dsh-notify launcher (Windows PowerShell 5.1).
# Registered as the "dshnotify" protocol handler. Invoked by the OS as:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "launcher.ps1" "%1"
# It decodes the target URL from dshnotify://open?u=<encoded> and tries, in order:
#   A) navigate an already-open DSH tab via Chrome DevTools Protocol (WebSocket);
#   B) focus an already-open DSH window via Win32 P/Invoke;
#   C) open the target URL in the default browser (Start-Process).
# Every failure degrades silently. The click must never do nothing.
param(
  [Parameter(Mandatory = $true)][string]$ProtocolArgs
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Trace {
  param([string]$Message)
  try {
    $dir = Join-Path $env:TEMP "dsh-notify"
    if (-not (Test-Path $dir)) { New-Item -Path $dir -ItemType Directory -Force | Out-Null }
    $line = (Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff") + " " + $Message
    Add-Content -Path (Join-Path $dir "launcher.log") -Value $line -Encoding UTF8
  } catch {
    # diagnostics must never break the flow
  }
}

function Send-WebSocketJson {
  # Synchronously sends a JSON string over a Chrome DevTools Protocol WebSocket
  # and waits briefly for an ack frame. Returns $true on successful send.
  param(
    [string]$WsUrl,
    [string]$Json,
    [int]$TimeoutMs = 2000
  )
  try {
    $ws = [System.Net.WebSockets.ClientWebSocket]::new()
    $ct = [System.Threading.CancellationToken]::None
    $connectTask = $ws.ConnectAsync($WsUrl, $ct)
    $connectTask.Wait($TimeoutMs)
    if ($ws.State -ne [System.Net.WebSockets.WebSocketState]::Open) {
      try { $ws.Dispose() } catch {}
      return $false
    }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Json)
    $seg = New-Object System.ArraySegment[byte] (, $bytes)
    $sendTask = $ws.SendAsync($seg, [System.Net.WebSockets.WebMessageType]::Text, $true, $ct)
    $sendTask.Wait($TimeoutMs)
    if (-not $sendTask.IsCompletedSuccessfully) {
      try { $ws.Dispose() } catch {}
      return $false
    }
    # Best-effort ack read so the frame is flushed before we close.
    $buf = New-Object byte[] 4096
    $recvSeg = New-Object System.ArraySegment[byte] (, $buf)
    $recvTask = $ws.ReceiveAsync($recvSeg, $ct)
    if ($recvTask.Wait($TimeoutMs)) {
      $ackBytes = $recvSeg.Array[0..($recvTask.Result.Count - 1)]
      Write-Trace ("[cdp] ack=" + [System.Convert]::ToBase64String($ackBytes))
    }
    try { $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "ok", $ct).Wait($TimeoutMs) } catch {}
    try { $ws.Dispose() } catch {}
    return $true
  } catch {
    Write-Trace ("[fail step] Send-WebSocketJson: " + $_.Exception.Message)
    try { if ($ws -ne $null) { $ws.Dispose() } } catch {}
    return $false
  }
}

function Invoke-CdpNavigate {
  # Tries CDP on the standard debug ports plus any port discovered from a
  # running chrome.exe command line. Returns $true if it navigated a page.
  param([string]$TargetUrl, [string]$HostPort)
  $ports = @(9222, 9223, 9229)
  try {
    $procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue
    foreach ($p in $procs) {
      if ($p.CommandLine -match "--remote-debugging-port=(\d+)") {
        $ports += [int]$Matches[1]
      }
    }
  } catch {}
  $ports = $ports | Sort-Object -Unique

  foreach ($port in $ports) {
    try {
      $ver = $null
      try {
        $ver = Invoke-WebRequest -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 1 -UseBasicParsing
      } catch {}
      if ($ver -eq $null) { continue }
      $list = Invoke-WebRequest -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 1 -UseBasicParsing
      $targets = $list.Content | ConvertFrom-Json
      $hit = $null
      foreach ($t in $targets) {
        if ($t.type -eq "page" -and $t.url -match [regex]::Escape($HostPort)) {
          $hit = $t
          break
        }
      }
      if ($hit -eq $null) { continue }
      $wsUrl = "ws://127.0.0.1:$port/devtools/page/$($hit.id)"
      $json = '{"id":1,"method":"Page.navigate","params":{"url":"' + $TargetUrl.Replace('\', '\\').Replace('"', '\"') + '"}}'
      Write-Trace ("[cdp] navigate target id=" + $hit.id + " port=" + $port)
      if (Send-WebSocketJson -WsUrl $wsUrl -Json $json) {
        return $true
      }
    } catch {
      Write-Trace ("[fail step] Invoke-CdpNavigate port=$port : " + $_.Exception.Message)
    }
  }
  return $false
}

# Win32 P/Invoke type compiled once for Step B.
$win32Source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class Win32WindowFinder {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);

  public static List<IntPtr> Find(string className, HashSet<int> pids, string titleCue, string[] matchTitles) {
    var result = new List<IntPtr>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      try {
        if (!IsWindowVisible(hWnd)) return true;
        var cls = new StringBuilder(256);
        GetClassName(hWnd, cls, cls.Capacity);
        if (cls.ToString() != className) return true;
        int pid;
        GetWindowThreadProcessId(hWnd, out pid);
        if (!pids.Contains(pid)) return true;
        var title = new StringBuilder(512);
        GetWindowText(hWnd, title, title.Capacity);
        var t = title.ToString();
        bool titleOk = false;
        foreach (var mt in matchTitles) { if (t.Contains(mt)) { titleOk = true; break; } }
        if (titleOk || t.Contains(titleCue)) result.Add(hWnd);
      } catch {}
      return true;
    }, IntPtr.Zero);
    return result;
  }

  public static string GetTitle(IntPtr hWnd) {
    var sb = new StringBuilder(512);
    GetWindowText(hWnd, sb, sb.Capacity);
    return sb.ToString();
  }
}
'@

function Invoke-Win32Focus {
  # Enumerates top-level Chrome windows and focuses the best DSH candidate.
  # Returns $true if a window was focused (navigation is not possible without
  # CDP, so this is focus-only by design).
  param([string]$HostPort, [string[]]$MatchTitles)
  try {
    if (-not ("Win32WindowFinder" -as [type])) {
      Add-Type -TypeDefinition $win32Source -Language CSharp
    }
    $chromePids = New-Object System.Collections.Generic.HashSet[int]
    $procs = Get-Process chrome -ErrorAction SilentlyContinue
    foreach ($p in $procs) { [void]$chromePids.Add($p.Id) }

    $wins = [Win32WindowFinder]::Find("Chrome_WidgetWin_1", $chromePids, $HostPort, $MatchTitles)
    if ($wins -eq $null -or $wins.Count -eq 0) {
      Write-Trace ("[win32] no candidate window for " + $HostPort)
      return $false
    }
    # Prefer a window whose title contains the host:port cue.
    $best = $null
    foreach ($w in $wins) {
      $title = [Win32WindowFinder]::GetTitle($w)
      if ($title.Contains($HostPort)) { $best = $w; break }
    }
    if ($best -eq $null) { $best = $wins[0] }

    if ([Win32WindowFinder]::IsIconic($best)) {
      [void][Win32WindowFinder]::ShowWindow($best, 9)  # SW_RESTORE
    }
    $ok = [Win32WindowFinder]::SetForegroundWindow($best)
    if (-not $ok) {
      [void][Win32WindowFinder]::ShowWindow($best, 5)  # SW_SHOW
      $ok = [Win32WindowFinder]::SetForegroundWindow($best)
    }
    Write-Trace ("[win32] focused hwnd=" + $best.ToString() + " ok=" + $ok)
    return $true
  } catch {
    Write-Trace ("[fail step] Invoke-Win32Focus: " + $_.Exception.Message)
    return $false
  }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
function Main {
  Write-Trace ("[start] args='" + $ProtocolArgs + "'")

  # Space-separated args arrive as one token, but rejoin defensively.
  $raw = $ProtocolArgs
  if ($args -and $args.Count -gt 0) {
    $raw = (@($ProtocolArgs) + $args) -join " "
  }

  # Strip the scheme prefix and parse the query.
  $stripped = $raw
  if ($stripped -match "^dshnotify://") {
    $stripped = $stripped.Substring("dshnotify://".Length)
  } elseif ($stripped -match "^dshnotify:") {
    $stripped = $stripped.Substring("dshnotify:".Length)
  }
  $targetUrl = ""
  if ($stripped -match "\?u=") {
    $encoded = $stripped -split "\?u=" | Select-Object -Last 1
    try { $targetUrl = [uri]::UnescapeDataString($encoded) } catch { $targetUrl = $encoded }
  }
  if ([string]::IsNullOrWhiteSpace($targetUrl)) {
    Write-Trace ("[fail] no targetUrl parsed from '" + $raw + "'")
    return $false
  }

  # Origin info from the decoded URL (best-effort).
  $HostPort = ""
  try {
    $parsed = [Uri]$targetUrl
    $HostPort = "$($parsed.Host):$($parsed.Port)"
  } catch {
    Write-Trace ("[warn] could not parse targetUrl as Uri: " + $targetUrl)
  }
  $MatchTitles = @("DeepSeek Harness")

  $handled = $false

  # Step A: CDP navigate (best-effort, silent on any failure).
  try {
    if ($HostPort -ne "") {
      if (Invoke-CdpNavigate -TargetUrl $targetUrl -HostPort $HostPort) {
        Write-Trace ("[ok] Step A CDP navigate succeeded for " + $HostPort)
        $handled = $true
      } else {
        Write-Trace ("[step] Step A skipped/failed")
      }
    }
  } catch {
    Write-Trace ("[fail step] Step A: " + $_.Exception.Message)
  }

  # Step B: Win32 focus (best-effort, focus-only without CDP navigation).
  if (-not $handled) {
    try {
      if (Invoke-Win32Focus -HostPort $HostPort -MatchTitles $MatchTitles) {
        Write-Trace ("[ok] Step B focused existing DSH window (focus-only)")
        $handled = $true
      } else {
        Write-Trace ("[step] Step B no candidate")
      }
    } catch {
      Write-Trace ("[fail step] Step B: " + $_.Exception.Message)
    }
  }

  # Step C: fallback open in default browser. Always runs if A and B failed.
  if (-not $handled) {
    try {
      Write-Trace ("[fallback] Start-Process " + $targetUrl)
      Start-Process $targetUrl
      $handled = $true
    } catch {
      Write-Trace ("[fail step] Step C: " + $_.Exception.Message)
    }
  }

  return $handled
}

$success = $false
try {
  $success = Main
} catch {
  Write-Trace ("[fatal] " + $_.Exception.Message)
  # Last resort: try to open the URL directly.
  try {
    $m = $ProtocolArgs -match "u=([^&\s]+)"
    if ($m) {
      $u = [uri]::UnescapeDataString($Matches[1])
      Start-Process $u
      $success = $true
    }
  } catch {}
}

if ($success) {
  exit 0
} else {
  exit 1
}
