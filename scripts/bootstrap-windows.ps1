param(
  [string]$Repo = $(if ($env:OGB_GITHUB_REPO) { $env:OGB_GITHUB_REPO } else { "augustocaruso/opencode-gemini-bridge" }),
  [string]$Version = $(if ($env:OGB_RELEASE_VERSION) { $env:OGB_RELEASE_VERSION } else { "latest" }),
  [string]$Project,
  [string]$Prefix,
  [string]$Rulesync,
  [switch]$NoSetup,
  [switch]$NoUx,
  [switch]$NoOpenCode,
  [switch]$Force,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$InstallerArgs
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

function Normalize-PathArgument($Value) {
  if ($null -eq $Value) {
    return $Value
  }
  $Text = ([string]$Value).Trim()
  $Changed = $true
  while ($Changed -and $Text.Length -ge 2) {
    $Changed = $false
    $First = $Text.Substring(0, 1)
    $Last = $Text.Substring($Text.Length - 1, 1)
    if ((($First -eq '"') -and ($Last -eq '"')) -or (($First -eq "'") -and ($Last -eq "'"))) {
      $Text = $Text.Substring(1, $Text.Length - 2).Trim()
      $Changed = $true
    }
  }
  return $Text
}

function Repair-DirectoryBlocker($Dir, $Operation) {
  if (-not (Test-Path -LiteralPath $Dir)) {
    return
  }
  $Item = Get-Item -LiteralPath $Dir -Force
  if ($Item.PSIsContainer) {
    return
  }

  $Stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ss.fffZ") + "-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
  $BackupRoot = Join-Path $HOME ".config\opencode-gemini-bridge\backups\$Operation\$Stamp\home"
  $Relative = $Dir
  if ($Relative.StartsWith($HOME, [System.StringComparison]::OrdinalIgnoreCase)) {
    $Relative = $Relative.Substring($HOME.Length).TrimStart([char[]]@("\", "/"))
  }
  $BackupPath = Join-Path $BackupRoot $Relative
  New-Item -ItemType Directory -Force (Split-Path -Parent $BackupPath) | Out-Null
  Move-Item -LiteralPath $Dir -Destination $BackupPath -Force
  New-Item -ItemType Directory -Force $Dir | Out-Null
  Write-Host "Repaired file blocking OpenCode config directory: $Dir (backup: $BackupPath)"
}

function Repair-ReadOnlyDirectory($Dir, $Operation) {
  if (-not (Test-Path -LiteralPath $Dir -PathType Container)) {
    return
  }
  $Item = Get-Item -LiteralPath $Dir -Force
  if (($Item.Attributes -band [System.IO.FileAttributes]::ReadOnly) -ne 0) {
    attrib -R $Dir
    Write-Host "Cleared read-only attribute from OpenCode config directory during ${Operation}: $Dir"
  }
}

$Project = Normalize-PathArgument $Project
$Prefix = Normalize-PathArgument $Prefix
Repair-DirectoryBlocker (Join-Path $HOME ".config\opencode") "bootstrap"
Repair-ReadOnlyDirectory (Join-Path $HOME ".config\opencode") "bootstrap"

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ogb-bootstrap-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $TempDir | Out-Null

try {
  if ($Version -eq "latest") {
    $ReleaseUrl = "https://github.com/$Repo/releases/latest/download/opencode-gemini-bridge-pack.zip"
  } else {
    $ReleaseUrl = "https://github.com/$Repo/releases/download/$Version/opencode-gemini-bridge-pack.zip"
  }

  $ZipPath = Join-Path $TempDir "ogb.zip"
  $UnpackDir = Join-Path $TempDir "unpacked"

  Write-Host "Downloading OGB from $ReleaseUrl..."
  Invoke-WebRequest -Uri $ReleaseUrl -OutFile $ZipPath
  Expand-Archive -Path $ZipPath -DestinationPath $UnpackDir -Force

  $Installer = Get-ChildItem -Path $UnpackDir -Recurse -Filter install-windows.ps1 |
    Where-Object { $_.FullName -match "\\scripts\\install-windows\.ps1$" } |
    Select-Object -First 1

  if (-not $Installer) {
    throw "Release pack did not contain scripts/install-windows.ps1."
  }

  $InstallerParams = @{}
  if ($Project) { $InstallerParams["Project"] = $Project }
  if ($Prefix) { $InstallerParams["Prefix"] = $Prefix }
  if ($Rulesync) { $InstallerParams["Rulesync"] = $Rulesync }
  if ($NoSetup) { $InstallerParams["NoSetup"] = $true }
  if ($NoUx) { $InstallerParams["NoUx"] = $true }
  if ($NoOpenCode) { $InstallerParams["NoOpenCode"] = $true }
  if ($Force) { $InstallerParams["Force"] = $true }

  if ($InstallerArgs -and $InstallerArgs.Count -gt 0) {
    & $Installer.FullName @InstallerParams @InstallerArgs
  } else {
    & $Installer.FullName @InstallerParams
  }
} finally {
  Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}
