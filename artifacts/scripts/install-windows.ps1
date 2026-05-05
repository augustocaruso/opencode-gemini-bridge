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

function Add-UserPath($Dir) {
  if (-not $Dir) {
    return
  }
  $FullDir = [System.IO.Path]::GetFullPath($Dir)
  $CurrentParts = @($env:Path -split ";" | Where-Object { $_ })
  if ($CurrentParts -notcontains $FullDir) {
    $env:Path = "$FullDir;$env:Path"
  }

  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $UserParts = @($UserPath -split ";" | Where-Object { $_ })
  if ($UserParts -notcontains $FullDir) {
    $NextUserPath = if ($UserPath) { "$FullDir;$UserPath" } else { $FullDir }
    [Environment]::SetEnvironmentVariable("Path", $NextUserPath, "User")
    Write-Host "Added $FullDir to your user PATH. Open a new terminal to use ogb directly."
  }
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ArtifactsDir = Split-Path -Parent $ScriptDir
$CliDir = Join-Path $ArtifactsDir "bridge-cli-skeleton"

Require-Command "node"
Require-Command "npm"

if (-not $Prefix) {
  $Prefix = Resolve-DefaultPrefix
}

New-Item -ItemType Directory -Force (Join-Path $HOME ".config\opencode") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $HOME ".agents\skills") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $HOME ".ai\opencode-pack") | Out-Null
New-Item -ItemType Directory -Force $Prefix | Out-Null

Write-Host "Building ogb CLI..."
npm --prefix $CliDir install
npm --prefix $CliDir run build

Write-Host "Installing ogb into $Prefix..."
npm install --prefix $Prefix -g $CliDir

$OgbBin = Join-Path $Prefix "ogb.cmd"
if (-not (Test-Path $OgbBin)) {
  $OgbBin = Join-Path (Join-Path $Prefix "bin") "ogb.cmd"
}
if (-not (Test-Path $OgbBin)) {
  Write-Host "ogb command shim was not created; retrying npm install with --force..."
  npm install --prefix $Prefix -g $CliDir --force
  $OgbBin = Join-Path $Prefix "ogb.cmd"
  if (-not (Test-Path $OgbBin)) {
    $OgbBin = Join-Path (Join-Path $Prefix "bin") "ogb.cmd"
  }
}
if (-not (Test-Path $OgbBin)) {
  $GlobalRoot = (& npm --prefix $Prefix root -g)
  $CliTarget = Join-Path $GlobalRoot "opencode-gemini-bridge\dist\cli.js"
  if (Test-Path $CliTarget) {
    $PrefixBin = Join-Path $Prefix "bin"
    New-Item -ItemType Directory -Force $PrefixBin | Out-Null
    $OgbBin = Join-Path $PrefixBin "ogb.cmd"
    "@ECHO off`r`nnode `"$CliTarget`" %*`r`n" | Set-Content -Path $OgbBin -Encoding ASCII
  }
}
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
