#!/usr/bin/env python3
"""Empirical diagnostic: replicate SenseCraft xmodem exactly + log every byte.

Goal: see what the bootloader actually does after the config block (the step
that fails), instead of guessing. Tests two hypotheses after config:
  (a) it prints 'reboot system?' prompt  (b) it sends 'C' ready for next file.
"""
import sys, time
import serial

PORT = "/dev/cu.usbmodem5B420584031"
ADDR = 0x400000
SOH, EOT, ACK, NAK, CRC_C, CAN, FILLER = 0x01, 0x04, 0x06, 0x15, 0x43, 0x18, 0x1a

def crc16_xmodem(data):
    crc = 0
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if (crc & 0x8000) else (crc << 1) & 0xFFFF
    return crc

ser = serial.Serial(PORT, 921600, timeout=1)

def log(msg): print(msg, flush=True)
def hexdump(b): return ' '.join(f'{x:02x}' for x in b)

def hard_reset():
    ser.rts = False; time.sleep(0.1); ser.rts = True; time.sleep(0.1)

def enter_bootloader():
    hard_reset()
    ser.timeout = 0.01
    ser.reset_input_buffer()
    buf = b""; t0 = time.time()
    while time.time() - t0 < 15:
        ser.write(b"1"); buf += ser.read(128)
        if b"Xmodem download and burn FW image" in buf:
            ser.write(b"1"); time.sleep(0.1); ser.reset_input_buffer()
            log("  [bootloader menu seen, burn selected]")
            return True
        time.sleep(0.01)
    log(f"  [enter_bootloader FAIL] tail={buf[-120:]!r}")
    return False

def read1(timeout=10):
    ser.timeout = timeout
    d = ser.read(1)
    return d[0] if d else None

def xmodem_send(data, label):
    """Faithful port of sc_xmodem.ts send() with logging."""
    # waitStart: expect 'C'
    log(f"  [{label}] waitStart (expect 'C'=0x43)...")
    t0 = time.time(); started = False
    while time.time() - t0 < 15:
        c = read1(3)
        if c is not None:
            log(f"    waitStart got: 0x{c:02x}")
            if c == CRC_C:
                started = True; break
    if not started:
        log(f"  [{label}] never got 'C'"); return False
    # send blocks
    block = 1; offset = 0; total = (len(data)+127)//128
    while offset < len(data):
        chunk = bytearray([FILLER])*128
        chunk = bytearray(b"\x1a"*128)
        seg = data[offset:offset+128]
        chunk[:len(seg)] = seg
        crc = crc16_xmodem(bytes(chunk))
        packet = bytes([SOH, block & 0xff, (0xff-block) & 0xff]) + bytes(chunk) + bytes([crc>>8, crc&0xff])
        ser.write(packet)
        resp = read1(10)
        if resp == ACK:
            block += 1; offset += 128
        elif resp == NAK:
            log(f"    block {block}: NAK, resend")
        else:
            log(f"    block {block}: unexpected resp={resp!r} (0x{resp:02x})" if resp is not None else f"    block {block}: timeout")
            return False
    # EOT
    ser.write(bytes([EOT]))
    resp = read1(10)
    log(f"  [{label}] sent {total} block(s), EOT -> resp={'0x%02x'%resp if resp is not None else 'None'}")
    return resp == ACK

def capture(label, secs=15):
    ser.timeout = 0.01
    buf = b""; t0 = time.time()
    while time.time() - t0 < secs:
        buf += ser.read(256)
    log(f"  [{label}] {len(buf)} bytes raw:")
    log(f"    hex: {hexdump(buf[:120])}")
    log(f"    asc: {buf[:200]!r}")
    return buf

# ---- run ----
log("== enter bootloader ==")
if not enter_bootloader(): sys.exit(1)

log("== send config block (0xC0 0x5A redirect to 0x%X) ==" % ADDR)
config = bytearray(b"\xff"*128)
config[0]=0xC0; config[1]=0x5A
config[2]=ADDR & 0xff; config[3]=(ADDR>>8)&0xff; config[4]=(ADDR>>16)&0xff; config[5]=(ADDR>>24)&0xff
config[6]=config[7]=config[8]=config[9]=0
config[10]=0x5A; config[11]=0xC0
ok = xmodem_send(bytes(config), "config")
log(f"config xmodem ok={ok}")

log("== CAPTURE what bootloader says after config (15s) ==")
capture("post-config", 15)
ser.close()
