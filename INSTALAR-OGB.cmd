@echo off
setlocal

set "ROOT=%~dp0"
set "PS1=%ROOT%INSTALAR-OGB.ps1"

if not exist "%PS1%" (
  echo Nao encontrei %PS1%
  echo Este arquivo precisa ficar na raiz do opencode-gemini-bridge.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set "CODE=%ERRORLEVEL%"

echo.
if "%CODE%"=="0" (
  echo Instalacao finalizada.
) else (
  echo A instalacao terminou com erro. Codigo: %CODE%
)
echo.
echo Pode fechar esta janela.
pause
exit /b %CODE%
