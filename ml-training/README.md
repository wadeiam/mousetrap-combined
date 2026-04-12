# MouseTrap ML Training

Trains a small int8-quantized image classifier that runs on the XIAO ESP32-S3
Sense (Scout device) to do on-device rodent vs. not-rodent classification.

## Model

- **Architecture:** MobileNet v2 α=0.35, 96×96 RGB input
- **Classes:** `rodent`, `person_or_pet`, `other`
- **Output:** `model.tflite` (int8 quantized, ~500KB) + `labels.txt`
- **Target runtime:** TFLite Micro with ESP-NN kernels on ESP32-S3

## Training flow

1. **v1 (open datasets only)** — run `colab_train.ipynb` in Google Colab. It
   downloads iNaturalist (rodents), COCO (person/pet), and background images,
   trains MobileNet v2, quantizes to int8, and exports `model.tflite`.
2. **v2+ (active learning)** — once the scout is running v1 and images are
   accumulating in `Server/image_storage/`, use `export-training-data.sh`
   on the server to package real-world classifications, upload to Colab,
   and retrain.

## Deployment

After Colab exports `model.tflite`:
1. Download it from the Colab notebook
2. Copy it into `scout_arduino/scout-spa/public/model.tflite` (or wherever
   the Phase 2 firmware integration expects it — see PROJECT_TRANSITION.md)
3. Rebuild the LittleFS image (`make build-fs`)
4. Upload via OTA or USB (`make upload-fs`)

## Re-training with real data

```bash
# On the Mac (server host)
cd Server
./scripts/export-training-data.sh training-v2.tar.gz

# Upload training-v2.tar.gz to Colab via the notebook's file upload cell.
```
