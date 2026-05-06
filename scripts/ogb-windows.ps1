param(
  [string]$Project = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$CliDir = Join-Path (Join-Path $RepoRoot "packages") "ogb"

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
