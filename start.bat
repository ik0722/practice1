@echo off
chcp 65001 > nul
title オセロ リアルタイム対戦サーバー

echo ====================================================
echo  オセロ リアルタイム対戦サーバーを起動しています...
echo ====================================================

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo 【エラー】Node.js が見つかりませんでした。
    echo.
    echo Node.js がインストールされていないか、PATHが設定されていません。
    echo 以下の公式サイトから Node.js (LTS版) をダウンロードしてインストールしてください:
    echo 👉 https://nodejs.org/ja
    echo.
    echo （インストール完了後、このファイルをもう一度ダブルクリックしてください）
    echo.
    pause
    exit /b
)

cd /d "%~dp0"
node server.js
pause
