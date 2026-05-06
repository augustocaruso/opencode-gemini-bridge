param(
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

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Installer = Join-Path $ScriptDir "scripts\install-windows.ps1"

if (-not (Test-Path $Installer)) {
  throw "Expected installer at $Installer, but it was not found."
}

$AllInstallerArgs = @()
if ($PSBoundParameters.ContainsKey("Project")) { $AllInstallerArgs += @("-Project", $Project) }
if ($PSBoundParameters.ContainsKey("Prefix")) { $AllInstallerArgs += @("-Prefix", $Prefix) }
if ($PSBoundParameters.ContainsKey("Rulesync")) { $AllInstallerArgs += @("-Rulesync", $Rulesync) }
if ($NoSetup) { $AllInstallerArgs += "-NoSetup" }
if ($NoUx) { $AllInstallerArgs += "-NoUx" }
if ($NoOpenCode) { $AllInstallerArgs += "-NoOpenCode" }
if ($Force) { $AllInstallerArgs += "-Force" }
$AllInstallerArgs += $InstallerArgs

& $Installer @AllInstallerArgs
if ($LASTEXITCODE) {
  exit $LASTEXITCODE
}
