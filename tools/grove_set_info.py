#!/usr/bin/env python3
"""Register a flashed model with the SSCMA firmware via AT+INFO.

Run AFTER flashing model to 0x400000 with himax_xmodem_send.py. Without this,
AT+INVOKE runs but the model metadata/classes aren't set.

Usage: grove_set_info.py "<name>" "<comma,separated,classes>" [size] [port]
"""
import sys, time, json, base64, serial
name    = sys.argv[1] if len(sys.argv) > 1 else "rodent v1"
classes = (sys.argv[2].split(",") if len(sys.argv) > 2 else ["rodent"])
size    = sys.argv[3] if len(sys.argv) > 3 else "0"
PORT    = sys.argv[4] if len(sys.argv) > 4 else "/dev/cu.usbmodem5B420584031"

model = {"name": name, "version": "1.0.0", "category": "Object Detection",
         "model_type": "TFLite", "algorithm": "YOLO", "description": "Custom Model",
         "classes": classes, "size": str(size), "isCustom": True}
info = base64.b64encode(json.dumps(model).encode()).decode()

s = serial.Serial(PORT, 921600, timeout=0.05)
s.rts=False; time.sleep(0.1); s.rts=True; time.sleep(2.5); s.reset_input_buffer()
def q(cmd, wait=2):
    s.write(cmd.encode()+b"\r\n"); time.sleep(wait); return s.read(16384).decode(errors="replace").strip()
print("AT+INFO ->", q(f'AT+INFO="{info}"')[-160:])
print("verify   ->", q("AT+INFO?")[-120:])
print("invoke   ->", q("AT+INVOKE=1,0,1", 4).split("\n")[-1][:300])
s.write(b"AT+BREAK\r\n"); time.sleep(0.2); s.close()
