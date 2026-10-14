@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。请直接双击 index.html，或安装 Node.js 后重新运行。
  pause
  exit /b 1
)
echo 游戏地址：http://127.0.0.1:8080
echo 请在浏览器打开上方地址；游玩期间请勿关闭此窗口。
node server.js
pause
