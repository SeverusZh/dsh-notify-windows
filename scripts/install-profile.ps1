# Deploy dsh-notify into a DSH profile and append its loader entry to the
# profile's cordis.patch.yml (idempotent). The running DSH host hot-applies
# the patch, so no restart is needed.
param(
  [string]$Profile = "web",
  [string]$ProfilesRoot = "$env:USERPROFILE\.dsh\profiles"
)
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$profileDir = Join-Path $ProfilesRoot $Profile
if (-not (Test-Path $profileDir)) { throw "profile directory not found: $profileDir" }

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

$dest = Join-Path $targetRoot "dsh-notify"
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $repoRoot "package.json") (Join-Path $dest "package.json") -Force
$destLib = Join-Path $dest "lib"
if (Test-Path $destLib) { Remove-Item $destLib -Recurse -Force }
Copy-Item (Join-Path $repoRoot "lib") $destLib -Recurse -Force
Write-Output "copied plugin to $dest"

# Append the loader entry once.
$patchFile = Join-Path $profileDir "cordis.patch.yml"
if (-not (Test-Path $patchFile)) { throw "cordis.patch.yml not found: $patchFile" }
$content = [System.IO.File]::ReadAllText($patchFile)
if ($content -match "dsh-notify") {
  Write-Output "cordis.patch.yml already contains the dsh-notify entry; skipped"
} else {
  $entry = @"
- insert:
    - id: dsh-notify
      name: 'dsh-notify'
      config:
        enabled: true
        reasons: [completed, error, max-tokens]
        includeSubagents: false
        notifyOnStart: true
        appName: 'DeepSeek Harness'
        aumid: 'DeepSeekHarness.Notify'
        log: true
"@
  $content = [regex]::Replace($content, '\[\]\s*$', $entry)
  [System.IO.File]::WriteAllText($patchFile, $content, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "patched $patchFile"
}
Write-Output "done"
