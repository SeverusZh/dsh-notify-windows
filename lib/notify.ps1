# dsh-notify toast sender (Windows PowerShell 5.1 required: WinRT projection).
# Parameters are bound by PowerShell from the process argument vector, so this
# file stays ASCII-only and needs no BOM.
param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$Body,
  [string]$Aumid = "DeepSeekHarness.Notify",
  [string]$AppName = "DeepSeek Harness",
  [string]$Url = "",
  [int]$LaunchProtocol = 1   # 1 = route via dshnotify:// launcher (prefer existing); 0 = open targetUrl directly
)
$ErrorActionPreference = "Stop"

# Register the AppUserModelId once under HKCU so Win32 toasts are allowed.
# Best effort: if the write is denied we still try to show the toast below.
$key = "HKCU:\SOFTWARE\Classes\AppUserModelId\$Aumid"
try {
  if (-not (Test-Path $key)) {
    New-Item -Path $key -Force | Out-Null
    New-ItemProperty -Path $key -Name DisplayName -Value $AppName -PropertyType String -Force | Out-Null
  }
} catch {
  Write-Warning ("AUMID registration failed: " + $_.Exception.Message)
}

# Project the WinRT toast API (supported natively by .NET Framework).
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null

# Optional clickable activation: when $Url is set we make the toast open a URL
# on click. Best effort - any failure here degrades gracefully (either to a
# direct protocol activation or to a plain non-clickable toast) and never
# aborts the Show below.
$clickable = $false
$launchValue = ""
if ($Url -ne "") {
  try {
    if ($LaunchProtocol -eq 1) {
      # Register the dshnotify:// protocol handler idempotently (best effort).
      try {
        $progId = "HKCU:\Software\Classes\dshnotify"
        if (-not (Test-Path $progId)) {
          New-Item -Path $progId -Force | Out-Null
        }
        # Default (unnamed) value names the protocol.
        Set-Item -Path $progId -Value 'dshnotify' -Force
        # "URL Protocol" marker value (presence marks the key as a protocol handler).
        Set-ItemProperty -Path $progId -Name 'URL Protocol' -Value '' -Force
        $cmdKey = "HKCU:\Software\Classes\dshnotify\shell\open\command"
        if (-not (Test-Path $cmdKey)) {
          New-Item -Path $cmdKey -Force | Out-Null
        }
        $launcherPath = Join-Path $PSScriptRoot "launcher.ps1"
        $command = ('"powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcherPath + '" "%1"')
        Set-Item -Path $cmdKey -Value $command -Force
      } catch {
        Write-Warning ("dshnotify protocol registration failed, falling back to direct URL: " + $_.Exception.Message)
        # Fall back to direct-URL activation for this toast.
        $LaunchProtocol = 0
      }
    }

    if ($LaunchProtocol -eq 1) {
      $launchValue = ("dshnotify://open?u=" + [uri]::EscapeDataString($Url))
    } else {
      $launchValue = $Url
    }
    $clickable = $true
  } catch {
    Write-Warning ("Toast activation setup failed, showing plain toast: " + $_.Exception.Message)
    $clickable = $false
  }
}

$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $xml.GetElementsByTagName("text")
$texts.Item(0).AppendChild($xml.CreateTextNode($Title)) | Out-Null
$texts.Item(1).AppendChild($xml.CreateTextNode($Body)) | Out-Null

if ($clickable) {
  try {
    $root = $xml.DocumentElement
    if ($root.Name -eq "toast") {
      $root.SetAttribute("activationType", "protocol") | Out-Null
      $root.SetAttribute("duration", "long") | Out-Null
      $root.SetAttribute("launch", $launchValue) | Out-Null
      # Optional explicit audio cue.
      $audio = $xml.CreateElement("audio")
      $audio.SetAttribute("src", "ms-winsoundevent:Notification.Default") | Out-Null
      $root.AppendChild($audio) | Out-Null
    }
  } catch {
    Write-Warning ("Failed to attach activation attributes: " + $_.Exception.Message)
  }
}

$toast = New-Object Windows.UI.Notifications.ToastNotification($xml)
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Aumid)
$notifier.Show($toast)
Write-Output "toast shown"
