@echo off
setlocal
set "SCRIPT_DIR=%~dp0"

where pwsh >nul 2>nul
if errorlevel 1 (
  echo 未找到 PowerShell 7 pwsh.exe，请联系开发维护人员提供完整安装包。
  pause
  exit /b 1
)

pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install-native-host.ps1" -Browser all
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo 原生助手安装失败，错误码：%EXIT_CODE%
  pause
  exit /b %EXIT_CODE%
)

echo.
echo 原生助手安装完成，请重新打开扩展设置页查看运行状态。
pause
