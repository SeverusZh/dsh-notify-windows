# Deploy dsh-notify into a DSH profile and append its loader entry to the
# profile's cordis.patch.yml (idempotent). The running DSH host hot-applies
# the patch, so no restart is needed. The package is deployed to a
# version-suffixed directory (dsh-notify-<version>) so a redeploy changes the
# module URL and the live host loads the fresh code instead of its cached copy.
param(
  [string]$Profile = "web",
  [string]$ProfilesRoot = "$env:USERPROFILE\.dsh\profiles",
  [string]$Version = ""
)
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$profileDir = Join-Path $ProfilesRoot $Profile
if (-not (Test-Path $profileDir)) { throw "profile directory not found: $profileDir" }

if (-not $Version) {
  $pkgJson = Get-Content (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
  $Version = $pkgJson.version
}
$pkgDirName = $pkgJson.name + "-" + $Version

# Prefer the profile's own node_modules; fall back to the hoisted sibling at
# the profiles root (where this machine hoists all profile dependencies).
$candidates = @(
  (Join-Path $profileDir "node_modules"),
  (Join-Path $ProfilesRoot "node_modules")
)
$targetRoot = $null
foreach ($dir in $candidates) {
  if (Test-Path $dir) { $targetRoot = $dir; break }
}
if ($null -eq $targetRoot) {
  $targetRoot = Join-Path $profileDir "node_modules"
  New-Item -ItemType Directory -Force $targetRoot | Out-Null
}

$dest = Join-Path $targetRoot $pkgDirName
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $repoRoot "package.json") (Join-Path $dest "package.json") -Force
$destLib = Join-Path $dest "lib"
if (Test-Path $destLib) { Remove-Item $destLib -Recurse -Force }
Copy-Item (Join-Path $repoRoot "lib") $destLib -Recurse -Force
Write-Output "copied plugin to $dest"

# Drop stale deployments of this plugin (unsuffixed legacy dir and old
# versioned dirs) so only the current versioned dir remains.
$stale = Get-ChildItem $targetRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "^(dsh-notify|dsh-notify-windows)(-\d|\.|$)" -and $_.Name -ne $pkgDirName }
foreach ($dir in $stale) {
  Remove-Item $dir.FullName -Recurse -Force
  Write-Output ("removed stale deployment " + $dir.FullName)
}

# Append the loader entry once, or refresh its module name on redeploy.
$patchFile = Join-Path $profileDir "cordis.patch.yml"
if (-not (Test-Path $patchFile)) { throw "cordis.patch.yml not found: $patchFile" }
$content = [System.IO.File]::ReadAllText($patchFile)
if ($content -match "id: dsh-notify") {
  $content = [regex]::Replace($content, "(name:\s*)'dsh-notify[^']*'", "`${1}'$pkgDirName'", 1)
  [System.IO.File]::WriteAllText($patchFile, $content, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "updated entry name to $pkgDirName in $patchFile"
} else {
  $entry = @"
- insert:
    - id: dsh-notify
      name: '$pkgDirName'
      config:
        enabled: true
        reasons: [completed, error, max-tokens]
        includeSubagents: false
        notifyOnStart: true
        notifyOnApproval: true
        notifyOnAskUser: true
        appName: 'DeepSeek Harness'
        aumid: 'DeepSeekHarness.Notify'
        log: true
"@
  $content = [regex]::Replace($content, '\[\]\s*$', $entry)
  [System.IO.File]::WriteAllText($patchFile, $content, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "patched $patchFile"
}
Write-Output "done"