#!/usr/bin/env python3
"""Live inference smoke test for Grove Vision AI V2.

Runs continuous INVOKE and prints detections. With the stock COCO YOLO11n
model, class 0 = person — wave at the camera to see boxes.

Usage: grove_invoke.py [seconds] [port]
"""
import json
import re
import sys
import time

import serial

SECS = int(sys.argv[1]) if len(sys.argv) > 1 else 30
PORT = sys.argv[2] if len(sys.argv) > 2 else "/dev/cu.usbmodem5B420584031"

# COCO class names (YOLO order) for readable labels
COCO = ["person","bicycle","car","motorcycle","airplane","bus","train","truck",
        "boat","traffic light","fire hydrant","stop sign","parking meter","bench",
        "bird","cat","dog","horse","sheep","cow","elephant","bear","zebra","giraffe"]

ser = serial.Serial(PORT, 921600, timeout=0.05)
time.sleep(0.3)
ser.reset_input_buffer()

def send(cmd, wait=1.5):
    ser.write(cmd.encode() + b"\r\n")
    buf = b""
    t0 = time.time()
    while time.time() - t0 < wait:
        buf += ser.read(4096)
    return buf.decode(errors="replace")

print("MODEL?:", send("AT+MODEL?").strip()[-200:])
print("TSCORE=45:", send("AT+TSCORE=45").strip()[-120:])
print("Starting continuous invoke — show yourself to the camera...\n")

# N_TIMES=0 -> continuous; DIFFERED=0; RESULT_ONLY=1 (no image payload)
ser.write(b"AT+INVOKE=0,0,1\r\n")

buf = b""
t0 = time.time()
frames = 0
hits = 0
last_report = 0
while time.time() - t0 < SECS:
    chunk = ser.read(8192)
    if chunk:
        buf += chunk
    # extract complete JSON events framed as \r{...}\n
    for m in re.findall(rb'\r(\{.*?\})\n', buf, re.DOTALL):
        try:
            obj = json.loads(m)
        except Exception:
            continue
        if obj.get("name") == "INVOKE" and obj.get("type") == 1:
            frames += 1
            boxes = obj.get("data", {}).get("boxes", [])
            perf = obj.get("data", {}).get("perf", [])
            if boxes:
                hits += 1
                labels = []
                for b in boxes:
                    x, y, w, h, score, cid = b[:6]
                    name = COCO[cid] if cid < len(COCO) else f"cls{cid}"
                    labels.append(f"{name}({score}%) @[{x},{y},{w},{h}]")
                infer_ms = perf[1] if len(perf) > 1 else "?"
                print(f"[{time.time()-t0:5.1f}s] {len(boxes)} det, {infer_ms}ms: " + ", ".join(labels))
    buf = buf[-2000:]  # keep tail for partial frames

ser.write(b"AT+BREAK\r\n")
time.sleep(0.2)
ser.close()
print(f"\n--- {frames} frames processed, {hits} with detections ---")
