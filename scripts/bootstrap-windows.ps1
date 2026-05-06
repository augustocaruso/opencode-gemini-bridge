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

$Project = Normalize-PathArgument $Project
$Prefix = Normalize-PathArgument $Prefix

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

  $AllInstallerArgs = @()
  if ($Project) { $AllInstallerArgs += @("-Project", $Project) }
  if ($Prefix) { $AllInstallerArgs += @("-Prefix", $Prefix) }
  if ($Rulesync) { $AllInstallerArgs += @("-Rulesync", $Rulesync) }
  if ($NoSetup) { $AllInstallerArgs += "-NoSetup" }
  if ($NoUx) { $AllInstallerArgs += "-NoUx" }
  if ($NoOpenCode) { $AllInstallerArgs += "-NoOpenCode" }
  if ($Force) { $AllInstallerArgs += "-Force" }
  $AllInstallerArgs += $InstallerArgs

  & $Installer.FullName @AllInstallerArgs
} finally {
  Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}
