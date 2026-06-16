# Rodent Detector — Test & Reinforce Pipeline

A closed loop that continuously **tests** the rodent detector and **reinforces**
it (grows labeled data → retrain → redeploy) with minimal hand-labeling.

```
 scouts ──MQTT──▶ server: classify + store (image_classifications)
                         │
        ┌────────────────┴───────────────┐
        ▼ Layer 2 (auto)                  ▼ Layer 1 (gate)
  auto-label pass                   regression eval
  • teacher pseudo-labels           • score int8 tflite on fixed eval set
  • hard-negative mining            • recall must not regress
  • uncertain → 1-tap review        • metrics_history.json
        │                                 ▲
        ▼ Layer 3                         │
  export labeled batch ──▶ retrain ──▶ eval gate ──▶ flash (CLI) ──▶ scouts
```

The data foundation already existed (`image_classifications` with edge verdict,
server classification, confidence, bbox, corrections, image_path). This pipeline
adds the automation on top.

---

## Layer 1 — Regression eval (test)
- `ml-training/build_eval_set.py` — build a FIXED held-out eval set once
  (`eval.yaml` + `eval_manifest.json`). Keep the manifest so training can exclude
  these image ids and stay disjoint.
- `ml-training/eval_model.py` — score a model, append to `metrics_history.json`,
  apply a promotion gate. **Evaluate the pre-Vela `*_int8.tflite`** (NPU-equivalent;
  the `*_vela.tflite` only runs on the NPU). Recall is the gate metric.

```bash
python3 ml-training/build_eval_set.py --out /content/eval_set --per-class 100
python3 ml-training/eval_model.py --model rodent_v1_int8.tflite \
    --data /content/eval_set/eval.yaml --name v1-int8
```

## Layer 2 — Auto-labeling loop (reinforce, server-side)
- Migration `Server/migrations/022_active_learning.sql` — adds `auto_label`,
  `auto_label_source`, `in_training_set`, `training_batch`.
- `Server/src/services/active-learning.service.ts` — `runAutoLabelPass`,
  `getReviewQueue`, `getStats`, `markTrainingBatch`. Signals:
  - **teacher_high** server confidence ≥ 0.8 → accept server class
  - **teacher_bg** empty / confidence ≤ 0.3 → background
  - **hard_negative** edge said `worth_sending` but server found nothing (edge FP)
  - uncertain middle band → human one-tap review
  - human corrections always override auto labels
- `Server/src/routes/active-learning.routes.ts` — `/api/active-learning/{stats,
  review-queue,run-pass,batch}` (wired in `server.ts`).

Run the migration, rebuild, restart:
```bash
psql ... -f Server/migrations/022_active_learning.sql
cd Server && npm run build && pm2 restart mqtt-server
```

Confirmation-bias guard: auto-accept only at HIGH confidence, always keep the
uncertain band human-reviewed, and let hard negatives counter the teacher's own
false positives.

## Layer 3 — Retrain + redeploy (orchestration)
- `tools/reinforce_export.sh` — auto-label pass → readiness check → export a
  labeled batch (`export-training-data.sh --labeled-only`) → tag the batch →
  print the retrain handoff. Cron-safe.
- `tools/deploy_model.sh` — eval gate (Layer 1) → flash firmware+model (CLI) →
  register via AT+INFO. Refuses to flash a recall-regressing model.

```bash
ADMIN_TOKEN=<jwt> tools/reinforce_export.sh --threshold 500
#  ... retrain in Colab/VM, download vela + int8 tflite ...
tools/deploy_model.sh rodent_v2_int8_vela.tflite rodent_v2_int8.tflite eval.yaml "rodent v2"
```

### Automation status (honest)
- **Fully automatic:** classify+store, auto-label pass, hard-negative mining,
  readiness check, export, batch tagging, eval gate, AT+INFO registration.
- **Manual:** the retrain *kick* (Colab can't be triggered headlessly — move to a
  GPU VM/Vertex to automate) and the reset-button press during flashing.
- Schedule the server-side parts with cron/PM2 or the `/schedule` skill, e.g.
  `tools/reinforce_export.sh` nightly; it no-ops below the data threshold.

### Mission guardrail
Always mix new real-world data with the diverse base camera-trap datasets. The
product must work in ANY environment — never let the model overfit one site.
