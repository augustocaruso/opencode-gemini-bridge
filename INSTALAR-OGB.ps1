$ErrorActionPreference = "Stop"

function Write-Step($Text) {
  Write-Host ""
  Write-Host "== $Text ==" -ForegroundColor Cyan
}

function Fail($Text) {
  Write-Host ""
  Write-Host $Text -ForegroundColor Red
  Write-Host ""
  Write-Host "A janela vai ficar aberta para voce copiar o erro, se precisar."
  exit 1
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Installer = Join-Path $Root "install.ps1"

Write-Host ""
Write-Host "OpenCode Gemini Bridge - instalador simples" -ForegroundColor Green
Write-Host ""
Write-Host "Este script instala o comando ogb corrigido."
Write-Host "Depois ele pode configurar um projeto, se voce informar o caminho."
Write-Host ""

if (-not (Test-Path $Installer)) {
  Fail "Nao encontrei install.ps1 na raiz: $Installer"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js nao foi encontrado. Instale Node.js primeiro e rode este arquivo de novo."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail "npm nao foi encontrado. Reinstale o Node.js marcando a opcao de incluir npm."
}

Write-Step "Projeto"
Write-Host "Se voce quer configurar o bridge em um projeto agora, cole o caminho dele."
Write-Host "Exemplo: C:\Users\leona\Documents\meu-projeto"
Write-Host ""
Write-Host "Se voce so quer instalar o comando ogb, aperte ENTER sem digitar nada."
Write-Host ""
$Project = Read-Host "Caminho do projeto"

$InstallerArgs = @("-Force")
if ($Project -and $Project.Trim()) {
  $Project = [System.IO.Path]::GetFullPath($Project.Trim('" '))
  if (-not (Test-Path $Project)) {
    Fail "Esse caminho de projeto nao existe: $Project"
  }
  $InstallerArgs = @("-Project", $Project, "-Force")
} else {
  $InstallerArgs = @("-NoSetup", "-NoUx", "-Force")
}

Write-Step "Instalando"
& $Installer @InstallerArgs

Write-Step "Conferindo"
$Ogb = Get-Command ogb -ErrorAction SilentlyContinue
if (-not $Ogb) {
  Write-Host "O ogb foi instalado, mas este terminal ainda nao enxerga o PATH novo." -ForegroundColor Yellow
  Write-Host "Feche esta janela, abra um PowerShell novo e rode: ogb --version"
  exit 0
}

$Version = (& ogb --version)
Write-Host "ogb encontrado em: $($Ogb.Source)"
Write-Host "Versao: $Version"

if ($Project -and $Project.Trim()) {
  Write-Step "Doctor"
  & ogb --project $Project doctor
}

Write-Host ""
Write-Host "Pronto. Se voce abriu pelo duplo clique, abra um PowerShell novo antes de usar ogb." -ForegroundColor Green
