#!/usr/bin/env python3
"""Probe a Grove Vision AI V2 over USB serial using the SSCMA AT protocol.

The WiseEye2 firmware speaks an AT-command protocol at 921600 baud.
Responses are JSON lines: \r{"type":0,"name":"...","code":0,"data":{...}}\n
"""
import json
import sys
import time

import serial

PORT = sys.argv[1] if len(sys.argv) > 1 else "/dev/cu.usbmodem5B420584031"
BAUD = 921600

CMDS = [
    "AT+ID?",
    "AT+NAME?",
    "AT+VER?",
    "AT+STAT?",
    "AT+INFO?",
    "AT+MODEL?",
    "AT+ALGOS?",
    "AT+MODELS?",
    "AT+SENSORS?",
]


def read_responses(ser, timeout=2.0):
    """Read JSON lines until quiet for `timeout` seconds."""
    out = []
    buf = b""
    deadline = time.time() + timeout
    while time.time() < deadline:
        chunk = ser.read(4096)
        if chunk:
            buf += chunk
            deadline = time.time() + 0.5
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            line = line.strip(b"\r ")
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                out.append({"raw": line[:200].decode(errors="replace")})
    return out


def main():
    ser = serial.Serial(PORT, BAUD, timeout=0.1)
    time.sleep(0.3)
    ser.reset_input_buffer()

    # Break any in-progress sampling/invoke loop first
    ser.write(b"AT+BREAK\r\n")
    time.sleep(0.3)
    ser.reset_input_buffer()

    for cmd in CMDS:
        ser.write(cmd.encode() + b"\r\n")
        resp = read_responses(ser)
        print(f"=== {cmd}")
        for r in resp:
            # Model info payloads can be huge (base64) — trim
            s = json.dumps(r)
            print(s[:600] + ("..." if len(s) > 600 else ""))
    ser.close()


if __name__ == "__main__":
    main()
