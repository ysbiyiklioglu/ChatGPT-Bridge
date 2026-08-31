@echo off
setlocal

set HOST_NAME=com.chatgpt.bridge
set HOST_DIR=%~dp0
set HOST_BAT=%HOST_DIR%%HOST_NAME%.json

echo ========================================
echo ChatGPT Bridge - Native Host Kurulumu
echo ========================================
echo.

:: Generate manifest dynamically
echo [0/4] Manifest olusturuluyor...
(
echo {
echo   "name": "com.chatgpt.bridge",
echo   "description": "ChatGPT Bridge Server Host",
echo   "path": "%HOST_DIR%host.bat",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://PLACEHOLDER_EXTENSION_ID/"
echo   ]
echo }
) > "%HOST_BAT%"
echo       Manifest olusturuldu: %HOST_BAT%

:: Register for Chrome - HKCU
echo [1/3] Chrome icin kayit yapiliyor...
reg add "HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%HOST_BAT%" /f >nul 2>&1
if %errorLevel% equ 0 (
    echo       Chrome basariyla kaydedildi
) else (
    echo       Chrome kaydi basarisiz
)

:: Register for Edge - HKCU
echo [2/3] Edge icin kayit yapiliyor...
reg add "HKCU\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%HOST_BAT%" /f >nul 2>&1
if %errorLevel% equ 0 (
    echo       Edge basariyla kaydedildi
) else (
    echo       Edge kaydi basarisiz
)

:: Check Node.js
echo [3/3] Node.js kontrol ediliyor...
where node >nul 2>&1
if %errorLevel% equ 0 (
    echo       Node.js bulundu
) else (
    echo       Node.js bulunamadi! Lutfen Node.js kurun: https://nodejs.org
)

echo.
echo ========================================
echo Kurulum tamamlandi!
echo.
echo One: Extension'i Chrome'a yukleyin (chrome://extensions > Developer mode > Load unpacked)
echo Two: Extension ID'yi kopyalayin
echo Three: Asagidaki dosyayi acin ve PLACEHOLDER_EXTENSION_ID degerini degistirin:
echo         %HOST_BAT%
echo ========================================
echo.
pause
