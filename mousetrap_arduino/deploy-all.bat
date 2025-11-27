@echo off
REM deploy-all.bat - Complete build and flash for firmware + filesystem
REM Usage: deploy-all.bat [serial-port]
REM Example: deploy-all.bat COM3

setlocal enabledelayedexpansion

REM Add tools to PATH
set PATH=C:\ProgramData\chocolatey\bin;C:\Program Files\nodejs;%PATH%

REM Configuration
set SERIAL_PORT=%1
if "%SERIAL_PORT%"=="" set SERIAL_PORT=COM3

set SKETCH_DIR=%~dp0
set SPA_DIR=%SKETCH_DIR%trap-spa
set DATA_DIR=%SKETCH_DIR%data
set APP_DIR=%DATA_DIR%\app
set BUILD_DIR=%SKETCH_DIR%build\esp32.esp32.esp32s3
set FIRMWARE_BIN=%BUILD_DIR%\ChatGPT.ino.bin
set LITTLEFS_BIN=%SKETCH_DIR%littlefs.bin
set MKLFS=C:\Users\wadeiam\AppData\Local\Arduino15\packages\esp32\tools\mklittlefs\4.0.2-db0513a\mklittlefs.exe
set ESPTOOL=C:\Users\wadeiam\AppData\Local\Arduino15\packages\esp32\tools\esptool_py\5.1.0\esptool.exe
set NODE_PATH=C:\Program Files\nodejs

echo ========================================
echo   Complete Build and Flash
echo   Serial Port: %SERIAL_PORT%
echo ========================================
echo.

REM Step 1: Build Svelte App
echo [1/6] Building Svelte app...
cd /d "%SPA_DIR%"
set PATH=%NODE_PATH%;%PATH%
call npm run build
if errorlevel 1 (
    echo Error: Svelte build failed
    exit /b 1
)
echo [OK] Svelte build complete
echo.

REM Step 2: Copy Svelte files to data/app
echo [2/6] Copying Svelte files to data/app...
rd /s /q "%APP_DIR%" 2>nul
mkdir "%APP_DIR%"
xcopy /s /e /y /q "%SPA_DIR%\dist\*" "%APP_DIR%\"
echo [OK] Svelte files copied
echo.

REM Step 3: Create LittleFS image
echo [3/6] Creating LittleFS image...
"%MKLFS%" -c "%DATA_DIR%" -p 256 -b 4096 -s 11403264 "%LITTLEFS_BIN%"
if not exist "%LITTLEFS_BIN%" (
    echo Error: Failed to create LittleFS image
    exit /b 1
)
for %%A in ("%LITTLEFS_BIN%") do set FS_SIZE=%%~zA
echo [OK] LittleFS image created: %FS_SIZE% bytes
echo.

REM Step 4: Compile Arduino Sketch
echo [4/6] Compiling Arduino sketch...

REM Check if arduino-cli is installed
where arduino-cli >nul 2>&1
if errorlevel 1 (
    echo Warning: arduino-cli not found in PATH
    echo Attempting to use existing build output...

    if not exist "%FIRMWARE_BIN%" (
        echo Error: No compiled firmware found and arduino-cli not available
        echo.
        echo SOLUTION: Install arduino-cli:
        echo   choco install arduino-cli
        echo.
        echo OR compile manually in Arduino IDE first
        echo.
        pause
        exit /b 1
    )

    echo [OK] Using existing firmware build
) else (
    echo Compiling with arduino-cli...
    echo.

    REM Check if ESP32 core is installed
    echo Checking for ESP32 core...
    arduino-cli core list | findstr "esp32:esp32" >nul 2>&1
    if errorlevel 1 (
        echo ESP32 core not found. Installing...
        arduino-cli core update-index
        arduino-cli core install esp32:esp32
        if errorlevel 1 (
            echo Error: Failed to install ESP32 core
            echo.
            echo Please install manually:
            echo   arduino-cli core update-index
            echo   arduino-cli core install esp32:esp32
            echo.
            pause
            exit /b 1
        )
    )
    echo [OK] ESP32 core installed
    echo.

    REM Set FQBN for ESP32-S3 (matching Arduino IDE board settings)
    set FQBN=esp32:esp32:esp32s3:CDCOnBoot=cdc,CPUFreq=240,FlashMode=qio,FlashSize=16M,PartitionScheme=custom,PSRAM=opi,UploadSpeed=921600

    echo Using FQBN: !FQBN!
    echo Output directory: !BUILD_DIR!
    echo Sketch: !SKETCH_DIR!ChatGPT.ino
    echo.

    REM Compile the sketch
    arduino-cli compile --fqbn "!FQBN!" --output-dir "!BUILD_DIR!" "!SKETCH_DIR!ChatGPT.ino"

    if errorlevel 1 (
        echo.
        echo Error: Compilation failed
        echo.
        echo TROUBLESHOOTING:
        echo 1. Check if ESP32 board is supported:
        echo    arduino-cli board listall ^| findstr ESP32-S3
        echo.
        echo 2. List installed cores:
        echo    arduino-cli core list
        echo.
        echo 3. Try compiling in Arduino IDE to see detailed errors
        echo.
        echo 4. Or compile manually and the script will use existing build
        echo.
        pause
        exit /b 1
    )

    echo [OK] Compilation successful
)

if not exist "%FIRMWARE_BIN%" (
    echo Error: Firmware binary not found at %FIRMWARE_BIN%
    exit /b 1
)

for %%A in ("%FIRMWARE_BIN%") do set FW_SIZE=%%~zA
echo [OK] Firmware size: %FW_SIZE% bytes
echo.

REM Step 5: Flash firmware to ESP32 via serial
echo [5/6] Flashing firmware to ESP32-S3 on %SERIAL_PORT%...
echo.
"%ESPTOOL%" --chip esp32s3 --port %SERIAL_PORT% --baud 921600 --before default-reset --after no-reset write-flash -z --flash-mode dio --flash-freq 80m --flash-size detect 0x10000 "%FIRMWARE_BIN%"
if errorlevel 1 (
    echo.
    echo Error: Firmware flash failed
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
echo [OK] Firmware flash complete
echo.

REM Step 6: Flash LittleFS to ESP32 via serial
echo [6/6] Flashing LittleFS to ESP32-S3 on %SERIAL_PORT%...
echo.
"%ESPTOOL%" --chip esp32s3 --port %SERIAL_PORT% --baud 921600 --before default-reset --after hard-reset write-flash -z --flash-mode dio --flash-freq 80m --flash-size detect 5308416 "%LITTLEFS_BIN%"
if errorlevel 1 (
    echo.
    echo Error: LittleFS flash failed
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
echo [OK] LittleFS flash complete
echo.

echo ========================================
echo   Deployment Complete!
echo ========================================
echo.
echo Both firmware and filesystem have been flashed.
echo Device will reboot automatically.
echo.

endlocal
