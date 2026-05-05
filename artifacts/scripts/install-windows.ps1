param(
  [string]$Project = (Get-Location).Path,
  [string]$Prefix = $(if ($env:OGB_PREFIX) { $env:OGB_PREFIX } else { Join-Path $HOME ".local" }),
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

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ArtifactsDir = Split-Path -Parent $ScriptDir
$CliDir = Join-Path $ArtifactsDir "bridge-cli-skeleton"

Require-Command "node"
Require-Command "npm"

New-Item -ItemType Directory -Force (Join-Path $HOME ".config\opencode") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $HOME ".agents\skills") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $HOME ".ai\opencode-pack") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $Prefix "bin") | Out-Null

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

$PrefixBin = Join-Path $Prefix "bin"
if (($env:Path -split ";") -notcontains $PrefixBin) {
  Write-Host "Note: add $PrefixBin to PATH to run ogb directly."
}

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
