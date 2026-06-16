#!/usr/bin/env python3
"""Flash a model to Grove Vision AI V2 over USB — faithful replica of the
SenseCraft Web Toolkit protocol (src/sscma/grove_ai_we2/deviceHimax.ts).

The key vs. earlier attempts: HARDWARE reset via the RTS pin (not AT+RST),
a fresh reset per flash op, and erasing 0x300000/0x400000 first. Config-block
byte layout matches SenseCraft exactly.

Usage: grove_flash_sensecraft.py <model.tflite> [addr_hex=0x400000] [port]
"""
import io, sys, time
import serial
from xmodem import XMODEM

MODEL = sys.argv[1]
ADDR  = int(sys.argv[2], 16) if len(sys.argv) > 2 else 0x400000
PORT  = sys.argv[3] if len(sys.argv) > 3 else "/dev/cu.usbmodem5B420584031"

ser = serial.Serial(PORT, 921600, timeout=1)

def hard_reset():
    # SenseCraft: setRTS(false) -> 100ms -> setRTS(true)
    ser.rts = False
    time.sleep(0.1)
    ser.rts = True
    time.sleep(0.1)

def enter_bootloader():
    hard_reset()
    ser.reset_input_buffer()
    ser.timeout = 0.01
    buf = b""
    t0 = time.time()
    # spam '1' until the burn-menu line appears (SenseCraft waits on this exact text)
    while time.time() - t0 < 15:
        ser.write(b"1")
        buf += ser.read(128)
        if b"Xmodem download and burn FW image" in buf:
            ser.write(b"1")               # select burn
            time.sleep(0.1)
            ser.reset_input_buffer()
            return True
        time.sleep(0.01)
    print(f"  enter_bootloader FAILED tail={buf[-160:]!r}", flush=True)
    return False

def flash_complete(reset_char, secs=12):
    ser.timeout = 0.01
    buf = b""
    t0 = time.time()
    while time.time() - t0 < secs:
        buf += ser.read(256)
        if b"Do you want to end file transmission and reboot system" in buf:
            ser.write(reset_char)
            return True
    print(f"  flash_complete: no prompt, tail={buf[-160:]!r}", flush=True)
    return False

def _mk_xmodem():
    ser.timeout = 1
    return XMODEM(lambda size, timeout=1: ser.read(size) or None,
                  lambda d, timeout=1: ser.write(d) or None, mode="xmodem")

def flash(data, offset, label):
    print(f"[flash {label}] {len(data)}B -> 0x{offset:X}", flush=True)
    if not enter_bootloader():
        raise SystemExit(f"{label}: could not enter bootloader")
    modem = _mk_xmodem()
    if offset != 0:
        config = bytearray(b"\xff" * 128)
        config[0] = 0xC0; config[1] = 0x5A
        config[2] = offset & 0xFF
        config[3] = (offset >> 8) & 0xFF
        config[4] = (offset >> 16) & 0xFF
        config[5] = (offset >> 24) & 0xFF
        config[6] = config[7] = config[8] = config[9] = 0x00
        config[10] = 0x5A; config[11] = 0xC0
        ser.reset_input_buffer()
        if not modem.send(io.BytesIO(bytes(config)), retry=30):
            raise SystemExit(f"{label}: config send failed")
        if not flash_complete(b"n"):
            raise SystemExit(f"{label}: no prompt after config")
        print(f"  [{label}] config accepted ✓", flush=True)
    ser.reset_input_buffer()
    if not modem.send(io.BytesIO(bytes(data)), retry=30):
        raise SystemExit(f"{label}: data send failed")
    if not flash_complete(b"y", secs=60):
        raise SystemExit(f"{label}: no prompt after data")
    print(f"  [{label}] done ✓", flush=True)

model_data = open(MODEL, "rb").read()
print(f"Model {len(model_data)}B -> 0x{ADDR:X} on {PORT}", flush=True)

# SenseCraft erases 0x300000 and 0x400000 before writing the model
print("== erase 0x300000 / 0x400000 ==", flush=True)
flash(bytes(128), 0x300000, "erase-0x300000")
flash(bytes(128), 0x400000, "erase-0x400000")

print("== write model ==", flush=True)
flash(model_data, ADDR, "model")

# verify
hard_reset()
time.sleep(2)
ser.timeout = 0.05
ser.reset_input_buffer()
ser.write(b"AT+MODEL?\r\n")
time.sleep(1.5)
print("AT+MODEL? ->", ser.read(4096).decode(errors="replace").strip()[-200:], flush=True)
ser.close()
