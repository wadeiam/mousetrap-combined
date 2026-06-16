#!/usr/bin/env python3
"""Flash firmware + model to Grove Vision AI V2 over USB (no SenseCraft).

Replicates Himax's xmodem_send.py --file --model flow, which is the sequence
that actually works on this board's bootloader:
  reset -> catch burn prompt -> xmodem(firmware) -> 'n'
        -> xmodem(model preamble @addr) -> 'n' -> xmodem(model) -> 'y'

Usage: grove_flash_fw_model.py <firmware.img> <model.tflite> <addr_hex> [port]
"""
import io, sys, time
import serial
from xmodem import XMODEM

FW    = sys.argv[1]
MODEL = sys.argv[2]
ADDR  = int(sys.argv[3], 16)
PORT  = sys.argv[4] if len(sys.argv) > 4 else "/dev/cu.usbmodem5B420584031"

fw_data    = open(FW, "rb").read()
model_data = open(MODEL, "rb").read()
print(f"firmware {len(fw_data)}B  |  model {len(model_data)}B -> 0x{ADDR:X}", flush=True)

ser = serial.Serial(PORT, 921600, timeout=1)
modem = XMODEM(lambda size, timeout=1: ser.read(size) or None,
               lambda d, timeout=1: ser.write(d) or None, mode="xmodem")

def catch_bootloader():
    ser.timeout = 0.01
    ser.reset_input_buffer()
    ser.write(b"AT+RST\r\n")
    print("AT+RST; tight-spamming '1' for burn mode...", flush=True)
    buf = b""; t0 = time.time()
    while time.time() - t0 < 25:
        ser.write(b"1")
        buf += ser.read(128)
        if b"Send data using the xmodem protocol" in buf:
            return True
    print(f"  FAIL catch. tail={buf[-160:]!r}", flush=True)
    return False

def wait_prompt(secs=40):
    """Wait for the 'reboot system? (y)' prompt after an xmodem transfer."""
    ser.timeout = 0.01
    buf = b""; t0 = time.time()
    while time.time() - t0 < secs:
        buf += ser.read(256)
        if b"reboot system" in buf:
            return True
    print(f"  no reboot prompt. tail={buf[-160:]!r}", flush=True)
    return False

def send_xmodem(data, label):
    time.sleep(0.5)
    ser.reset_input_buffer()
    ser.timeout = 2
    print(f"  xmodem sending {label} ({len(data)}B)...", flush=True)
    ok = modem.send(io.BytesIO(data), retry=30)
    print(f"  {label} send -> {ok}", flush=True)
    return ok

if not catch_bootloader():
    sys.exit(1)
print("In burn mode.", flush=True)

# 1) firmware
if not send_xmodem(fw_data, "firmware"):
    sys.exit("firmware send failed")
if not wait_prompt():
    sys.exit("no prompt after firmware")
ser.write(b"n")            # more files coming
time.sleep(0.5)

# 2) model preamble (redirects burn to ADDR)
preamble = bytes([0xC0, 0x5A]) + ADDR.to_bytes(4, "little") + \
           (0).to_bytes(4, "little") + bytes([0x5A, 0xC0]) + b"\xFF" * 116
if not send_xmodem(preamble, "preamble"):
    sys.exit("preamble send failed")
if not wait_prompt():
    sys.exit("no prompt after preamble")
ser.write(b"n")
time.sleep(0.5)

# 3) model payload
if not send_xmodem(model_data, "model"):
    sys.exit("model send failed")
if not wait_prompt(secs=60):
    sys.exit("no prompt after model")
ser.write(b"y")            # done -> reboot
print("FLASH COMPLETE -> rebooting", flush=True)

# capture boot banner
ser.timeout = 0.01
buf = b""; t0 = time.time()
while time.time() - t0 < 6:
    buf += ser.read(1024)
print("boot tail:", repr(buf[-200:]), flush=True)
ser.close()
