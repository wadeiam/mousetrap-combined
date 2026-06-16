#!/usr/bin/env python3
"""Generate grove_train.ipynb — YOLO11n rodent detector for Grove Vision AI V2.

Run: python3 make_grove_notebook.py
"""
import json
from pathlib import Path

MD = "markdown"
CODE = "code"

cells = []


def cell(kind, src):
    cells.append({
        "cell_type": kind,
        "metadata": {},
        "source": src.splitlines(keepends=True),
        **({"outputs": [], "execution_count": None} if kind == CODE else {}),
    })


cell(MD, """# MouseTrap — Rodent Detector for Grove Vision AI V2 (Ethos-U55)

Trains a **single-class YOLO11n rodent detector** and compiles it for the
Grove Vision AI V2's Ethos-U55 NPU.

## ▶️ How to run (one click)
1. **Runtime → Change runtime type → T4 GPU** (free tier is fine)
2. **Runtime → Run all**
3. Walk away ~2–3 h. Approve the Google Drive prompt once early on.

The final artifact is `rodent_v1_int8_vela.tflite` in `MyDrive/mousetrap/`
(flash it to the Grove via SenseCraft AI).

### Disconnect-proof
Free Colab drops the runtime on idle/usage limits. To survive that, training
**checkpoints `best.pt` + `last.pt` to `MyDrive/mousetrap/` after every epoch**:
- **If it disconnects mid-training:** just reconnect and **Run all** again — it
  resumes from the last Drive checkpoint instead of starting over.
- **If you'd rather not retrain:** run cells 1 then 8→11; they load `best.pt`
  from Drive and finish the export/Vela/package steps from wherever it stopped.
- **Tip:** leave a browser tab open and check back occasionally — idle tabs are
  what trigger the disconnect.

---

**Pipeline:** camera-trap datasets → YOLO11n @ 192×192 → int8 full-integer
TFLite → Vela compile (`ethos-u55-64`) → Grove model at `0x400000`.

**Design:** Single class `rodent`. Cats/dogs/people/birds/foxes are included as
*background negatives* so the detector stays silent on them; species detail
stays server-side. Training data is 100% public, **zero manual labeling**:
- Channel Islands (~83K rodent boxes) + Island Conservation (~16K rat boxes)
- **NZ TrailCams** (1.2M mouse / 137K rat, classification-labeled) auto-boxed by
  **MegaDetector** — the biggest, most diverse rodent source
- COCO person/cat/dog/bird as hard negatives

None of this needs rodents at your site — the model generalizes from diverse
public camera-trap data (that's the product mission).
""")

cell(CODE, """# Cell 1: Setup — deps, GPU check, Drive persistence, config
# NOTE: no fiftyone — it downgrades Pillow and breaks `import ultralytics`
# (ImportError: cannot import name '_Ink' from 'PIL._typing'). We pull COCO
# negatives directly with pycocotools instead (Cell 5).
!pip install -q ultralytics ethos-u-vela pycocotools

import os
import json
import random
import shutil
import urllib.request
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import torch

random.seed(42)

# ── GPU check ───────────────────────────────────────────────────────────────
if torch.cuda.is_available():
    print(f'GPU: {torch.cuda.get_device_name(0)}')
else:
    print('⚠️  NO GPU DETECTED. Set Runtime → Change runtime type → T4 GPU, '
          'then Runtime → Run all. (Will still run on CPU but very slowly.)')

# ── Google Drive persistence (so a Colab disconnect never loses the model) ────
SAVE_TO_DRIVE = True   # set False to skip Drive and only auto-download at the end
DRIVE_DIR = None
if SAVE_TO_DRIVE:
    try:
        import datetime
        from google.colab import drive
        drive.mount('/content/drive')
        DRIVE_DIR = Path('/content/drive/MyDrive/mousetrap')
        DRIVE_DIR.mkdir(parents=True, exist_ok=True)
        # PROVE write access, not just that mount returned — write a real file
        # and read it back. Catches the "mounted but not writable" trap.
        proof = DRIVE_DIR / '_drive_connected.txt'
        proof.write_text(f'Drive write verified at {datetime.datetime.now().isoformat()}\\n')
        assert proof.read_text().startswith('Drive write verified'), 'readback failed'
        print(f'✅ Drive connected AND writable -> {DRIVE_DIR}')
        print(f'   Proof file written: {proof.name} '
              '(check MyDrive/mousetrap/ — may take a few seconds to show in the web UI)')
    except Exception as e:
        DRIVE_DIR = None
        print(f'❌ Drive mount/write FAILED ({e}). Fix before a long run, or '
              'accept browser-only auto-download at the end.')

WORK_DIR = Path('/content/mousetrap_grove')
WORK_DIR.mkdir(exist_ok=True)
DATASET_DIR = WORK_DIR / 'dataset'
for sub in ('images', 'labels'):
    (DATASET_DIR / sub).mkdir(parents=True, exist_ok=True)

# Single-class detector: the edge model only answers "rodent, where?"
CLASS_NAMES = ['rodent']

# ── PIPELINE VALIDATION vs FULL TRAINING ──
# Default is the v2 run: large public camera-trap sample (zero local data) plus
# NZ TrailCams auto-boxed by MegaDetector. Budget ~1.5-3 h on a T4 — fine with
# the per-epoch Drive checkpointing + caffeinate. Flip VALIDATION_MODE for a
# ~100-image CPU smoke test of the whole pipeline.
VALIDATION_MODE = False

MAX_CI_RODENT = 60 if VALIDATION_MODE else 8000   # Channel Islands rodent images
MAX_CI_NEG    = 20 if VALIDATION_MODE else 2000   # Channel Islands negatives (fox/skunk/bird)
MAX_IC_RODENT = 40 if VALIDATION_MODE else 6000   # Island Conservation rat images
MAX_IC_NEG    = 20 if VALIDATION_MODE else 2000   # Island Conservation negatives
MAX_COCO_NEG  = 20 if VALIDATION_MODE else 3000   # COCO person/pet/bird negatives

# NZ TrailCams (classification-labeled) auto-boxed by MegaDetector. Huge, diverse
# rodent source — the biggest quality lever, all public. MD inference is
# sequential (~5-10 img/s on T4), so this is the slowest cell; size accordingly.
USE_NZ_MEGADETECTOR = True
MAX_NZ_MOUSE  = 30 if VALIDATION_MODE else 4000
MAX_NZ_RAT    = 20 if VALIDATION_MODE else 2000
MD_CONF       = 0.2   # MegaDetector animal-confidence floor

EPOCHS  = 5 if VALIDATION_MODE else 60
IMGSZ   = 192

print(f'validation_mode={VALIDATION_MODE}  classes={CLASS_NAMES}  epochs={EPOCHS}')
""")

cell(CODE, """# Cell 2: Channel Islands Camera Traps — annotations
# ~83K rodent bboxes (deer mice) + fox/skunk/bird. COCO Camera Traps JSON.
CI_DIR = WORK_DIR / 'channel_islands'
CI_DIR.mkdir(exist_ok=True)
CI_ANN_URL = 'https://storage.googleapis.com/public-datasets-lila/channel-islands-camera-traps/channel-islands-camera-traps.json.zip'
CI_IMAGE_BASE = 'https://storage.googleapis.com/public-datasets-lila/channel-islands-camera-traps/images/'

ann_zip = CI_DIR / 'annotations.zip'
if not ann_zip.exists():
    print('Downloading Channel Islands annotations (~18MB)...')
    urllib.request.urlretrieve(CI_ANN_URL, ann_zip)
if not list(CI_DIR.glob('*.json')):
    with zipfile.ZipFile(ann_zip) as zf:
        zf.extractall(CI_DIR)

with open(next(CI_DIR.glob('*.json'))) as f:
    ci_coco = json.load(f)

ci_categories = {c['id']: c['name'] for c in ci_coco['categories']}
print('Categories:', ci_categories)

# rodent1 -> rodent (positive); fox/skunk/bird/other -> negative; skip 'empty'
RODENT_KEYWORDS = ('rodent', 'mouse', 'rat', 'vole', 'peromyscus')
ci_rodent_cats = {cid for cid, n in ci_categories.items()
                  if any(k in n.lower() for k in RODENT_KEYWORDS)}
ci_empty_cats = {cid for cid, n in ci_categories.items() if n.lower() == 'empty'}
print(f'rodent categories: {[ci_categories[c] for c in ci_rodent_cats]}')

ci_ann_by_image = defaultdict(list)
for ann in ci_coco['annotations']:
    ci_ann_by_image[ann['image_id']].append(ann)

ci_images_by_id = {img['id']: img for img in ci_coco['images']}
""")

cell(CODE, """# Cell 3: Channel Islands — select positives + negatives, download, label
ci_pos, ci_neg = [], []
for img_id, anns in ci_ann_by_image.items():
    cats = {a['category_id'] for a in anns}
    has_bbox = any('bbox' in a for a in anns)
    if cats & ci_rodent_cats and has_bbox:
        ci_pos.append(img_id)
    elif not (cats & ci_rodent_cats) and not (cats & ci_empty_cats):
        ci_neg.append(img_id)  # fox/skunk/bird — useful hard negatives

random.shuffle(ci_pos)
random.shuffle(ci_neg)
ci_pos = ci_pos[:MAX_CI_RODENT]
ci_neg = ci_neg[:MAX_CI_NEG]
print(f'Channel Islands: {len(ci_pos)} rodent images, {len(ci_neg)} negatives')


def fetch_ci(img_id, is_positive):
    info = ci_images_by_id[img_id]
    fn = info['file_name']
    w, h = info['width'], info['height']
    safe = 'ci_' + fn.replace('/', '_')
    img_path = DATASET_DIR / 'images' / safe
    lbl_path = DATASET_DIR / 'labels' / (Path(safe).stem + '.txt')
    if img_path.exists() and lbl_path.exists():
        return True
    try:
        urllib.request.urlretrieve(CI_IMAGE_BASE + fn, img_path)
    except Exception:
        return False
    lines = []
    if is_positive:
        for a in ci_ann_by_image[img_id]:
            if a['category_id'] not in ci_rodent_cats or 'bbox' not in a:
                continue
            bx, by, bw, bh = a['bbox']
            cx = max(0, min(1, (bx + bw / 2) / w))
            cy = max(0, min(1, (by + bh / 2) / h))
            lines.append(f'0 {cx:.6f} {cy:.6f} '
                         f'{max(0, min(1, bw / w)):.6f} {max(0, min(1, bh / h)):.6f}')
    lbl_path.write_text('\\n'.join(lines))  # negatives get an empty label file
    return True


jobs = [(i, True) for i in ci_pos] + [(i, False) for i in ci_neg]
ok = 0
with ThreadPoolExecutor(max_workers=16) as ex:
    futs = [ex.submit(fetch_ci, i, p) for i, p in jobs]
    for n, f in enumerate(as_completed(futs)):
        ok += bool(f.result())
        if (n + 1) % 500 == 0:
            print(f'  {n + 1}/{len(jobs)} ({ok} ok)')
print(f'Channel Islands done: {ok}/{len(jobs)}')
""")

cell(CODE, """# Cell 4: Island Conservation Camera Traps — ~16K rat bboxes
IC_DIR = WORK_DIR / 'island_conservation'
IC_DIR.mkdir(exist_ok=True)
IC_ANN_URL = 'https://storage.googleapis.com/public-datasets-lila/islandconservationcameratraps/island_conservation_camera_traps_1.02.zip'
IC_IMAGE_BASE = 'https://storage.googleapis.com/public-datasets-lila/islandconservationcameratraps/public/'

ann_zip = IC_DIR / 'annotations.zip'
if not ann_zip.exists():
    print('Downloading Island Conservation annotations (~5MB)...')
    urllib.request.urlretrieve(IC_ANN_URL, ann_zip)
if not list(IC_DIR.glob('*.json')):
    with zipfile.ZipFile(ann_zip) as zf:
        zf.extractall(IC_DIR)

with open(next(IC_DIR.glob('*.json'))) as f:
    ic_coco = json.load(f)

ic_categories = {c['id']: c['name'] for c in ic_coco['categories']}
ic_rodent_cats = {cid for cid, n in ic_categories.items()
                  if any(k in n.lower() for k in ('rat', 'mouse', 'rodent'))}
ic_empty_cats = {cid for cid, n in ic_categories.items()
                 if n.lower() in ('empty', 'unknown', 'human')}
print(f'IC rodent categories: {[ic_categories[c] for c in ic_rodent_cats]}')

ic_ann_by_image = defaultdict(list)
for ann in ic_coco['annotations']:
    ic_ann_by_image[ann['image_id']].append(ann)
ic_images_by_id = {img['id']: img for img in ic_coco['images']}

ic_pos, ic_neg = [], []
for img_id, anns in ic_ann_by_image.items():
    cats = {a['category_id'] for a in anns}
    has_bbox = any('bbox' in a for a in anns)
    if cats & ic_rodent_cats and has_bbox:
        ic_pos.append(img_id)
    elif not (cats & ic_rodent_cats) and not (cats & ic_empty_cats):
        ic_neg.append(img_id)  # cat/pig/goat/iguana/petrel negatives

random.shuffle(ic_pos)
random.shuffle(ic_neg)
ic_pos = ic_pos[:MAX_IC_RODENT]
ic_neg = ic_neg[:MAX_IC_NEG]
print(f'Island Conservation: {len(ic_pos)} rodent images, {len(ic_neg)} negatives')


def fetch_ic(img_id, is_positive):
    info = ic_images_by_id[img_id]
    fn = info['file_name']
    w, h = info.get('width'), info.get('height')
    safe = 'ic_' + fn.replace('/', '_')
    img_path = DATASET_DIR / 'images' / safe
    lbl_path = DATASET_DIR / 'labels' / (Path(safe).stem + '.txt')
    if img_path.exists() and lbl_path.exists():
        return True
    try:
        urllib.request.urlretrieve(IC_IMAGE_BASE + fn, img_path)
    except Exception:
        return False
    if not (w and h):  # some IC records lack dims; read from file
        try:
            from PIL import Image
            with Image.open(img_path) as im:
                w, h = im.size
        except Exception:
            img_path.unlink(missing_ok=True)
            return False
    lines = []
    if is_positive:
        for a in ic_ann_by_image[img_id]:
            if a['category_id'] not in ic_rodent_cats or 'bbox' not in a:
                continue
            bx, by, bw, bh = a['bbox']
            cx = max(0, min(1, (bx + bw / 2) / w))
            cy = max(0, min(1, (by + bh / 2) / h))
            lines.append(f'0 {cx:.6f} {cy:.6f} '
                         f'{max(0, min(1, bw / w)):.6f} {max(0, min(1, bh / h)):.6f}')
    lbl_path.write_text('\\n'.join(lines))
    return True


jobs = [(i, True) for i in ic_pos] + [(i, False) for i in ic_neg]
ok = 0
with ThreadPoolExecutor(max_workers=16) as ex:
    futs = [ex.submit(fetch_ic, i, p) for i, p in jobs]
    for n, f in enumerate(as_completed(futs)):
        ok += bool(f.result())
        if (n + 1) % 500 == 0:
            print(f'  {n + 1}/{len(jobs)} ({ok} ok)')
print(f'Island Conservation done: {ok}/{len(jobs)}')
""")

cell(CODE, """# Cell 5: COCO negatives — person/cat/dog/bird as background-only images
# The detector must stay quiet when a person or pet walks through the frame.
# Direct COCO download via pycocotools (no fiftyone — it conflicts with Pillow).
if MAX_COCO_NEG > 0:
    COCO_DIR = WORK_DIR / 'coco'
    COCO_DIR.mkdir(exist_ok=True)
    ann_json = COCO_DIR / 'annotations' / 'instances_val2017.json'
    if not ann_json.exists():
        ann_zip = COCO_DIR / 'ann.zip'
        print('Downloading COCO val2017 annotations (~241MB)...')
        urllib.request.urlretrieve(
            'http://images.cocodataset.org/annotations/annotations_trainval2017.zip',
            ann_zip)
        with zipfile.ZipFile(ann_zip) as zf:
            zf.extract('annotations/instances_val2017.json', COCO_DIR)

    from pycocotools.coco import COCO
    coco = COCO(str(ann_json))
    cat_ids = coco.getCatIds(catNms=['person', 'cat', 'dog', 'bird'])
    img_ids = set()
    for cid in cat_ids:
        img_ids |= set(coco.getImgIds(catIds=[cid]))
    img_ids = list(img_ids)
    random.shuffle(img_ids)
    img_ids = img_ids[:MAX_COCO_NEG]
    print(f'COCO negative candidates: {len(img_ids)}')

    def fetch_coco(img_id):
        info = coco.loadImgs(img_id)[0]
        fn = info['file_name']
        dst = DATASET_DIR / 'images' / ('coco_' + fn)
        lbl = DATASET_DIR / 'labels' / ('coco_' + Path(fn).stem + '.txt')
        if dst.exists() and lbl.exists():
            return True
        try:
            urllib.request.urlretrieve(
                f'http://images.cocodataset.org/val2017/{fn}', dst)
        except Exception:
            return False
        lbl.write_text('')  # background: no rodents here
        return True

    ok = 0
    with ThreadPoolExecutor(max_workers=16) as ex:
        futs = [ex.submit(fetch_coco, i) for i in img_ids]
        for n, f in enumerate(as_completed(futs)):
            ok += bool(f.result())
            if (n + 1) % 500 == 0:
                print(f'  {n + 1}/{len(img_ids)} ({ok} ok)')
    print(f'COCO negatives added: {ok}')
""")

cell(CODE, """# Cell 5b: NZ TrailCams + MegaDetector auto-labeled rodents
# NZ TrailCams is classification-labeled (each image has a `species`) but has no
# boxes. We sample mouse/rat images and run MegaDetector to draw the animal box,
# giving free YOLO positives at scale — the biggest quality lever, 100% public.
# Images that MD finds no animal in are dropped (avoids box-less positives).
if USE_NZ_MEGADETECTOR and (MAX_NZ_MOUSE + MAX_NZ_RAT) > 0:
    !pip install -q ijson megadetector
    import ijson
    from PIL import Image
    from megadetector.detection import run_detector

    NZ_DIR = WORK_DIR / 'nz'
    NZ_DIR.mkdir(exist_ok=True)
    NZ_META_URL = ('https://storage.googleapis.com/public-datasets-lila/'
                   'nz-trailcams/trail_camera_images_of_new_zealand_animals_1.00.json.zip')
    NZ_IMG_BASE = 'https://storage.googleapis.com/public-datasets-lila/nz-trailcams/'

    meta_zip = NZ_DIR / 'nz.json.zip'
    if not meta_zip.exists():
        print('Downloading NZ TrailCams metadata (~143MB)...')
        urllib.request.urlretrieve(NZ_META_URL, meta_zip)
    if not list(NZ_DIR.glob('*.json')):
        with zipfile.ZipFile(meta_zip) as zf:
            zf.extractall(NZ_DIR)
    nz_meta = next(NZ_DIR.glob('*.json'))

    # Stream-sample mouse/rat file_names (file is ~1.2GB — never load it all).
    want = {'mouse': MAX_NZ_MOUSE, 'rat': MAX_NZ_RAT}
    picked = {'mouse': [], 'rat': []}
    with open(nz_meta, 'rb') as fh:
        for im in ijson.items(fh, 'images.item'):
            sp = im.get('species')
            if sp in want and len(picked[sp]) < want[sp]:
                picked[sp].append(im['file_name'])
            if all(len(picked[s]) >= want[s] for s in want):
                break
    # Deterministic order (NO shuffle) so a resumed run picks the SAME files and
    # the MD cache below actually skips already-processed ones.
    files = picked['mouse'] + picked['rat']
    print(f"NZ sampled: {len(picked['mouse'])} mouse, {len(picked['rat'])} rat")

    # MD-LABEL CACHE on Drive: MegaDetector inference is the slow, expensive step.
    # Cache its result per file_name so a disconnect NEVER forces re-running MD.
    # (Images are re-downloaded on resume — cheap — but MD is never repeated.)
    nz_cache = {}
    NZ_LABEL_CACHE = (DRIVE_DIR / 'nz_md_labels.json') if DRIVE_DIR else None
    if NZ_LABEL_CACHE and NZ_LABEL_CACHE.exists():
        nz_cache = json.loads(NZ_LABEL_CACHE.read_text())
        print(f'loaded {len(nz_cache)} cached MD labels (skipping MD for these)')

    def save_nz_cache():
        if NZ_LABEL_CACHE:
            tmp = NZ_LABEL_CACHE.with_suffix('.tmp')
            tmp.write_text(json.dumps(nz_cache))
            tmp.replace(NZ_LABEL_CACHE)

    print('Loading MegaDetector (MDV5A) — downloads weights on first run...')
    md = run_detector.load_detector('MDV5A')

    # MD box format is normalized [x_min, y_min, w, h]; category '1' == animal.
    def nz_one(fn):
        safe = 'nz_' + fn.replace('/', '_')
        ip = DATASET_DIR / 'images' / safe
        lp = DATASET_DIR / 'labels' / (Path(safe).stem + '.txt')
        if fn in nz_cache:
            label = nz_cache[fn]            # cached MD result (list of YOLO lines)
        else:
            try:
                urllib.request.urlretrieve(NZ_IMG_BASE + fn, ip)
                img = Image.open(ip).convert('RGB')
            except Exception:
                ip.unlink(missing_ok=True)
                return False
            label = []
            res = md.generate_detections_one_image(img)
            for d in res.get('detections', []):
                if str(d.get('category')) != '1' or d.get('conf', 0) < MD_CONF:
                    continue
                x, y, bw, bh = d['bbox']
                label.append(f'0 {x+bw/2:.6f} {y+bh/2:.6f} {bw:.6f} {bh:.6f}')
            nz_cache[fn] = label            # remember MD result (even if empty)
        if not label:                       # MD saw no animal -> not a positive
            ip.unlink(missing_ok=True)
            return False
        if not ip.exists():                 # resumed run: re-fetch the image
            try:
                urllib.request.urlretrieve(NZ_IMG_BASE + fn, ip)
            except Exception:
                return False
        lp.write_text('\\n'.join(label))
        return True

    ok = 0
    for i, fn in enumerate(files):
        ok += bool(nz_one(fn))
        if (i + 1) % 250 == 0:
            print(f'  {i + 1}/{len(files)} ({ok} boxed)')
            save_nz_cache()                 # checkpoint MD labels to Drive
    save_nz_cache()
    print(f'NZ+MegaDetector done: {ok}/{len(files)} rodent images boxed')
else:
    print('NZ/MegaDetector step skipped (USE_NZ_MEGADETECTOR off or sizes 0)')
""")

cell(CODE, """# Cell 6: Train/val split + dataset YAML
# SANITY GUARD: a YOLO detector needs positive (boxed) labels. If image
# downloads failed (e.g. a wrong dataset URL), we'd silently end up with only
# empty background labels and train a useless model. Fail loudly instead.
all_images = sorted((DATASET_DIR / 'images').glob('*'))
def _has_box(img):
    lbl = DATASET_DIR / 'labels' / (img.stem + '.txt')
    return lbl.exists() and lbl.read_text().strip() != ''
n_pos = sum(_has_box(im) for im in all_images)
print(f'{len(all_images)} images total, {n_pos} with rodent boxes, '
      f'{len(all_images) - n_pos} backgrounds')
assert n_pos >= 200, (
    f'Only {n_pos} positive (boxed) images — dataset download likely failed. '
    'Check Cells 3/4 download counts and the dataset image URLs before training.')

random.shuffle(all_images)
n_val = max(1, int(len(all_images) * 0.15))
splits = {'val': all_images[:n_val], 'train': all_images[n_val:]}

for split, imgs in splits.items():
    img_dir = DATASET_DIR / split / 'images'
    lbl_dir = DATASET_DIR / split / 'labels'
    img_dir.mkdir(parents=True, exist_ok=True)
    lbl_dir.mkdir(parents=True, exist_ok=True)
    for img in imgs:
        lbl = DATASET_DIR / 'labels' / (img.stem + '.txt')
        shutil.move(str(img), img_dir / img.name)
        if lbl.exists():
            shutil.move(str(lbl), lbl_dir / lbl.name)
    print(f'{split}: {len(imgs)} images')

yaml_path = WORK_DIR / 'rodent.yaml'
yaml_path.write_text(f'''path: {DATASET_DIR}
train: train/images
val: val/images
names:
  0: rodent
''')
print(yaml_path.read_text())
""")

cell(CODE, """# Cell 7: Train YOLO11n @ 192 — disconnect-proof
# Colab (esp. free tier) drops the runtime on idle/usage limits, wiping its
# local disk. So we copy best.pt + last.pt to Drive AFTER EVERY EPOCH, and
# resume from Drive's last.pt if a previous run was interrupted. A disconnect
# at epoch 77 now leaves a usable model in Drive instead of losing everything.
import torch
from ultralytics import YOLO

device = 0 if torch.cuda.is_available() else 'cpu'
print(f'Training on: {device}')

RUN_DIR = WORK_DIR / 'runs' / 'rodent_v1'
WEIGHTS_DIR = RUN_DIR / 'weights'
BEST = WEIGHTS_DIR / 'best.pt'

def _ckpt_to_drive(trainer):
    '''Copy current best/last weights to Drive after each fit epoch.'''
    if not DRIVE_DIR:
        return
    try:
        for name in ('best.pt', 'last.pt'):
            src = WEIGHTS_DIR / name
            if src.exists():
                shutil.copy(src, DRIVE_DIR / name)
        ep = getattr(trainer, 'epoch', '?')
        print(f'  ↳ checkpointed epoch {ep} to Drive')
    except Exception as e:
        print(f'  ↳ Drive checkpoint failed (non-fatal): {e}')

# Resume from a Drive checkpoint if one exists from an interrupted run.
drive_last = (DRIVE_DIR / 'last.pt') if DRIVE_DIR else None
resume = bool(drive_last and drive_last.exists())
try:
    if resume:
        WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy(drive_last, WEIGHTS_DIR / 'last.pt')
        print(f'Resuming from Drive checkpoint: {drive_last}')
        model = YOLO(str(WEIGHTS_DIR / 'last.pt'))
        model.add_callback('on_fit_epoch_end', _ckpt_to_drive)
        results = model.train(resume=True)
    else:
        raise RuntimeError('no checkpoint — fresh run')
except Exception as e:
    if resume:
        print(f'Resume failed ({e}); starting fresh.')
    model = YOLO('yolo11n.pt')
    model.add_callback('on_fit_epoch_end', _ckpt_to_drive)
    results = model.train(
        data=str(WORK_DIR / 'rodent.yaml'),
        epochs=EPOCHS,
        imgsz=IMGSZ,
        batch=64 if device == 0 else 8,
        device=device,
        patience=12,
        project=str(WORK_DIR / 'runs'),
        name='rodent_v1',
        exist_ok=True,
        # camera-trap images are grayscale-ish IR at night; keep aug conservative
        hsv_h=0.01, hsv_s=0.4, hsv_v=0.5,
        degrees=5, translate=0.1, scale=0.4, fliplr=0.5,
        mosaic=0.7, mixup=0.0,
    )

print(f'Best weights: {BEST}')
if DRIVE_DIR and BEST.exists():
    shutil.copy(BEST, DRIVE_DIR / 'best.pt')
    print(f'Final best.pt -> {DRIVE_DIR / "best.pt"}')
""")

cell(CODE, """# Cell 8: Evaluate
# Resolve best.pt from this session, or fall back to the Drive checkpoint —
# so you can run the finalize cells even after a training disconnect.
from ultralytics import YOLO

if not BEST.exists() and DRIVE_DIR and (DRIVE_DIR / 'best.pt').exists():
    BEST = DRIVE_DIR / 'best.pt'
    print(f'Using Drive checkpoint: {BEST}')
assert BEST.exists(), 'No best.pt found (in session or Drive) — run training first.'

model = YOLO(str(BEST))
metrics = model.val(data=str(WORK_DIR / 'rodent.yaml'), imgsz=IMGSZ)
print(f'mAP50: {metrics.box.map50:.3f}')
print(f'mAP50-95: {metrics.box.map:.3f}')
print(f'precision: {metrics.box.mp:.3f}  recall: {metrics.box.mr:.3f}')
# For an alerting product, recall matters most (missed rodent = missed alert);
# precision is recoverable server-side (YOLOv8n verifies every detection).
""")

cell(CODE, """# Cell 9: Export int8 full-integer TFLite @ 192
# Ethos-U55 requires full integer quantization (int8 in/out).
# Ultralytics uses the dataset for calibration when data= is passed.
#
# NOTE: the MegaDetector install (Cell 5b) pulls ultralytics-yolov5, which
# downgrades protobuf to 3.20.1 — but the TFLite export below uses TensorFlow,
# which needs protobuf>=5.28. Restore it here so the export doesn't fail. (Safe
# no-op if Cell 5b was skipped.)
!pip install -q "protobuf>=5.28.0"

from ultralytics import YOLO

if not BEST.exists() and DRIVE_DIR and (DRIVE_DIR / 'best.pt').exists():
    BEST = DRIVE_DIR / 'best.pt'
assert BEST.exists(), 'No best.pt found (in session or Drive) — run training first.'
model = YOLO(str(BEST))
exported = model.export(
    format='tflite',
    int8=True,
    imgsz=IMGSZ,
    data=str(WORK_DIR / 'rodent.yaml'),
)
print(f'Exported: {exported}')

# Find the full-integer-quant variant
export_dir = Path(exported).parent if Path(exported).is_file() else Path(exported)
candidates = list(export_dir.glob('*full_integer_quant.tflite'))
assert candidates, f'No full_integer_quant.tflite in {export_dir} — check export output'
TFLITE_INT8 = candidates[0]
print(f'Full-integer model: {TFLITE_INT8} ({TFLITE_INT8.stat().st_size/1024:.0f} KB)')
""")

VELA_INI = """; Vela config for Himax WiseEye2 (HX6538) — from Seeed ModelAssistant
[System_Config.My_Sys_Cfg]
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

cell(CODE, f"""# Cell 10: Vela compile for Ethos-U55-64 (WiseEye2 HX6538)
vela_ini = WORK_DIR / 'himax_vela.ini'
vela_ini.write_text('''{VELA_INI}''')

vela_cmd = (
    f'vela {{TFLITE_INT8}} --accelerator-config ethos-u55-64 '
    f'--config {{vela_ini}} --system-config My_Sys_Cfg '
    f'--memory-mode My_Mem_Mode_Parent --output-dir {{WORK_DIR / "vela_out"}}'
)
print(vela_cmd)
!{{vela_cmd}}

import glob as _glob
vela_models = _glob.glob(str(WORK_DIR / 'vela_out' / '*_vela.tflite'))
assert vela_models, 'Vela compile failed — check output above'
VELA_MODEL = Path(vela_models[0])
print(f'\\nVela model: {{VELA_MODEL}} ({{VELA_MODEL.stat().st_size/1024:.0f}} KB)')
""")

cell(CODE, """# Cell 11: Package — save to Drive + auto-download
final = WORK_DIR / 'rodent_v1_int8_vela.tflite'
shutil.copy(VELA_MODEL, final)

# Persist to Drive (primary — survives any disconnect)
if DRIVE_DIR:
    shutil.copy(final, DRIVE_DIR / 'rodent_v1_int8_vela.tflite')
    shutil.copy(BEST, DRIVE_DIR / 'best.pt')
    # Pre-Vela int8 tflite: numerically identical to what runs on the NPU, and
    # the ONLY tflite that runs in Python — used by eval_model.py (Layer 1).
    try:
        shutil.copy(TFLITE_INT8, DRIVE_DIR / 'rodent_v1_int8.tflite')
    except Exception as e:
        print(f'   (could not copy int8 tflite for eval: {e})')
    print(f'✅ Saved to Drive: {DRIVE_DIR}')
    print('   - rodent_v1_int8_vela.tflite  (flash to the Grove)')
    print('   - rodent_v1_int8.tflite       (for eval_model.py — runs in Python)')
    print('   - best.pt                     (.pt for server-side use / re-export)')

# Also push to the browser as a download
try:
    from google.colab import files
    files.download(str(final))
    files.download(str(BEST))
except Exception as e:
    print(f'Auto-download skipped ({e}). Grab the files from Drive above.')
""")

cell(MD, """## Deploy to the Grove Vision AI V2

Grab `rodent_v1_int8_vela.tflite` from your Google Drive (`MyDrive/mousetrap/`),
then flash it with **SenseCraft AI** (the reliable path for this board):

1. Detach the XIAO from the Grove, connect the Grove via USB-C
2. Open **https://sensecraft.seeed.cc/ai/** in Chrome → **Connect** → pick the port
3. Upload `rodent_v1_int8_vela.tflite`
4. Verify live detection on the Mac: `python3 tools/grove_invoke.py`

> Note: the `sscma.cli flasher` / `xmodem_send.py --model` CLI path does **not**
> complete on this board's bootloader (see `grove-vision-ai/README.md`). Use
> SenseCraft for models.

In production the XIAO reads detections from the Grove over **I2C (0x62)** via
the `Seeed_Arduino_SSCMA` library — see `scout_arduino/` integration.
""")

nb = {
    "cells": cells,
    "metadata": {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python", "version": "3.10"},
        "accelerator": "GPU",
        "colab": {"gpuType": "T4", "provenance": []},
    },
    "nbformat": 4,
    "nbformat_minor": 4,
}

out = Path(__file__).parent / "grove_train.ipynb"
out.write_text(json.dumps(nb, indent=1))
print(f"Wrote {out} with {len(cells)} cells")
