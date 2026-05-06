param(
  [string]$Project = (Get-Location).Path,
  [string]$Prefix = "",
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

function Invoke-NativeCommand($Command, [string[]]$Arguments) {
  $StdOut = Join-Path ([System.IO.Path]::GetTempPath()) ("ogb-native-out-" + [System.Guid]::NewGuid().ToString("N") + ".log")
  $StdErr = Join-Path ([System.IO.Path]::GetTempPath()) ("ogb-native-err-" + [System.Guid]::NewGuid().ToString("N") + ".log")
  try {
    & $Command @Arguments > $StdOut 2> $StdErr
    $ExitCode = $LASTEXITCODE
    if (Test-Path $StdOut) {
      Get-Content -Path $StdOut -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    }
    if (Test-Path $StdErr) {
      Get-Content -Path $StdErr -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    }
    if ($ExitCode -ne 0) {
      throw "$Command $($Arguments -join ' ') failed with exit code $ExitCode."
    }
  } finally {
    Remove-Item -Force $StdOut -ErrorAction SilentlyContinue
    Remove-Item -Force $StdErr -ErrorAction SilentlyContinue
  }
}

function Test-WritableDir($Dir) {
  if (-not $Dir) {
    return $false
  }
  try {
    New-Item -ItemType Directory -Force $Dir | Out-Null
    $Probe = Join-Path $Dir (".ogb-write-test-" + [System.Guid]::NewGuid().ToString("N"))
    "ok" | Set-Content -Path $Probe -Encoding ASCII
    Remove-Item -Force $Probe -ErrorAction SilentlyContinue
    return $true
  } catch {
    return $false
  }
}

function Resolve-AppDataNpmPrefix {
  if ($env:APPDATA) {
    return Join-Path $env:APPDATA "npm"
  }
  return Join-Path $HOME "AppData\Roaming\npm"
}

function Resolve-DefaultPrefix {
  $AppDataPrefix = Resolve-AppDataNpmPrefix
  if (Test-WritableDir $AppDataPrefix) {
    return $AppDataPrefix
  }

  $NpmPrefix = ""
  try {
    $NpmPrefix = (& npm prefix -g 2>$null)
  } catch {
    $NpmPrefix = ""
  }
  if ($NpmPrefix -and (Test-WritableDir $NpmPrefix.Trim())) {
    return $NpmPrefix.Trim()
  }

  throw "Could not find a writable install prefix. Tried $AppDataPrefix and npm prefix -g."
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

function Remove-BrokenOgbShim($Dir) {
  if (-not $Dir) {
    return
  }
  foreach ($Name in @("ogb", "ogb.cmd", "ogb.ps1")) {
    $Shim = Join-Path $Dir $Name
    if (-not (Test-Path $Shim)) {
      continue
    }
    $Content = ""
    try {
      $Content = Get-Content -Raw -Path $Shim -ErrorAction Stop
    } catch {
      $Content = ""
    }
    if ($Content -match "opencode-gemini-bridge-cli" -or $Content -match "\.ai\\opencode-pack" -or $Content -match "added \d+ packages") {
      Remove-Item -Force $Shim -ErrorAction SilentlyContinue
      Write-Host "Removed broken ogb shim: $Shim"
    }
  }
}

function Repair-BrokenOgbShims($Prefix) {
  $Dirs = @()
  $Dirs += $Prefix
  $Dirs += (Resolve-AppDataNpmPrefix)
  $Dirs += $HOME
  try {
    $NpmPrefix = (& npm prefix -g 2>$null)
    if ($NpmPrefix) {
      $Dirs += $NpmPrefix.Trim()
    }
  } catch {
    # ignore npm prefix lookup failures; the installer will use its resolved prefix.
  }
  foreach ($Dir in ($Dirs | Where-Object { $_ } | Select-Object -Unique)) {
    Remove-BrokenOgbShim $Dir
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
  foreach ($TelemetryDefaults in @("telemetry.defaults.json", "telemetry.defaults.example.json")) {
    $TelemetryDefaultsPath = Join-Path $SourceDir $TelemetryDefaults
    if (Test-Path $TelemetryDefaultsPath) {
      Copy-Item -Path $TelemetryDefaultsPath -Destination $InstallDir -Force
    }
  }
  if (Test-Path (Join-Path $SourceDir "telemetry-email-worker")) {
    Copy-Item -Path (Join-Path $SourceDir "telemetry-email-worker") -Destination (Join-Path $InstallDir "telemetry-email-worker") -Recurse -Force
  }
  Copy-Item -Path (Join-Path $SourceDir "dist") -Destination (Join-Path $InstallDir "dist") -Recurse -Force

  Invoke-NativeCommand "npm" @("--prefix", $InstallDir, "install", "--omit=dev")
  $ExpectedCliTarget = Join-Path $InstallDir "dist\cli.js"
  if (-not (Test-Path $ExpectedCliTarget)) {
    throw "Expected built CLI at $ExpectedCliTarget, but it was not found."
  }
}

function Test-CleanCliPath($PathValue, $Label) {
  if (-not $PathValue) {
    throw "$Label is empty."
  }
  if ($PathValue -match "\r|\n|added \d+ packages|audited \d+ packages|npm fund|npm audit") {
    throw "$Label was contaminated by command output: $PathValue"
  }
  if (-not (Test-Path $PathValue)) {
    throw "$Label does not exist: $PathValue"
  }
}

function Test-CleanOgbShim($ShimPath, $CliTarget) {
  if (-not (Test-Path $ShimPath)) {
    throw "Expected ogb.cmd under $ShimPath, but it was not found."
  }
  $Content = Get-Content -Raw -Path $ShimPath
  if ($Content -match "added \d+ packages|audited \d+ packages|npm fund|npm audit") {
    throw "Generated ogb shim contains npm output: $ShimPath"
  }
  if ($Content -notmatch [regex]::Escape($CliTarget)) {
    throw "Generated ogb shim does not point at expected CLI target: $CliTarget"
  }
  $NonEmptyLines = @($Content -split "\r?\n" | Where-Object { $_.Trim() })
  if ($NonEmptyLines.Count -ne 2) {
    throw "Generated ogb shim should contain exactly 2 non-empty lines, found $($NonEmptyLines.Count): $ShimPath"
  }
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ArtifactsDir = Split-Path -Parent $ScriptDir
$CliDir = Join-Path $ArtifactsDir "bridge-cli-skeleton"

Require-Command "node"
Require-Command "npm"

if ((-not $Prefix) -or $Prefix.Trim().StartsWith("-")) {
  $Prefix = Resolve-DefaultPrefix
} elseif (-not (Test-WritableDir $Prefix)) {
  throw "Install prefix is not writable: $Prefix"
}

Repair-BrokenForceInstall
Repair-BrokenOgbShims $Prefix

New-Item -ItemType Directory -Force (Join-Path $HOME ".config\opencode") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $HOME ".agents\skills") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $HOME ".ai\opencode-pack") | Out-Null
New-Item -ItemType Directory -Force $Prefix | Out-Null

Write-Host "Building ogb CLI..."
Invoke-NativeCommand "npm" @("--prefix", $CliDir, "install")
Invoke-NativeCommand "npm" @("--prefix", $CliDir, "run", "build")

Write-Host "Installing ogb into a stable local folder..."
$CliInstallDir = Join-Path (Join-Path $HOME ".ai\opencode-pack") "opencode-gemini-bridge-cli"
Install-StableCli $CliDir $CliInstallDir
$CliTarget = Join-Path $CliInstallDir "dist\cli.js"
Test-CleanCliPath $CliTarget "CLI target"
Write-Host "Prefix: $Prefix"
Write-Host "CliInstallDir: $CliInstallDir"
Write-Host "CliTarget: $CliTarget"

Write-Host "Registering ogb command in $Prefix..."
Remove-Item -Force (Join-Path $Prefix "ogb") -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path $Prefix "ogb.cmd") -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path $Prefix "ogb.ps1") -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $Prefix "node_modules\opencode-gemini-bridge") -ErrorAction SilentlyContinue

$OgbBin = Join-Path $Prefix "ogb.cmd"
"@ECHO off`r`nnode `"$CliTarget`" %*`r`n" | Set-Content -Path $OgbBin -Encoding ASCII

Test-CleanOgbShim $OgbBin $CliTarget
Write-Host "OgbBin: $OgbBin"

$InstalledVersionOutput = & $OgbBin --version 2>&1
$InstalledVersionExit = $LASTEXITCODE
if ($InstalledVersionExit -ne 0) {
  $Message = if ($InstalledVersionOutput) { ($InstalledVersionOutput | Out-String).Trim() } else { "no output" }
  throw "Installed ogb verification failed with exit code ${InstalledVersionExit}: $Message"
}
$InstalledVersion = if ($InstalledVersionOutput) { ($InstalledVersionOutput | Out-String).Trim() } else { "" }
if (-not $InstalledVersion) {
  throw "Installed ogb verification returned no version output."
}
Write-Host "Verified ogb $InstalledVersion at $OgbBin"

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
Write-Host "ogb command: $OgbBin"
Write-Host "Try: & `"$OgbBin`" --project `"$Project`" doctor"
