$ErrorActionPreference = "Stop"

# Legacy self-update entrypoint. Older installed OGB versions fetch this path
# from main; keep it as a tiny bridge to the reorganized script location.
$Repo = if ($env:OGB_GITHUB_REPO) { $env:OGB_GITHUB_REPO } else { "augustocaruso/opencode-gemini-bridge" }
$Url = "https://raw.githubusercontent.com/$Repo/main/scripts/bootstrap-windows.ps1"
$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("ogb-bootstrap-legacy-" + [System.Guid]::NewGuid().ToString("N") + ".ps1")

try {
  Invoke-WebRequest -Uri $Url -OutFile $Tmp
  & $Tmp @args
  exit $LASTEXITCODE
} finally {
  Remove-Item -Force $Tmp -ErrorAction SilentlyContinue
}
