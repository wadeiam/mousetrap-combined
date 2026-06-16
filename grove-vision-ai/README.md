# Grove Vision AI V2 — Bring-up & Deployment Notes

On-device rodent detection accelerator for the Scout. Himax WiseEye2 HX6538
(Cortex-M55 + Ethos-U55 NPU). Talks to the XIAO over **I2C (addr 0x62)** in
production; USB-C (CH343 UART) is for bring-up/flashing only.

## Hardware status (verified 2026-06-12)
- Board: "Grove Vision AI V2", HW rev 1, device ID `554fe9f7`
- Firmware: SSCMA `2025.01.02` (latest) — **no reflash needed**
- Camera: OV5647-75 IR attached, `sensor_type: 15`, modes 240/480/640
- Boots clean, `is_ready: 1`, responds to AT protocol @ 921600 baud
- **No model loaded** (`AT+MODEL? → size: 0`)

## CRITICAL: XIAO ↔ Grove UART conflict
The USB-C console and the XIAO share the WiseEye2 UART. With a XIAO attached
and driving those pins, the console answers exactly **one** AT command then
goes silent (collision). For any USB serial work, **physically detach the
XIAO first**. This does NOT affect production — the XIAO uses I2C, not UART.

## AT protocol quick reference (921600 baud, `\r\n` terminator)
- `AT+ID?` `AT+NAME?` `AT+VER?` `AT+STAT?` — device info
- `AT+MODEL?` — currently loaded model (id/type/address/size)
- `AT+ALGOS?` `AT+SENSORS?` — available algorithms / camera modes
- `AT+TSCORE=<0-100>` — detection score threshold
- `AT+TIOU=<0-100>` — NMS IoU threshold
- `AT+INVOKE=<N_TIMES,DIFFERED,RESULT_ONLY>` — run inference
  - `AT+INVOKE=0,0,1` = continuous, no image payload (fastest)
  - Event JSON: `{"name":"INVOKE","type":1,"data":{"boxes":[[x,y,w,h,score,class_id],...],"perf":[pre,infer,post]}}`

## Flashing a model — CLI (SOLVED 2026-06-13, no SenseCraft needed)
Model flashes from the command line in two steps. (An earlier version of this
file claimed CLI model flashing was impossible — that was WRONG; working flow
below.) Model goes to `0x400000` as RAW vela bytes (no header). Classes/metadata
are NOT flashed — they're set afterward via the `AT+INFO` command.

```bash
# 1. Flash firmware + model. PRESS THE PHYSICAL RESET BUTTON when prompted.
python3 tools/himax_xmodem_send.py --port=/dev/cu.usbmodem* --baudrate=921600 \
  --protocol=xmodem \
  --file=grove-vision-ai/firmware/grove_vision_ai_v2_20250102.img \
  --model="grove-vision-ai/models/rodent_v1_int8_vela.tflite 0x400000 0x00000"

# 2. Register the model metadata/classes (sends AT+INFO).
python3 tools/grove_set_info.py "rodent v1" "rodent" 2523024 /dev/cu.usbmodem*

# 3. Verify: AT+INVOKE shows perf timing; boxes appear when a rodent is in view.
python3 tools/grove_invoke.py
```

Hard-won notes:
- Reset MUST be the physical button (clean cold reset). Programmatic `AT+RST`
  and pyserial RTS-toggle enter the bootloader, but the config-redirect step
  then goes silent — cause not fully understood; the button works reliably.
- `AT+MODEL?` reports `size: 0` even when the model runs fine — cosmetic; trust
  `AT+INVOKE` perf timing instead.
- SenseCraft does the same under the hood: model→0x400000 via xmodem (config
  block `C0 5A <addr LE> 00000000 5A C0`), then `AT+INFO="<base64 JSON>"`.

**SenseCraft AI WebSerial** (https://sensecraft.seeed.cc/ai/, Chrome) is a working
fallback if the CLI ever misbehaves.

## Tools (in repo `tools/`)
- `himax_xmodem_send.py` — official Himax flasher (firmware + model). USE THIS.
- `grove_set_info.py "<name>" "<classes,csv>" [size] [port]` — register model via AT+INFO.
- `grove_invoke.py [secs] [port]` — live inference smoke test (prints boxes)
- `grove_probe.py` — dump device info (must open at boot, keep port open)
- `grove_flash_sensecraft.py` / `grove_flash_v3.py` — earlier pyserial flash
  attempts; they enter the bootloader but stall at the config-redirect (kept for
  reference / future debugging of a button-free flow)

## Model pipeline
- Training: `ml-training/grove_train.ipynb` — single-class rodent YOLO11n @192,
  int8 + Vela-compiled for `ethos-u55-64`. Zero manual labeling (Channel
  Islands + Island Conservation + COCO negatives).
- Stock COCO YOLO11n test model: `firmware/yolo11n_coco_192_vela.tflite`
  (class 0 = person — flash via SenseCraft, wave at camera to validate)
