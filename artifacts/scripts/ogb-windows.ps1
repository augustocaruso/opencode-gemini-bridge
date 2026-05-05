param(
  [string]$Project = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ArtifactsDir = Split-Path -Parent $ScriptDir
$CliDir = Join-Path $ArtifactsDir "bridge-cli-skeleton"

if (Get-Command ogb -ErrorAction SilentlyContinue) {
  ogb --project $Project launch
  exit $LASTEXITCODE
}

$CliJs = Join-Path $CliDir "dist\cli.js"
if (-not (Test-Path $CliJs)) {
  npm --prefix $CliDir install
  npm --prefix $CliDir run build
}

node $CliJs --project $Project launch
