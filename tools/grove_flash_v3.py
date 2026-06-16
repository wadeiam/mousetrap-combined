#!/usr/bin/env python3
"""Flash a model to Grove Vision AI V2 — tight-spam bootloader catch + verbose.

Combines the reliable tight '1'-spam to catch the 100ms bootloader window
with the Himax model preamble protocol, logging every bootloader response.

Usage: grove_flash_v3.py <model> [position_hex] [port]
"""
import io
import math
import sys
import time

import serial
from xmodem import XMODEM

MODEL = sys.argv[1]
POSITION = int(sys.argv[2], 16) if len(sys.argv) > 2 else 0x400000
PORT = sys.argv[3] if len(sys.argv) > 3 else "/dev/cu.usbmodem5B420584031"
data = open(MODEL, "rb").read()
print(f"Model {len(data)} bytes -> 0x{POSITION:X}", flush=True)

ser = serial.Serial(PORT, 921600, timeout=0.01)

def wait_for(token, secs, spam=None):
    """Read until token (bytes) seen or timeout. Optionally spam a byte."""
    buf = b""
    t0 = time.time()
    while time.time() - t0 < secs:
        if spam:
            ser.write(spam)
        buf += ser.read(512)
        if token in buf:
            return buf, True
    return buf, False

# 1. Reset into bootloader, tight-spam '1' to catch the burn prompt
ser.reset_input_buffer()
ser.write(b"AT+RST\r\n")
print("AT+RST sent, tight-spamming '1'...", flush=True)
buf, ok = wait_for(b"Send data using the xmodem protocol", 25, spam=b"1")
if not ok:
    print(f"FAIL catch bootloader. tail={buf[-200:]!r}", flush=True)
    sys.exit(1)
print("Caught xmodem burn prompt.", flush=True)

# 2. Per Himax flow: send '1', then 'n', then preamble
time.sleep(1)
ser.reset_input_buffer()
ser.write(b"1\r")
time.sleep(1)
ser.reset_input_buffer()
ser.write(b"n\r")
time.sleep(0.3)

modem = XMODEM(lambda size, timeout=1: ser.read(size) or None,
               lambda d, timeout=1: ser.write(d) or None, mode="xmodem")

preamble = bytes([0xC0, 0x5A]) + POSITION.to_bytes(4, "little") + \
    (0).to_bytes(4, "little") + bytes([0x5A, 0xC0]) + b"\xFF" * 116

ser.timeout = 1
print("sending preamble (128B)...", flush=True)
ok = modem.send(io.BytesIO(preamble), retry=20)
print(f"preamble send returned {ok}", flush=True)

# 3. Verbose: log EVERYTHING for 12s to see what bootloader says
ser.timeout = 0.01
buf = b""
t0 = time.time()
prompt_seen = False
while time.time() - t0 < 12:
    buf += ser.read(512)
    if b"reboot system" in buf:
        prompt_seen = True
        break
print(f"after preamble, raw bootloader output ({len(buf)}B):", flush=True)
print(repr(buf[-500:]), flush=True)
if not prompt_seen:
    print("NO reboot prompt — aborting", flush=True)
    sys.exit(2)

# 4. answer 'n', send model payload
time.sleep(1)
ser.reset_input_buffer()
ser.write(b"n\r")
time.sleep(0.3)
ser.timeout = 2
print("sending model payload...", flush=True)
sent = [0]; total = math.ceil(len(data)/128)
def cb(tp, sc, er):
    if tp - sent[0] >= 1000:
        sent[0] = tp
        print(f"  {tp}/{total} ({100*tp//total}%)", flush=True)
ok = modem.send(io.BytesIO(data), retry=30, callback=cb)
print(f"model send returned {ok}", flush=True)

# 5. final reboot prompt -> y
ser.timeout = 0.01
buf = b""
t0 = time.time()
while time.time() - t0 < 20:
    buf += ser.read(512)
    if b"reboot system" in buf:
        break
time.sleep(0.5)
ser.write(b"y\r")
print("sent 'y' — rebooting. FLASH COMPLETE", flush=True)
time.sleep(4)
print("boot tail:", repr(ser.read(4096)[-300:]), flush=True)
ser.close()
