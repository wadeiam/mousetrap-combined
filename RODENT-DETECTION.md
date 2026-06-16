# MouseTrap — Rodent Detection System

End-to-end guide: train a rodent detector on public data, flash it to the Grove
Vision AI V2, and reinforce it over time. Written so any of these steps can be
re-run from scratch.

- **Hardware:** Seeed Grove Vision AI V2 (Himax WiseEye2, Cortex-M55 + Ethos-U55
  NPU) + OV5647 camera, paired with a XIAO ESP32-S3 over **I2C (addr 0x62)**.
  USB-C (CH343 UART @ 921600) is for bring-up/flashing only.
- **Model:** single-class `rodent` YOLO11n @ 192×192, int8, Vela-compiled for the
  Ethos-U55. Cats/dogs/people/birds are background negatives so it stays silent
  on them; species detail stays server-side.
- **Data:** 100% public camera-trap datasets — **zero manual labeling, zero local
  rodents needed** (the product must generalize to any environment).

## Model versions
| Version | Data | Epochs | mAP50 | recall | Notes |
|---|---|---|---|---|---|
| v1 | ~4K imgs (CI+IC+COCO) | 50 | 0.62 | 0.55 | first Colab run |
| **v2** | 26.7K imgs (CI 10K + IC 8K + NZ/MegaDetector 5.9K + COCO 3K) | 60 | **0.720** | **0.655** | trained headless on GCP |

Artifacts (each run): `best.pt`, `rodent_int8.tflite` (eval/NPU-equivalent),
`rodent_int8_vela.tflite` (flash this), `metrics.json`. v2 lives in
`gs://mousetrapv1-rodent-training/runs/v2/` and `grove-vision-ai/models/`.

> ~0.72 mAP50 is near the ceiling for YOLO11n @ 192px. recall 0.655 means it
> misses ~⅓ at the F1 threshold — mitigate by lowering the on-device confidence
> and letting the server-side YOLOv8n verify. A higher-res input (256/320) is the
> v3 lever.

---

## 1. Train on GCP (headless, cost-capped) — the no-babysitting path

Why GCP, not Colab: interactive Colab drops its runtime on any disconnect (wiping
`/content` + installed packages) and isn't meant for fire-and-forget training. The
GCP job runs unattended, streams to GCS, and self-stops.

### Run it
```bash
bash gcp-training/launch.sh <run_id>        # full run (~2–2.5h, ~$2 on an L4)
bash gcp-training/launch.sh <run_id> 1      # quick validation smoke (~10 min)
```
`launch.sh` uploads the code to GCS, then creates a GPU VM that runs
`train_rodent.py` (download CI + IC + NZ/MegaDetector + COCO → train → int8
export → Vela → write to `gs://mousetrapv1-rodent-training/runs/<run_id>/`) and
**STOPS itself** when done.

It tries **T4** (`n1-standard-8`) then **L4** (`g2-standard-8`) across
`us-central1-{a,b,c,f}` — T4 is frequently stocked out, L4 is the usual winner.

### Watch / manage
```bash
gsutil cat gs://mousetrapv1-rodent-training/runs/<id>/train.log | tail -30
gsutil ls gs://mousetrapv1-rodent-training/runs/<id>/
gcloud compute instances list --project mousetrapv1
gcloud compute instances stop   rodent-train-<id> --zone <zone>   # kill switch
gcloud compute instances delete rodent-train-<id> --zone <zone>   # remove when done
```

### Cost controls (all active; cost is bounded by infra, not trust)
- VM self-stops on job completion (`shutdown`); a stopped VM only costs ~$1–3/mo disk.
- Hard cap: `--max-run-duration=14400s --instance-termination-action=STOP` (4h backstop).
- GPU quota = 1 → cannot spawn a fleet.
- $25 billing budget with alerts (50/90/100%) on project `mousetrapv1`.

### One-time setup (already done; here to recreate in a fresh project)
1. `gcloud config set project mousetrapv1`
2. Link billing: `gcloud billing projects link mousetrapv1 --billing-account=<ACCT>`
3. `gcloud services enable compute.googleapis.com cloudquotas.googleapis.com billingbudgets.googleapis.com`
4. Request GPU quota (default `GPUS_ALL_REGIONS` is 0): via Console (IAM & Admin →
   Quotas → "GPUs (all regions)" → edit to 1) or the Cloud Quotas REST API
   (`quotaPreferences.create`, quotaId `GPUS-ALL-REGIONS-per-project`,
   preferredValue 1). 1 GPU is usually auto-approved in minutes.
5. `gcloud storage buckets create gs://mousetrapv1-rodent-training --location us-central1`
6. (Optional) budget: `gcloud billing budgets create --billing-account=<ACCT>
   --display-name=rodent-training-cap --budget-amount=25USD
   --filter-projects=projects/mousetrapv1 --threshold-rule=percent=0.5
   --threshold-rule=percent=0.9 --threshold-rule=percent=1.0`

Then `bash gcp-training/launch.sh v3` recreates everything — no VM state is precious.

### Files
- `gcp-training/train_rodent.py` — the headless pipeline (datasets → train → export → Vela → GCS)
- `gcp-training/startup.sh` — VM boot script (installs deps incl. `libgl1`, runs trainer, self-stops)
- `gcp-training/launch.sh` — creates the cost-capped VM, T4→L4 fallback

### Hard-won lessons baked into the scripts
- `apt-get install libgl1 libglib2.0-0` — headless DLVM lacks it; OpenCV (cv2) needs it.
- `pip install -U pip` then stage installs — old pip's resolver throws on megadetector's big tree.
- Restore `protobuf>=5.28.0` after megadetector pins it down (TensorFlow export needs it).
- Channel Islands images are under `/images/`; the annotation zip is at the dataset root.
- The MegaDetector label cache (`cache/nz_md_labels.json` in GCS) means MD inference
  is never repeated across runs.

---

## 2. Flash a model to the Grove (headless — no button)

Proven recipe: the **official Himax xmodem sequence + a programmatic RTS hardware
reset**. (Earlier belief that a physical reset button was required was wrong.)

```bash
# Detach the XIAO first (see gotcha below). Grove on USB-C.
tools/deploy_model.sh \
  grove-vision-ai/models/rodent_v2_int8_vela.tflite \
  grove-vision-ai/models/rodent_v2_int8.tflite \
  <eval.yaml> "rodent v2"
```
`deploy_model.sh` does: eval-gate (recall must not regress) → flash firmware+model
headless (`himax_xmodem_send_rts.py`) → register metadata (`grove_set_info.py` →
`AT+INFO`) → it boots into the app. Verify with `tools/grove_invoke.py`.

Manual equivalent:
```bash
python3 tools/himax_xmodem_send_rts.py --port=/dev/cu.usbmodem* --baudrate=921600 \
  --protocol=xmodem --file=grove-vision-ai/firmware/grove_vision_ai_v2_20250102.img \
  --model="grove-vision-ai/models/rodent_v2_int8_vela.tflite 0x400000 0x00000"
python3 tools/grove_set_info.py "rodent v2" "rodent" 2504592 /dev/cu.usbmodem*
python3 tools/grove_invoke.py 30
```

### How flashing works (so it can be debugged)
- The model goes to flash `0x400000` as RAW Vela bytes (no header). Firmware burns
  it via the bootloader using a config block: `C0 5A <addr LE> 00000000 5A C0` +
  `0xFF` padding, sent over xmodem before the model payload (with `--file` firmware first).
- Classes/metadata are NOT flashed — set afterward via `AT+INFO="<base64 JSON>"`.
- Verify: `AT+INVOKE=1,0,1` → an event with `perf:[pre,infer,post]` (v2 ≈ 79ms) and
  `boxes:[[x,y,w,h,score,class]]`. `AT+MODEL?` shows `size:0` even when loaded —
  cosmetic; trust the perf number.
- Fallback: SenseCraft AI WebSerial (https://sensecraft.seeed.cc/ai/, Chrome).

### GOTCHA — detach the XIAO before USB flashing/serial
The USB-C console and the XIAO share the WiseEye2 UART. With a XIAO attached and
driving those pins, the console answers ~one command then goes silent. Physically
detach the XIAO for any USB serial work. (Production is unaffected — XIAO ↔ Grove
is I2C, not UART.)

### Files
- `tools/himax_xmodem_send_rts.py` — headless flasher (RTS reset; USE THIS)
- `tools/himax_xmodem_send.py` — official flasher (waits for physical button)
- `tools/grove_set_info.py "<name>" "<classes,csv>" [size] [port]` — register via AT+INFO
- `tools/grove_invoke.py [secs] [port]` — live inference smoke test
- `tools/grove_probe.py` — device info dump
- `grove-vision-ai/firmware/grove_vision_ai_v2_20250102.img` — stock SSCMA firmware

---

## 3. Test & reinforce (active learning)
See **REINFORCE-PIPELINE.md** for the closed loop: regression eval (`ml-training/
eval_model.py`), server-side auto-labeling (`Server/.../active-learning.service.ts`
+ migration 022 + `/api/active-learning/*`), and retrain→redeploy orchestration
(`tools/reinforce_export.sh`, `tools/deploy_model.sh`).

---

## Quick map
```
gcp-training/      headless GPU training (train_rodent.py, startup.sh, launch.sh)
ml-training/       Colab notebook + eval harness (grove_train.ipynb, eval_model.py, build_eval_set.py)
tools/             flashing + device tools (himax_xmodem_send_rts.py, grove_set_info.py, grove_invoke.py, deploy_model.sh, reinforce_export.sh)
grove-vision-ai/   README, firmware/, models/ (rodent_v2_int8_vela.tflite = flash this)
Server/            active-learning.service.ts, active-learning.routes.ts, migrations/022_active_learning.sql
RODENT-DETECTION.md (this file) · REINFORCE-PIPELINE.md · grove-vision-ai/README.md
```
