param(
  [string]$Project = (Get-Location).Path,
  [string]$Prefix = $(if ($env:OGB_PREFIX) { $env:OGB_PREFIX } else { "" }),
  [string]$Rulesync = "auto",
  [switch]$NoSetup,
  [switch]$NoUx,
  [switch]$NoOpenCode,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required before installing ogb."
  }
}

function Resolve-DefaultPrefix {
  $NpmPrefix = ""
  try {
    $NpmPrefix = (& npm prefix -g 2>$null)
  } catch {
    $NpmPrefix = ""
  }
  if ($NpmPrefix) {
    return $NpmPrefix.Trim()
  }
  if ($env:APPDATA) {
    return Join-Path $env:APPDATA "npm"
  }
  return Join-Path $HOME "AppData\Roaming\npm"
}

function Normalize-PathForCompare($PathValue) {
  try {
    return [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($PathValue))
  } catch {
    return $PathValue
  }
}

function Add-UserPath($Dir) {
  if (-not $Dir) {
    return
  }
  $FullDir = Normalize-PathForCompare $Dir
  $CurrentParts = @($env:Path -split ";" | Where-Object { $_ })
  if (($CurrentParts | ForEach-Object { Normalize-PathForCompare $_ }) -notcontains $FullDir) {
    $env:Path = "$FullDir;$env:Path"
  }

  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $UserParts = @($UserPath -split ";" | Where-Object { $_ })
  if (($UserParts | ForEach-Object { Normalize-PathForCompare $_ }) -notcontains $FullDir) {
    $NextUserPath = if ($UserPath) { "$FullDir;$UserPath" } else { $FullDir }
    [Environment]::SetEnvironmentVariable("Path", $NextUserPath, "User")
    Write-Host "Added $FullDir to your user PATH. Open a new terminal to use ogb directly."
  }
}

function Remove-UserPath($Dir) {
  if (-not $Dir) {
    return
  }
  $FullDir = Normalize-PathForCompare $Dir
  $env:Path = (@($env:Path -split ";" | Where-Object {
    $_ -and ((Normalize-PathForCompare $_) -ne $FullDir)
  }) -join ";")

  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $NextUserPath = (@($UserPath -split ";" | Where-Object {
    $_ -and ((Normalize-PathForCompare $_) -ne $FullDir)
  }) -join ";")
  if ($NextUserPath -ne $UserPath) {
    [Environment]::SetEnvironmentVariable("Path", $NextUserPath, "User")
    Write-Host "Removed broken PATH entry: $FullDir"
  }
}

function Repair-BrokenForceInstall {
  $BrokenPrefix = Join-Path $HOME "-Force"
  $BrokenShim = Join-Path $BrokenPrefix "ogb.cmd"
  $BrokenPackage = Join-Path $BrokenPrefix "node_modules\opencode-gemini-bridge"
  if ((Test-Path $BrokenShim) -or (Test-Path $BrokenPackage)) {
    Remove-UserPath $BrokenPrefix
    Remove-Item -Recurse -Force $BrokenPrefix -ErrorAction SilentlyContinue
  }
}

function Install-StableCli($SourceDir, $InstallDir) {
  Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $InstallDir | Out-Null

  Copy-Item -Path (Join-Path $SourceDir "package.json") -Destination $InstallDir -Force
  Copy-Item -Path (Join-Path $SourceDir "package-lock.json") -Destination $InstallDir -Force
  if (Test-Path (Join-Path $SourceDir "LICENSE")) {
    Copy-Item -Path (Join-Path $SourceDir "LICENSE") -Destination $InstallDir -Force
  }
  Copy-Item -Path (Join-Path $SourceDir "dist") -Destination (Join-Path $InstallDir "dist") -Recurse -Force

  npm --prefix $InstallDir install --omit=dev
  $CliTarget = Join-Path $InstallDir "dist\cli.js"
  if (-not (Test-Path $CliTarget)) {
    throw "Expected built CLI at $CliTarget, but it was not found."
  }
  return $CliTarget
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ArtifactsDir = Split-Path -Parent $ScriptDir
$CliDir = Join-Path $ArtifactsDir "bridge-cli-skeleton"

Require-Command "node"
Require-Command "npm"

if ((-not $Prefix) -or $Prefix.Trim().StartsWith("-")) {
  $Prefix = Resolve-DefaultPrefix
}

Repair-BrokenForceInstall

New-Item -ItemType Directory -Force (Join-Path $HOME ".config\opencode") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $HOME ".agents\skills") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $HOME ".ai\opencode-pack") | Out-Null
New-Item -ItemType Directory -Force $Prefix | Out-Null

Write-Host "Building ogb CLI..."
npm --prefix $CliDir install
npm --prefix $CliDir run build

Write-Host "Installing ogb into a stable local folder..."
$CliInstallDir = Join-Path (Join-Path $HOME ".ai\opencode-pack") "opencode-gemini-bridge-cli"
$CliTarget = Install-StableCli $CliDir $CliInstallDir

Write-Host "Registering ogb command in $Prefix..."
Remove-Item -Force (Join-Path $Prefix "ogb") -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path $Prefix "ogb.cmd") -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path $Prefix "ogb.ps1") -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $Prefix "node_modules\opencode-gemini-bridge") -ErrorAction SilentlyContinue

$OgbBin = Join-Path $Prefix "ogb.cmd"
"@ECHO off`r`nnode `"$CliTarget`" %*`r`n" | Set-Content -Path $OgbBin -Encoding ASCII

if (-not (Test-Path $OgbBin)) {
  throw "Expected ogb.cmd under $Prefix, but it was not found."
}

& $OgbBin --version | Out-Null

$OgbBinDir = Split-Path -Parent $OgbBin
Add-UserPath $OgbBinDir

if (-not $NoUx) {
  $UxArgs = @("--project", $Project, "setup-ux")
  if ($NoOpenCode) {
    $UxArgs += "--no-install-opencode"
  }
  if ($Force) {
    $UxArgs += "--force"
  }
  Write-Host "Installing OpenCode and the OGB UX profile..."
  & $OgbBin @UxArgs
}

if (-not $NoSetup) {
  $ImportArgs = @("--project", $Project, "import", "--rulesync", $Rulesync)
  $SetupArgs = @("--project", $Project, "setup-opencode", "--skip-doctor")
  if ($Force) {
    $ImportArgs += "--force"
    $SetupArgs += "--force"
  }
  Write-Host "Running ogb import for $Project..."
  & $OgbBin @ImportArgs
  Write-Host "Installing OpenCode startup plugin for $Project..."
  & $OgbBin @SetupArgs
  Write-Host "Running final doctor for $Project..."
  & $OgbBin --project $Project doctor
  Write-Host "Running final validation for $Project..."
  & $OgbBin --project $Project validate --windows
  Write-Host "Running final security check for $Project..."
  & $OgbBin --project $Project security-check
  Write-Host "Writing final dashboard for $Project..."
  & $OgbBin --project $Project dashboard
}

Write-Host "Done."
Write-Host "Try: $OgbBin --project `"$Project`" doctor"
