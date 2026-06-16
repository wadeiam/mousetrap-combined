#!/usr/bin/env python3
"""Headless rodent-detector training for a GCP GPU VM (no Colab, no babysitting).

Same pipeline as ml-training/grove_train.ipynb but writes everything to GCS and
runs unattended. Datasets: Channel Islands + Island Conservation + NZ TrailCams
(MegaDetector-boxed) + COCO negatives. All public — zero local data.

Artifacts/logs stream to gs://$BUCKET/runs/$RUN_ID/. The MegaDetector label
cache lives at gs://$BUCKET/cache/nz_md_labels.json so re-runs never redo MD.

Env: BUCKET (required), RUN_ID (default 'run'), VALIDATION_MODE ('1' for smoke),
plus MAX_* / EPOCHS overrides. Designed to be invoked by startup.sh.
"""
import json
import os
import random
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

random.seed(42)
BUCKET = os.environ["BUCKET"]
RUN_ID = os.environ.get("RUN_ID", "run")
VALID = os.environ.get("VALIDATION_MODE") == "1"
GCS_RUN = f"gs://{BUCKET}/runs/{RUN_ID}"
GCS_CACHE = f"gs://{BUCKET}/cache"
WORK = Path("/content/work" if Path("/content").exists() else "/tmp/work")
DATA = WORK / "dataset"
for s in ("images", "labels"):
    (DATA / s).mkdir(parents=True, exist_ok=True)

MAX_CI_RODENT = 60 if VALID else int(os.environ.get("MAX_CI_RODENT", 8000))
MAX_CI_NEG    = 20 if VALID else int(os.environ.get("MAX_CI_NEG", 2000))
MAX_IC_RODENT = 40 if VALID else int(os.environ.get("MAX_IC_RODENT", 6000))
MAX_IC_NEG    = 20 if VALID else int(os.environ.get("MAX_IC_NEG", 2000))
MAX_COCO_NEG  = 20 if VALID else int(os.environ.get("MAX_COCO_NEG", 3000))
MAX_NZ_MOUSE  = 30 if VALID else int(os.environ.get("MAX_NZ_MOUSE", 4000))
MAX_NZ_RAT    = 20 if VALID else int(os.environ.get("MAX_NZ_RAT", 2000))
MD_CONF       = float(os.environ.get("MD_CONF", 0.2))
EPOCHS        = 5 if VALID else int(os.environ.get("EPOCHS", 60))
IMGSZ         = 192


def log(msg):
    print(msg, flush=True)
    with open("/tmp/train.log", "a") as f:   # push_log() streams this to GCS
        f.write(str(msg) + "\n")


def gsutil(*args):
    subprocess.run(["gsutil", "-q", *args], check=False)


def push_log():
    gsutil("cp", "/tmp/train.log", f"{GCS_RUN}/train.log")


# ---------------- datasets ----------------
def channel_islands():
    root = "https://storage.googleapis.com/public-datasets-lila/channel-islands-camera-traps/"
    base = root + "images/"   # images live under /images/; annotation zip at root
    d = WORK / "ci"; d.mkdir(exist_ok=True)
    z = d / "ann.zip"
    if not z.exists():
        urllib.request.urlretrieve(root + "channel-islands-camera-traps.json.zip", z)
    if not list(d.glob("*.json")):
        zipfile.ZipFile(z).extractall(d)
    coco = json.loads(next(d.glob("*.json")).read_text())
    cats = {c["id"]: c["name"] for c in coco["categories"]}
    rod = {i for i, n in cats.items() if any(k in n.lower() for k in ("rodent", "mouse", "rat"))}
    empt = {i for i, n in cats.items() if n.lower() == "empty"}
    by = defaultdict(list)
    for a in coco["annotations"]:
        by[a["image_id"]].append(a)
    imgs = {im["id"]: im for im in coco["images"]}
    pos, neg = [], []
    for iid, anns in by.items():
        c = {a["category_id"] for a in anns}
        if c & rod and any("bbox" in a for a in anns):
            pos.append(iid)
        elif not (c & rod) and not (c & empt):
            neg.append(iid)
    random.shuffle(pos); random.shuffle(neg)
    _download(pos[:MAX_CI_RODENT], neg[:MAX_CI_NEG], imgs, by, rod, base, "ci")


def island_conservation():
    base = "https://storage.googleapis.com/public-datasets-lila/islandconservationcameratraps/public/"
    d = WORK / "ic"; d.mkdir(exist_ok=True)
    z = d / "ann.zip"
    if not z.exists():
        urllib.request.urlretrieve(
            "https://storage.googleapis.com/public-datasets-lila/islandconservationcameratraps/island_conservation_camera_traps_1.02.zip", z)
    if not list(d.glob("*.json")):
        zipfile.ZipFile(z).extractall(d)
    coco = json.loads(next(d.glob("*.json")).read_text())
    cats = {c["id"]: c["name"] for c in coco["categories"]}
    rod = {i for i, n in cats.items() if any(k in n.lower() for k in ("rat", "mouse", "rodent"))}
    skip = {i for i, n in cats.items() if n.lower() in ("empty", "unknown", "human")}
    by = defaultdict(list)
    for a in coco["annotations"]:
        by[a["image_id"]].append(a)
    imgs = {im["id"]: im for im in coco["images"]}
    pos, neg = [], []
    for iid, anns in by.items():
        c = {a["category_id"] for a in anns}
        if c & rod and any("bbox" in a for a in anns):
            pos.append(iid)
        elif not (c & rod) and not (c & skip):
            neg.append(iid)
    random.shuffle(pos); random.shuffle(neg)
    _download(pos[:MAX_IC_RODENT], neg[:MAX_IC_NEG], imgs, by, rod, base, "ic")


def _download(pos, neg, imgs, by, rod, base, tag):
    from PIL import Image

    def one(iid, is_pos):
        info = imgs[iid]; fn = info["file_name"]
        w, h = info.get("width"), info.get("height")
        safe = f"{tag}_" + fn.replace("/", "_")
        ip = DATA / "images" / safe; lp = DATA / "labels" / (Path(safe).stem + ".txt")
        if ip.exists() and lp.exists():
            return True
        try:
            urllib.request.urlretrieve(base + fn, ip)
        except Exception:
            return False
        if not (w and h):
            try:
                with Image.open(ip) as im:
                    w, h = im.size
            except Exception:
                ip.unlink(missing_ok=True); return False
        lines = []
        if is_pos:
            for a in by[iid]:
                if a["category_id"] not in rod or "bbox" not in a:
                    continue
                bx, byy, bw, bh = a["bbox"]
                lines.append(f"0 {(bx+bw/2)/w:.6f} {(byy+bh/2)/h:.6f} {bw/w:.6f} {bh/h:.6f}")
        lp.write_text("\n".join(lines))
        return True

    jobs = [(i, True) for i in pos] + [(i, False) for i in neg]
    ok = 0
    with ThreadPoolExecutor(max_workers=32) as ex:
        for f in as_completed([ex.submit(one, i, p) for i, p in jobs]):
            ok += bool(f.result())
    log(f"{tag}: {ok}/{len(jobs)} images")


def coco_negatives():
    if MAX_COCO_NEG <= 0:
        return
    d = WORK / "coco"; d.mkdir(exist_ok=True)
    ann = d / "annotations" / "instances_val2017.json"
    if not ann.exists():
        z = d / "ann.zip"
        urllib.request.urlretrieve("http://images.cocodataset.org/annotations/annotations_trainval2017.zip", z)
        zipfile.ZipFile(z).extract("annotations/instances_val2017.json", d)
    from pycocotools.coco import COCO
    c = COCO(str(ann))
    ids = set()
    for cid in c.getCatIds(catNms=["person", "cat", "dog", "bird"]):
        ids |= set(c.getImgIds(catIds=[cid]))
    ids = list(ids); random.shuffle(ids); ids = ids[:MAX_COCO_NEG]

    def one(iid):
        fn = c.loadImgs(iid)[0]["file_name"]
        ip = DATA / "images" / ("coco_" + fn); lp = DATA / "labels" / ("coco_" + Path(fn).stem + ".txt")
        if ip.exists() and lp.exists():
            return True
        try:
            urllib.request.urlretrieve(f"http://images.cocodataset.org/val2017/{fn}", ip)
        except Exception:
            return False
        lp.write_text("")
        return True
    ok = 0
    with ThreadPoolExecutor(max_workers=32) as ex:
        for f in as_completed([ex.submit(one, i) for i in ids]):
            ok += bool(f.result())
    log(f"coco negatives: {ok}/{len(ids)}")


def nz_megadetector():
    if MAX_NZ_MOUSE + MAX_NZ_RAT <= 0:
        return
    import ijson
    from PIL import Image
    from megadetector.detection import run_detector

    base = "https://storage.googleapis.com/public-datasets-lila/nz-trailcams/"
    d = WORK / "nz"; d.mkdir(exist_ok=True)
    z = d / "nz.json.zip"
    if not z.exists():
        urllib.request.urlretrieve(base + "trail_camera_images_of_new_zealand_animals_1.00.json.zip", z)
    if not list(d.glob("*.json")):
        zipfile.ZipFile(z).extractall(d)
    meta = next(d.glob("*.json"))

    want = {"mouse": MAX_NZ_MOUSE, "rat": MAX_NZ_RAT}
    picked = {"mouse": [], "rat": []}
    with open(meta, "rb") as fh:
        for im in ijson.items(fh, "images.item"):
            sp = im.get("species")
            if sp in want and len(picked[sp]) < want[sp]:
                picked[sp].append(im["file_name"])
            if all(len(picked[s]) >= want[s] for s in want):
                break
    files = picked["mouse"] + picked["rat"]  # deterministic order for cache reuse
    log(f"NZ sampled: {len(picked['mouse'])} mouse, {len(picked['rat'])} rat")

    # MD label cache in GCS (never redo MD across runs)
    cache_local = WORK / "nz_md_labels.json"
    gsutil("cp", f"{GCS_CACHE}/nz_md_labels.json", str(cache_local))
    nz_cache = json.loads(cache_local.read_text()) if cache_local.exists() else {}
    log(f"MD cache: {len(nz_cache)} entries")

    def save_cache():
        cache_local.write_text(json.dumps(nz_cache))
        gsutil("cp", str(cache_local), f"{GCS_CACHE}/nz_md_labels.json")

    md = run_detector.load_detector("MDV5A")

    def one(fn):
        safe = "nz_" + fn.replace("/", "_")
        ip = DATA / "images" / safe; lp = DATA / "labels" / (Path(safe).stem + ".txt")
        if fn in nz_cache:
            label = nz_cache[fn]
        else:
            try:
                urllib.request.urlretrieve(base + fn, ip)
                img = Image.open(ip).convert("RGB")
            except Exception:
                ip.unlink(missing_ok=True); return False
            label = []
            for det in md.generate_detections_one_image(img).get("detections", []):
                if str(det.get("category")) != "1" or det.get("conf", 0) < MD_CONF:
                    continue
                x, y, bw, bh = det["bbox"]
                label.append(f"0 {x+bw/2:.6f} {y+bh/2:.6f} {bw:.6f} {bh:.6f}")
            nz_cache[fn] = label
        if not label:
            ip.unlink(missing_ok=True); return False
        if not ip.exists():
            try:
                urllib.request.urlretrieve(base + fn, ip)
            except Exception:
                return False
        lp.write_text("\n".join(label))
        return True

    ok = 0
    for i, fn in enumerate(files):
        ok += bool(one(fn))
        if (i + 1) % 250 == 0:
            log(f"  NZ {i+1}/{len(files)} ({ok} boxed)"); save_cache(); push_log()
    save_cache()
    log(f"NZ+MegaDetector: {ok}/{len(files)} boxed")


# ---------------- train / export ----------------
def main():
    # Truncate any leftover log and push immediately so GCS reflects THIS run
    # from the start (avoids stale-read confusion across reruns of the same id).
    open("/tmp/train.log", "w").close()
    log(f"=== run {RUN_ID} validation={VALID} epochs={EPOCHS} ===")
    push_log()
    channel_islands(); push_log()
    island_conservation(); push_log()
    coco_negatives(); push_log()
    nz_megadetector(); push_log()

    all_imgs = sorted((DATA / "images").glob("*"))
    n_pos = sum(1 for im in all_imgs
                if (DATA / "labels" / (im.stem + ".txt")).exists()
                and (DATA / "labels" / (im.stem + ".txt")).read_text().strip())
    log(f"{len(all_imgs)} images, {n_pos} with boxes")
    min_pos = 30 if VALID else 200   # validation samples are tiny by design
    assert n_pos >= min_pos, f"too few positives ({n_pos}) — dataset download failed"

    random.shuffle(all_imgs)
    nval = max(1, int(len(all_imgs) * 0.15))
    for split, imgs in {"val": all_imgs[:nval], "train": all_imgs[nval:]}.items():
        (DATA / split / "images").mkdir(parents=True, exist_ok=True)
        (DATA / split / "labels").mkdir(parents=True, exist_ok=True)
        for im in imgs:
            shutil.move(str(im), DATA / split / "images" / im.name)
            lp = DATA / "labels" / (im.stem + ".txt")
            if lp.exists():
                shutil.move(str(lp), DATA / split / "labels" / lp.name)
    yaml = WORK / "rodent.yaml"
    yaml.write_text(f"path: {DATA}\ntrain: train/images\nval: val/images\nnames:\n  0: rodent\n")

    import torch
    from ultralytics import YOLO
    weights_dir = WORK / "runs" / "rodent" / "weights"

    def ckpt(trainer):  # stream best/last to GCS every epoch
        for n in ("best.pt", "last.pt"):
            p = weights_dir / n
            if p.exists():
                gsutil("cp", str(p), f"{GCS_RUN}/{n}")
        push_log()

    model = YOLO("yolo11n.pt")
    model.add_callback("on_fit_epoch_end", ckpt)
    model.train(data=str(yaml), epochs=EPOCHS, imgsz=IMGSZ,
                batch=64 if torch.cuda.is_available() else 8,
                device=0 if torch.cuda.is_available() else "cpu",
                patience=12, project=str(WORK / "runs"), name="rodent", exist_ok=True,
                hsv_h=0.01, hsv_s=0.4, hsv_v=0.5, degrees=5, translate=0.1,
                scale=0.4, fliplr=0.5, mosaic=0.7, mixup=0.0)
    best = weights_dir / "best.pt"
    log("training done"); push_log()

    metrics = YOLO(str(best)).val(data=str(yaml), imgsz=IMGSZ, verbose=False)
    (WORK / "metrics.json").write_text(json.dumps({
        "map50": float(metrics.box.map50), "map50_95": float(metrics.box.map),
        "precision": float(metrics.box.mp), "recall": float(metrics.box.mr)}))
    gsutil("cp", str(WORK / "metrics.json"), f"{GCS_RUN}/metrics.json")
    log(f"mAP50={metrics.box.map50:.4f} recall={metrics.box.mr:.4f}")

    exported = YOLO(str(best)).export(format="tflite", int8=True, imgsz=IMGSZ, data=str(yaml))
    edir = Path(exported).parent if Path(exported).is_file() else Path(exported)
    int8 = next(edir.glob("*full_integer_quant.tflite"))
    gsutil("cp", str(int8), f"{GCS_RUN}/rodent_int8.tflite")

    vela_ini = WORK / "vela.ini"
    vela_ini.write_text(VELA_INI)
    subprocess.run(["vela", str(int8), "--accelerator-config", "ethos-u55-64",
                    "--config", str(vela_ini), "--system-config", "My_Sys_Cfg",
                    "--memory-mode", "My_Mem_Mode_Parent",
                    "--output-dir", str(WORK / "vela")], check=True)
    vela_out = next((WORK / "vela").glob("*_vela.tflite"))
    gsutil("cp", str(vela_out), f"{GCS_RUN}/rodent_int8_vela.tflite")
    gsutil("cp", str(best), f"{GCS_RUN}/best.pt")
    log(f"DONE -> {GCS_RUN}/ (best.pt, rodent_int8.tflite, rodent_int8_vela.tflite, metrics.json)")
    push_log()


VELA_INI = """[System_Config.My_Sys_Cfg]
core_clock=400e6
axi0_port=Sram
axi1_port=OffChipFlash
Sram_clock_scale=1.0
Sram_burst_length=32
Sram_read_latency=16
Sram_write_latency=16
Dram_clock_scale=0.75
Dram_burst_length=128
Dram_read_latency=500
Dram_write_latency=250
OnChipFlash_clock_scale=0.25
OffChipFlash_clock_scale=0.015625
OffChipFlash_burst_length=32
OffChipFlash_read_latency=64
OffChipFlash_write_latency=64

[Memory_Mode.My_Mem_Mode_Parent]
const_mem_area=Axi1
arena_mem_area=Axi0
cache_mem_area=Axi0
"""

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        log("FAILED: " + repr(e)); log(traceback.format_exc()); push_log()
        sys.exit(1)
