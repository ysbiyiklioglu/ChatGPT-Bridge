@echo off
setlocal

set HOST_NAME=com.chatgpt.bridge
set HOST_DIR=%~dp0
set HOST_MANIFEST=%HOST_DIR%%HOST_NAME%.json

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
echo [1/4] Manifest olusturuluyor...
> "%HOST_MANIFEST%" (
    echo {
    echo   "name": "%HOST_NAME%",
    echo   "description": "ChatGPT Bridge Server Host",
    echo   "path": "%HOST_DIR%host.bat",
    echo   "type": "stdio",
    echo   "allowed_origins": [
    echo     "chrome-extension://PLACEHOLDER_EXTENSION_ID/"
    echo   ]
    echo }
)
echo       Manifest olusturuldu: %HOST_MANIFEST%

:: Generate host.bat with correct Node.js path
echo [2/4] host.bat olusturuluyor...
> "%HOST_DIR%host.bat" (
    echo @echo off
    echo "%NODE_PATH%" "%~dp0host.js"
)
echo       host.bat olusturuldu

:: Register for Chrome - HKCU
echo [3/4] Chrome icin kayit yapiliyor...
reg add "HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%HOST_MANIFEST%" /f >nul 2>&1
if %errorLevel% equ 0 (
    echo       Chrome basariyla kaydedildi
) else (
    echo       Chrome kaydi basarisiz
)

:: Register for Edge - HKCU
echo [4/4] Edge icin kayit yapiliyor...
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
