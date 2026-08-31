@echo off
setlocal

set HOST_NAME=com.chatgpt.bridge
set HOST_DIR=%~dp0
set HOST_MANIFEST=%HOST_DIR%%HOST_NAME%.json
set HOST_DIR_JSON=%HOST_DIR:\=/%

echo ========================================
echo ChatGPT Bridge - Native Host Kurulumu
echo ========================================
echo.

:: Detect Node.js path
for /f "tokens=*" %%i in ('where node') do (
    set NODE_PATH=%%i
    goto :found_node
)
echo Node.js bulunamadi! Lutfen Node.js kurun: https://nodejs.org
pause
exit /b 1

:found_node
echo Node.js: %NODE_PATH%
echo Host dizini: %HOST_DIR%
echo.

:: Generate manifest with correct paths
echo [1/6] Manifest olusturuluyor...
> "%HOST_MANIFEST%" (
    echo {
    echo   "name": "%HOST_NAME%",
    echo   "description": "ChatGPT Bridge Server Host",
    echo   "path": "%HOST_DIR_JSON%host.bat",
    echo   "type": "stdio",
    echo   "allowed_origins": [
    echo     "chrome-extension://PLACEHOLDER_EXTENSION_ID/"
    echo   ]
    echo }
)
echo       Manifest olusturuldu: %HOST_MANIFEST%

:: Generate host.bat with correct Node.js path
echo [2/6] host.bat olusturuluyor...
> "%HOST_DIR%host.bat" (
    echo @echo off
    echo "%NODE_PATH%" "%~dp0host.js"
)
echo       host.bat olusturuldu

:: Detect server location
echo [3/6] Server konumu algilaniyor...
set SERVER_DIR=%HOST_DIR%..\server
if exist "%SERVER_DIR%\server.cjs" (
    echo       Server bulundu: %SERVER_DIR%\server.cjs
) else (
    set SERVER_DIR=%HOST_DIR%..\..\server
    if exist "%SERVER_DIR%\server.cjs" (
        echo       Server bulundu: %SERVER_DIR%\server.cjs
    ) else (
        echo       Server bulunamadi, varsayilan kullaniliyor.
        set SERVER_DIR=%HOST_DIR%..\server
    )
)
set SERVER_PATH_JSON=%SERVER_DIR:\=/%/server.cjs

:: Generate config.json
echo [4/6] config.json olusturuluyor...
> "%HOST_DIR%config.json" (
    echo {
    echo   "serverPath": "%SERVER_PATH_JSON%"
    echo }
)
echo       config.json olusturuldu: %HOST_DIR%config.json

:: Register for Chrome - HKCU
echo [5/6] Chrome icin kayit yapiliyor...
reg add "HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%HOST_MANIFEST%" /f >nul 2>&1
if %errorLevel% equ 0 (
    echo       Chrome basariyla kaydedildi
) else (
    echo       Chrome kaydi basarisiz
)

:: Register for Edge - HKCU
echo [6/6] Edge icin kayit yapiliyor...
reg add "HKCU\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%HOST_MANIFEST%" /f >nul 2>&1
if %errorLevel% equ 0 (
    echo       Edge basariyla kaydedildi
) else (
    echo       Edge kaydi basarisiz
)

echo.
echo ========================================
echo Kurulum tamamlandi!
echo.
echo 1. Extension'i Chrome'a yukleyin (chrome://extensions ^> Developer mode ^> Load unpacked)
echo 2. Extension ID'yi kopyalayin
echo 3. Asagidaki dosyayi acin ve PLACEHOLDER_EXTENSION_ID degerini degistirin:
echo    %HOST_MANIFEST%
echo.
echo Extension ID'yi ogrenmek icin: chrome://extensions
echo ========================================
echo.
pause
