param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$InstallerArgs
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Installer = Join-Path $ScriptDir "artifacts\scripts\install-windows.ps1"

if (-not (Test-Path $Installer)) {
  throw "Expected installer at $Installer, but it was not found."
}

& $Installer @InstallerArgs
if ($LASTEXITCODE) {
  exit $LASTEXITCODE
}
