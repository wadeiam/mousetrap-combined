#!/usr/bin/env python3
"""Flash a model to Grove Vision AI V2 at a flash address (default 0x400000).

Faithful port of HimaxWiseEyePlus xmodem_send.py --model flow, with AT+RST
to enter the bootloader (no button press needed).

Usage: grove_flash_model.py <model.tflite> [position_hex] [port]
"""
import io
import math
import sys
import time

import serial as pyserial
from xmodem import XMODEM

MODEL = sys.argv[1] if len(sys.argv) > 1 else None
POSITION = int(sys.argv[2], 16) if len(sys.argv) > 2 else 0x400000
PORT = sys.argv[3] if len(sys.argv) > 3 else "/dev/cu.usbmodem5B420584031"

if not MODEL:
    sys.exit("usage: grove_flash_model.py <model.tflite> [position_hex] [port]")

data = open(MODEL, "rb").read()
print(f"Model {len(data)} bytes -> 0x{POSITION:X} on {PORT}")

ser = pyserial.Serial(PORT, 921600, timeout=1)

def at(cmd):
    ser.write(cmd.encode() + b"\r")

# Reboot into bootloader via the app's AT+RST, catching the 100ms window
ser.timeout = 0.01
ser.reset_input_buffer()
ser.write(b"AT+RST\r\n")
print("AT+RST sent; spamming '1' to catch bootloader...")
rbuf = b""
t0 = time.time()
while time.time() - t0 < 25:
    ser.write(b"1")
    rbuf += ser.read(256)
    if b"Send data using the xmodem protocol from your terminal" in rbuf:
        break
else:
    sys.exit(f"bootloader not caught. RX tail: {rbuf[-300:]!r}")
print("In xmodem burn mode.")

# Himax model-only sequence: '1', then 'n', then preamble, 'n', then payload
time.sleep(1)
ser.reset_input_buffer()
at("1")
time.sleep(1)
ser.reset_input_buffer()
at("n")

preamble = bytes([0xC0, 0x5A]) + POSITION.to_bytes(4, "little") + \
    (0).to_bytes(4, "little") + bytes([0x5A, 0xC0]) + b"\xFF" * 116

ser.timeout = 1
modem = XMODEM(lambda size, timeout=1: ser.read(size) or None,
               lambda d, timeout=1: ser.write(d) or None, mode="xmodem")
print("sending preamble...")
if not modem.send(io.BytesIO(preamble)):
    sys.exit("preamble send failed")

# Wait for the reboot question, answer n (more files coming)
ser.timeout = 0.01
rbuf = b""
t0 = time.time()
while time.time() - t0 < 30:
    rbuf += ser.read(256)
    if b"Do you want to end file transmission and reboot system" in rbuf:
        break
else:
    sys.exit(f"no prompt after preamble. RX: {rbuf[-300:]!r}")
time.sleep(1)
ser.reset_input_buffer()
at("n")

print("sending model payload...")
ser.timeout = 1
sent = [0]
total = math.ceil(len(data) / 128)

def progress(total_packets, success, errors):
    if total_packets - sent[0] >= 800:
        sent[0] = total_packets
        print(f"  {total_packets}/{total} packets ({100*total_packets//total}%)")

if not modem.send(io.BytesIO(data), retry=30, callback=progress):
    sys.exit("model send failed")

# Final prompt -> y (reboot)
ser.timeout = 0.01
rbuf = b""
t0 = time.time()
while time.time() - t0 < 30:
    rbuf += ser.read(256)
    if b"Do you want to end file transmission and reboot system" in rbuf:
        break
time.sleep(1)
ser.reset_input_buffer()
at("y")
print("FLASH COMPLETE — device rebooting")

# capture reboot banner briefly
t0 = time.time()
rbuf = b""
while time.time() - t0 < 6:
    rbuf += ser.read(1024)
print(f"boot: ...{rbuf[-300:]!r}")
ser.close()
