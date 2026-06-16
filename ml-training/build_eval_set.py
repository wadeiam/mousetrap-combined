#!/usr/bin/env python3
"""Layer 1 — build a FIXED held-out eval set for regression testing.

A regression harness needs the SAME images every run. This downloads a small,
fixed-seed sample of rodent positives + hard negatives (people/pets/empty) into
a YOLO-format dir and writes eval.yaml. Commit the resulting image-id manifest
(eval_manifest.json) so the set is reproducible and — importantly — so training
can EXCLUDE these ids and keep the eval set disjoint.

Run once (Colab or anywhere with internet); reuse the output for every eval.

Usage: python3 build_eval_set.py --out /content/eval_set [--per-class 100]
"""
import argparse
import json
import random
import urllib.request
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Disjoint-from-training seed. Training uses 42; this uses 999 AND writes a
# manifest of chosen image ids so the trainer can subtract them.
EVAL_SEED = 999
CI_ANN = "https://storage.googleapis.com/public-datasets-lila/channel-islands-camera-traps/channel-islands-camera-traps.json.zip"
CI_IMG = "https://storage.googleapis.com/public-datasets-lila/channel-islands-camera-traps/images/"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--per-class", type=int, default=100)
    args = ap.parse_args()
    random.seed(EVAL_SEED)

    out = Path(args.out)
    (out / "images").mkdir(parents=True, exist_ok=True)
    (out / "labels").mkdir(parents=True, exist_ok=True)
    work = out / "_src"
    work.mkdir(exist_ok=True)

    ann_zip = work / "ci.json.zip"
    if not ann_zip.exists():
        print("downloading Channel Islands annotations...")
        urllib.request.urlretrieve(CI_ANN, ann_zip)
    if not list(work.glob("*.json")):
        with zipfile.ZipFile(ann_zip) as zf:
            zf.extractall(work)
    coco = json.loads(next(work.glob("*.json")).read_text())

    cats = {c["id"]: c["name"] for c in coco["categories"]}
    rod = {cid for cid, n in cats.items() if any(k in n.lower() for k in ("rodent", "mouse", "rat"))}
    empty = {cid for cid, n in cats.items() if n.lower() == "empty"}
    by_img = defaultdict(list)
    for a in coco["annotations"]:
        by_img[a["image_id"]].append(a)
    imgs = {im["id"]: im for im in coco["images"]}

    pos, neg = [], []
    for img_id, anns in by_img.items():
        c = {a["category_id"] for a in anns}
        if c & rod and any("bbox" in a for a in anns):
            pos.append(img_id)
        elif not (c & rod) and not (c & empty):
            neg.append(img_id)
    random.shuffle(pos); random.shuffle(neg)
    pos = pos[:args.per_class]; neg = neg[:args.per_class]
    print(f"eval set: {len(pos)} rodent, {len(neg)} negatives")

    manifest = {"seed": EVAL_SEED, "rodent_ids": pos, "negative_ids": neg}

    def fetch(img_id, is_pos):
        info = imgs[img_id]; fn = info["file_name"]; w, h = info["width"], info["height"]
        safe = "ci_" + fn.replace("/", "_")
        ip = out / "images" / safe; lp = out / "labels" / (Path(safe).stem + ".txt")
        if ip.exists() and lp.exists():
            return True
        try:
            urllib.request.urlretrieve(CI_IMG + fn, ip)
        except Exception:
            return False
        lines = []
        if is_pos:
            for a in by_img[img_id]:
                if a["category_id"] not in rod or "bbox" not in a:
                    continue
                bx, by, bw, bh = a["bbox"]
                lines.append(f"0 {(bx+bw/2)/w:.6f} {(by+bh/2)/h:.6f} {bw/w:.6f} {bh/h:.6f}")
        lp.write_text("\n".join(lines))
        return True

    jobs = [(i, True) for i in pos] + [(i, False) for i in neg]
    ok = 0
    with ThreadPoolExecutor(max_workers=16) as ex:
        futs = [ex.submit(fetch, i, p) for i, p in jobs]
        for f in as_completed(futs):
            ok += bool(f.result())
    print(f"downloaded {ok}/{len(jobs)}")

    (out / "eval_manifest.json").write_text(json.dumps(manifest, indent=2))
    (out / "eval.yaml").write_text(
        f"path: {out}\ntrain: images\nval: images\nnames:\n  0: rodent\n")
    print(f"wrote {out/'eval.yaml'} and {out/'eval_manifest.json'}")
    print("Keep eval_manifest.json — exclude these image ids from training to stay disjoint.")


if __name__ == "__main__":
    main()
