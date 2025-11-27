@echo off
REM deploy-spa.bat - Build Svelte app and flash LittleFS to ESP32 via USB
REM Usage: deploy-spa.bat [serial-port]
REM Example: deploy-spa.bat COM3

setlocal enabledelayedexpansion

REM Configuration
set SERIAL_PORT=%1
if "%SERIAL_PORT%"=="" set SERIAL_PORT=COM3
set SKETCH_DIR=%~dp0
set SPA_DIR=%SKETCH_DIR%trap-spa
set DATA_DIR=%SKETCH_DIR%data
set APP_DIR=%DATA_DIR%\app
set LITTLEFS_BIN=%SKETCH_DIR%littlefs.bin
set MKLFS=C:\Users\wadeiam\AppData\Local\Arduino15\packages\esp32\tools\mklittlefs\4.0.2-db0513a\mklittlefs.exe
set ESPTOOL=C:\Users\wadeiam\AppData\Local\Arduino15\packages\esp32\tools\esptool_py\5.1.0\esptool.exe
set NODE_PATH=C:\Program Files\nodejs

echo ========================================
echo   MouseTrap SPA Deployment
echo   Serial Port: %SERIAL_PORT%
echo ========================================
echo.

REM Step 1: Build Svelte app
echo [1/4] Building Svelte app...
cd /d "%SPA_DIR%"
set PATH=%NODE_PATH%;%PATH%
call npm run build
if errorlevel 1 (
    echo Error: Build failed
    exit /b 1
)
echo [OK] Build complete
echo.

REM Step 2: Copy to data/app
echo [2/4] Copying files to data/app...
rd /s /q "%APP_DIR%" 2>nul
mkdir "%APP_DIR%"
xcopy /s /e /y /q "%SPA_DIR%\dist\*" "%APP_DIR%\"
echo [OK] Files copied
echo.

REM Step 3: Create LittleFS image
echo [3/4] Creating LittleFS image...
"%MKLFS%" -c "%DATA_DIR%" -p 256 -b 4096 -s 11403264 "%LITTLEFS_BIN%"
if not exist "%LITTLEFS_BIN%" (
    echo Error: Failed to create LittleFS image
    exit /b 1
)
for %%A in ("%LITTLEFS_BIN%") do set SIZE=%%~zA
echo [OK] LittleFS image created: %SIZE% bytes
echo.

REM Step 4: Flash to ESP32 via serial
echo [4/4] Flashing LittleFS to ESP32-S3 on %SERIAL_PORT%...
echo.
"%ESPTOOL%" --chip esp32s3 --port %SERIAL_PORT% --baud 921600 --before default-reset --after hard-reset write-flash -z --flash-mode dio --flash-freq 80m --flash-size detect 5308416 "%LITTLEFS_BIN%"
if errorlevel 1 (
    echo.
    echo Error: Flash failed
    echo.
    echo TROUBLESHOOTING:
    echo 1. Check that COM port is correct (default: COM3)
    echo 2. Make sure device is connected via USB
    echo 3. Close Arduino IDE Serial Monitor if open
    echo 4. Try pressing BOOT button during flash
    echo.
    exit /b 1
)
echo.
echo [OK] Flash complete
echo.

echo ========================================
echo   Deployment Complete!
echo   Device will reboot automatically
echo ========================================
echo.
echo The device should be running the new filesystem now.

endlocal
