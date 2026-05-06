param(
  [string]$Repo = $(if ($env:OGB_GITHUB_REPO) { $env:OGB_GITHUB_REPO } else { "augustocaruso/opencode-gemini-bridge" }),
  [string]$Branch = $(if ($env:OGB_GITHUB_BRANCH) { $env:OGB_GITHUB_BRANCH } else { "main" })
)

$ErrorActionPreference = "Stop"

function Fail($Text) {
  Write-Host ""
  Write-Host $Text -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "OpenCode Gemini Bridge - instalador direto do GitHub" -ForegroundColor Green
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js nao foi encontrado. Instale Node.js primeiro e rode este comando de novo."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail "npm nao foi encontrado. Reinstale o Node.js marcando a opcao de incluir npm."
}

Write-Host "Cole o caminho do projeto se quiser configurar o bridge agora."
Write-Host "Exemplo: C:\Users\leona\Documents\meu-projeto"
Write-Host "Ou aperte ENTER para instalar apenas o comando ogb."
Write-Host ""
$Project = Read-Host "Caminho do projeto"

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ogb-github-" + [System.Guid]::NewGuid().ToString("N"))
$ZipPath = Join-Path $TempDir "source.zip"
$UnpackDir = Join-Path $TempDir "source"
$ArchiveUrl = "https://github.com/$Repo/archive/refs/heads/$Branch.zip"

New-Item -ItemType Directory -Force $TempDir | Out-Null

try {
  Write-Host ""
  Write-Host "Baixando $ArchiveUrl ..."
  Invoke-WebRequest -UseBasicParsing -Uri $ArchiveUrl -OutFile $ZipPath
  Expand-Archive -Path $ZipPath -DestinationPath $UnpackDir -Force

  $Installer = Get-ChildItem -Path $UnpackDir -Recurse -Filter install.ps1 |
    Where-Object { Test-Path (Join-Path $_.DirectoryName "scripts\install-windows.ps1") } |
    Select-Object -First 1

  if (-not $Installer) {
    Fail "Nao encontrei install.ps1 no pacote baixado do GitHub."
  }

  $InstallerArgs = @("-Force")
  if ($Project -and $Project.Trim()) {
    $Project = [System.IO.Path]::GetFullPath($Project.Trim('" '))
    if (-not (Test-Path $Project)) {
      Fail "Esse caminho de projeto nao existe: $Project"
    }
    $InstallerArgs = @("-Project", $Project, "-Force")
  } else {
    $InstallerArgs = @("-NoSetup", "-Force")
  }

  Write-Host ""
  Write-Host "Rodando instalador..."
  & $Installer.FullName @InstallerArgs

  Write-Host ""
  Write-Host "Pronto. Abra um PowerShell novo e rode: ogb --version" -ForegroundColor Green
} finally {
  Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}
