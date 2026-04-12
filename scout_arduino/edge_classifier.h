/**
 * Edge Classifier for Scout Device
 *
 * On-device CNN classifier using TFLite Micro. Classifies motion-event frames
 * into 3 classes: rodent, person_or_pet, other.
 *
 * Model loaded from LittleFS at /model.tflite (trained via Colab notebook in
 * ml-training/colab_train.ipynb). If no model is present, the classifier
 * gracefully falls back to AMBIGUOUS verdicts so the server still does its
 * normal MobileNet classification (safety net).
 *
 * Pipeline per inference:
 *   JPEG frame → fmt2rgb888 → crop to bbox → bilinear resize 96×96
 *              → quantize to int8 → TFLite interpreter → argmax
 *
 * Memory:
 *   - Model bytes: ~500KB in PSRAM (loaded once from LittleFS)
 *   - Tensor arena: 1MB in PSRAM (allocated once)
 *   - RGB888 decode buffer: 900KB in PSRAM (allocated once, reused)
 *   - 96×96×3 int8 input staging: 28KB in PSRAM
 *
 * Total steady-state PSRAM: ~2.5MB. We have 8MB so plenty of headroom.
 */

#ifndef EDGE_CLASSIFIER_H
#define EDGE_CLASSIFIER_H

#include <Arduino.h>
#include <LittleFS.h>
#include <esp_camera.h>
#include <esp_heap_caps.h>
#include <img_converters.h>  // fmt2rgb888

#include <Chirale_TensorFlowLite.h>
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/micro/all_ops_resolver.h"
#include "tensorflow/lite/schema/schema_generated.h"

// Forward declaration — defined in scout_arduino.ino
extern void addSystemLog(const String& msg);

// =============================================================================
// Public types
// =============================================================================

enum EdgeVerdict {
  EDGE_VERDICT_UNKNOWN = 0,      // No model loaded or inference failed
  EDGE_VERDICT_RODENT,           // High-confidence rodent
  EDGE_VERDICT_PERSON_OR_PET,    // High-confidence person/cat/dog
  EDGE_VERDICT_OTHER,            // High-confidence non-animal
  EDGE_VERDICT_AMBIGUOUS,        // Classifier uncertain — defer to server
};

struct EdgeClassificationResult {
  EdgeVerdict verdict;
  float confidence;              // Max class probability (0-1)
  float rodent_score;
  float person_or_pet_score;
  float other_score;
  uint32_t inference_time_ms;
  bool inference_ran;            // true if model ran, false if fallback
};

// =============================================================================
// Configuration
// =============================================================================

#define EDGE_MODEL_PATH "/model.tflite"
#define EDGE_INPUT_SIZE 96
#define EDGE_INPUT_CHANNELS 3
#define EDGE_NUM_CLASSES 3

// Class indices must match labels.txt order from training
#define EDGE_CLASS_RODENT 0
#define EDGE_CLASS_PERSON_OR_PET 1
#define EDGE_CLASS_OTHER 2

// Confidence thresholds for tier assignment
#define EDGE_HIGH_CONFIDENCE 0.90f
// Anything below this is AMBIGUOUS → forward to server

// Tensor arena size — MobileNet v2 α=0.35 @ 96×96 int8.
// Sized at 3MB with plenty of headroom. We have 8MB PSRAM.
#define EDGE_TENSOR_ARENA_SIZE (3 * 1024 * 1024)  // 3MB

// Maximum model file size (we'll refuse anything bigger)
#define EDGE_MAX_MODEL_SIZE (800 * 1024)       // 800KB

// =============================================================================
// Module state (file-scope statics)
// =============================================================================

namespace edge_classifier_internal {

static bool s_initialized = false;
static bool s_model_loaded = false;
static uint8_t* s_model_data = nullptr;
static size_t s_model_size = 0;
static uint8_t* s_tensor_arena = nullptr;
static uint8_t* s_rgb_buffer = nullptr;
static size_t s_rgb_buffer_capacity = 0;  // Max allocated capacity

static const tflite::Model* s_tflite_model = nullptr;
static tflite::MicroInterpreter* s_interpreter = nullptr;
static TfLiteTensor* s_input = nullptr;
static TfLiteTensor* s_output = nullptr;

// Input quantization params (populated after AllocateTensors)
static float s_input_scale = 0.0f;
static int32_t s_input_zero_point = 0;
static float s_output_scale = 0.0f;
static int32_t s_output_zero_point = 0;

}  // namespace edge_classifier_internal

// =============================================================================
// Forward declarations
// =============================================================================

static bool loadModelFromLittleFS();
static bool allocateBuffers();
static bool setupInterpreter();
static bool prepareInputTensor(camera_fb_t* frame,
                                uint16_t bbox_x, uint16_t bbox_y,
                                uint16_t bbox_w, uint16_t bbox_h);

inline const char* edgeVerdictString(EdgeVerdict v) {
  switch (v) {
    case EDGE_VERDICT_RODENT: return "rodent";
    case EDGE_VERDICT_PERSON_OR_PET: return "person_or_pet";
    case EDGE_VERDICT_OTHER: return "other";
    case EDGE_VERDICT_AMBIGUOUS: return "ambiguous";
    case EDGE_VERDICT_UNKNOWN:
    default: return "unknown";
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Initialize the edge classifier. Call once at boot AFTER LittleFS.begin().
 * Returns true if model loaded and interpreter ready.
 * Returns false if no model file, init failure, or out of memory. In that
 * case edgeClassify() will return AMBIGUOUS verdicts (safe fallback).
 */
inline bool edgeClassifierInit() {
  using namespace edge_classifier_internal;

  if (s_initialized) {
    Serial.println("[EdgeCls] Already initialized");
    return s_model_loaded;
  }
  s_initialized = true;

  Serial.println("[EdgeCls] Initializing edge classifier...");
  addSystemLog("[EdgeCls] Init starting");

  if (!LittleFS.exists(EDGE_MODEL_PATH)) {
    Serial.printf("[EdgeCls] No %s present\n", EDGE_MODEL_PATH);
    addSystemLog("[EdgeCls] No model.tflite in LittleFS");
    return false;
  }

  if (!allocateBuffers()) {
    Serial.println("[EdgeCls] Failed to allocate PSRAM buffers");
    addSystemLog("[EdgeCls] PSRAM alloc failed");
    return false;
  }

  if (!loadModelFromLittleFS()) {
    Serial.println("[EdgeCls] Model load failed");
    addSystemLog("[EdgeCls] Model load failed");
    if (s_tensor_arena) { heap_caps_free(s_tensor_arena); s_tensor_arena = nullptr; }
    if (s_rgb_buffer) { heap_caps_free(s_rgb_buffer); s_rgb_buffer = nullptr; }
    return false;
  }

  if (!setupInterpreter()) {
    Serial.println("[EdgeCls] Failed to set up TFLite interpreter");
    addSystemLog("[EdgeCls] Interpreter setup failed");
    return false;
  }

  s_model_loaded = true;
  Serial.printf("[EdgeCls] Ready — model: %u bytes, arena: %u bytes\n",
                (unsigned)s_model_size, (unsigned)EDGE_TENSOR_ARENA_SIZE);
  addSystemLog(String("[EdgeCls] Ready: ") + (unsigned)s_model_size + " bytes");
  return true;
}

inline bool edgeClassifierReady() {
  return edge_classifier_internal::s_model_loaded;
}

/**
 * Classify a frame. Optionally pass a bounding box from motion detection;
 * if bbox_w == 0 the full frame is center-cropped.
 *
 * Safe to call even if edgeClassifierInit() failed — returns AMBIGUOUS.
 */
inline EdgeClassificationResult edgeClassify(
    camera_fb_t* frame,
    uint16_t bbox_x = 0, uint16_t bbox_y = 0,
    uint16_t bbox_w = 0, uint16_t bbox_h = 0) {
  using namespace edge_classifier_internal;

  EdgeClassificationResult r = {};
  r.verdict = EDGE_VERDICT_AMBIGUOUS;
  r.confidence = 0.0f;
  r.inference_ran = false;

  if (!s_model_loaded || !frame || !frame->buf) {
    return r;
  }

  uint32_t t0 = millis();

  if (!prepareInputTensor(frame, bbox_x, bbox_y, bbox_w, bbox_h)) {
    Serial.println("[EdgeCls] Failed to prepare input tensor");
    return r;
  }

  TfLiteStatus status = s_interpreter->Invoke();
  if (status != kTfLiteOk) {
    Serial.printf("[EdgeCls] Invoke failed: %d\n", (int)status);
    return r;
  }

  // Read int8 outputs and dequantize to floats
  int8_t* out_data = s_output->data.int8;
  float scores[EDGE_NUM_CLASSES];
  for (int i = 0; i < EDGE_NUM_CLASSES; i++) {
    scores[i] = (out_data[i] - s_output_zero_point) * s_output_scale;
  }

  r.rodent_score = scores[EDGE_CLASS_RODENT];
  r.person_or_pet_score = scores[EDGE_CLASS_PERSON_OR_PET];
  r.other_score = scores[EDGE_CLASS_OTHER];

  // Argmax
  int argmax = 0;
  float max_score = scores[0];
  for (int i = 1; i < EDGE_NUM_CLASSES; i++) {
    if (scores[i] > max_score) {
      max_score = scores[i];
      argmax = i;
    }
  }

  r.confidence = max_score;
  r.inference_time_ms = millis() - t0;
  r.inference_ran = true;

  // Assign verdict based on confidence tiers
  if (max_score >= EDGE_HIGH_CONFIDENCE) {
    if (argmax == EDGE_CLASS_RODENT) r.verdict = EDGE_VERDICT_RODENT;
    else if (argmax == EDGE_CLASS_PERSON_OR_PET) r.verdict = EDGE_VERDICT_PERSON_OR_PET;
    else r.verdict = EDGE_VERDICT_OTHER;
  } else {
    r.verdict = EDGE_VERDICT_AMBIGUOUS;
  }

  Serial.printf("[EdgeCls] verdict=%s conf=%.2f [r=%.2f p=%.2f o=%.2f] time=%ums\n",
                edgeVerdictString(r.verdict), r.confidence,
                r.rodent_score, r.person_or_pet_score, r.other_score,
                (unsigned)r.inference_time_ms);

  // Also push a compact log line to the system log so it's visible via HTTP
  char buf[128];
  snprintf(buf, sizeof(buf),
           "[EdgeCls] bbox=(%u,%u,%ux%u) r=%.2f p=%.2f o=%.2f v=%s",
           (unsigned)bbox_x, (unsigned)bbox_y, (unsigned)bbox_w, (unsigned)bbox_h,
           r.rodent_score, r.person_or_pet_score, r.other_score,
           edgeVerdictString(r.verdict));
  addSystemLog(buf);
  return r;
}

// =============================================================================
// Internal helpers
// =============================================================================

static bool allocateBuffers() {
  using namespace edge_classifier_internal;

  s_tensor_arena = (uint8_t*)heap_caps_aligned_alloc(
      16, EDGE_TENSOR_ARENA_SIZE, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!s_tensor_arena) {
    return false;
  }

  // RGB buffer sized for VGA (640×480×3). Allocated once, reused.
  s_rgb_buffer_capacity = 640 * 480 * 3;
  s_rgb_buffer = (uint8_t*)heap_caps_malloc(
      s_rgb_buffer_capacity, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!s_rgb_buffer) {
    heap_caps_free(s_tensor_arena);
    s_tensor_arena = nullptr;
    return false;
  }

  return true;
}

static bool loadModelFromLittleFS() {
  using namespace edge_classifier_internal;

  if (!LittleFS.exists(EDGE_MODEL_PATH)) {
    Serial.printf("[EdgeCls] %s not found in LittleFS\n", EDGE_MODEL_PATH);
    return false;
  }

  File f = LittleFS.open(EDGE_MODEL_PATH, "r");
  if (!f) {
    Serial.println("[EdgeCls] Failed to open model file");
    return false;
  }

  s_model_size = f.size();
  if (s_model_size == 0 || s_model_size > EDGE_MAX_MODEL_SIZE) {
    Serial.printf("[EdgeCls] Invalid model size: %u\n", (unsigned)s_model_size);
    f.close();
    return false;
  }

  s_model_data = (uint8_t*)heap_caps_malloc(
      s_model_size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!s_model_data) {
    Serial.println("[EdgeCls] Failed to allocate model buffer in PSRAM");
    f.close();
    return false;
  }

  size_t read = f.read(s_model_data, s_model_size);
  f.close();
  if (read != s_model_size) {
    Serial.printf("[EdgeCls] Short read: %u/%u\n", (unsigned)read, (unsigned)s_model_size);
    heap_caps_free(s_model_data);
    s_model_data = nullptr;
    return false;
  }

  return true;
}

static bool setupInterpreter() {
  using namespace edge_classifier_internal;

  s_tflite_model = tflite::GetModel(s_model_data);
  if (s_tflite_model->version() != TFLITE_SCHEMA_VERSION) {
    Serial.printf("[EdgeCls] Model schema v%d != library v%d\n",
                  (int)s_tflite_model->version(), (int)TFLITE_SCHEMA_VERSION);
    addSystemLog(String("[EdgeCls] Schema mismatch v") + (int)s_tflite_model->version() +
                 " vs lib v" + (int)TFLITE_SCHEMA_VERSION);
    return false;
  }

  // AllOpsResolver — pulls in full TFLite Micro op set. Larger binary but
  // avoids surprises from missing ops. Can switch to MicroMutableOpResolver
  // once we know exactly which ops the model uses.
  static tflite::AllOpsResolver resolver;

  static tflite::MicroInterpreter static_interpreter(
      s_tflite_model, resolver, s_tensor_arena, EDGE_TENSOR_ARENA_SIZE);
  s_interpreter = &static_interpreter;

  TfLiteStatus alloc_status = s_interpreter->AllocateTensors();
  if (alloc_status != kTfLiteOk) {
    Serial.println("[EdgeCls] AllocateTensors failed — tensor arena too small?");
    addSystemLog("[EdgeCls] AllocateTensors failed");
    return false;
  }

  s_input = s_interpreter->input(0);
  s_output = s_interpreter->output(0);

  // Sanity check input shape — expect [1, 96, 96, 3]
  if (s_input->dims->size != 4 ||
      s_input->dims->data[1] != EDGE_INPUT_SIZE ||
      s_input->dims->data[2] != EDGE_INPUT_SIZE ||
      s_input->dims->data[3] != EDGE_INPUT_CHANNELS) {
    Serial.printf("[EdgeCls] Unexpected input shape: [%d,%d,%d,%d]\n",
                  s_input->dims->data[0], s_input->dims->data[1],
                  s_input->dims->data[2], s_input->dims->data[3]);
    addSystemLog(String("[EdgeCls] Bad input shape: [") +
                 s_input->dims->data[0] + "," + s_input->dims->data[1] + "," +
                 s_input->dims->data[2] + "," + s_input->dims->data[3] + "]");
    return false;
  }

  if (s_input->type != kTfLiteInt8) {
    Serial.println("[EdgeCls] Input must be int8");
    addSystemLog(String("[EdgeCls] Input not int8, type=") + (int)s_input->type);
    return false;
  }

  // Cache quantization params
  s_input_scale = s_input->params.scale;
  s_input_zero_point = s_input->params.zero_point;
  s_output_scale = s_output->params.scale;
  s_output_zero_point = s_output->params.zero_point;

  Serial.printf("[EdgeCls] input scale=%.4f zp=%d  output scale=%.4f zp=%d\n",
                s_input_scale, (int)s_input_zero_point,
                s_output_scale, (int)s_output_zero_point);
  char qbuf[128];
  snprintf(qbuf, sizeof(qbuf),
           "[EdgeCls] quant in scale=%.6f zp=%d out scale=%.6f zp=%d",
           s_input_scale, (int)s_input_zero_point,
           s_output_scale, (int)s_output_zero_point);
  addSystemLog(qbuf);
  return true;
}

/**
 * Decode JPEG to RGB888, crop to bbox (or center), resize to 96×96, quantize.
 * Returns true on success.
 */
static bool prepareInputTensor(camera_fb_t* frame,
                                uint16_t bbox_x, uint16_t bbox_y,
                                uint16_t bbox_w, uint16_t bbox_h) {
  using namespace edge_classifier_internal;

  uint16_t fw = frame->width;
  uint16_t fh = frame->height;
  size_t needed = (size_t)fw * fh * 3;
  if (needed > s_rgb_buffer_capacity) {
    Serial.printf("[EdgeCls] Frame %ux%u too large for RGB buffer\n", fw, fh);
    return false;
  }

  // Decode JPEG → RGB888 (uses esp_camera's img_converters)
  if (!fmt2rgb888(frame->buf, frame->len, frame->format, s_rgb_buffer)) {
    Serial.println("[EdgeCls] fmt2rgb888 failed");
    return false;
  }

  // Determine crop region. Use bbox if valid, else center-crop square.
  int16_t cx, cy, cw, ch;
  if (bbox_w > 0 && bbox_h > 0) {
    // Expand bbox slightly (20% padding) and make square
    int16_t side = (int16_t)(max(bbox_w, bbox_h) * 1.2f);
    cx = (int16_t)bbox_x + (int16_t)bbox_w / 2 - side / 2;
    cy = (int16_t)bbox_y + (int16_t)bbox_h / 2 - side / 2;
    cw = ch = side;
  } else {
    // Center square crop
    int16_t side = min(fw, fh);
    cx = (fw - side) / 2;
    cy = (fh - side) / 2;
    cw = ch = side;
  }

  // Clamp to frame
  if (cx < 0) cx = 0;
  if (cy < 0) cy = 0;
  if (cx + cw > fw) cw = fw - cx;
  if (cy + ch > fh) ch = fh - cy;
  if (cw <= 0 || ch <= 0) {
    Serial.println("[EdgeCls] Invalid crop region");
    return false;
  }

  // Simple nearest-neighbor resize from crop region to 96×96 with int8
  // quantization inline. The model was converted with preprocess_input
  // INSIDE the graph (baked into the float32 subgraph), so we feed RAW
  // pixel values [0,255] and let the model do its own /127.5-1 scaling.
  // Quantization: int8 = round(raw_pixel / scale) + zero_point
  // For MobileNet v2 our converter gives scale=1.0, zp=-128, so this
  // simplifies to: int8 = raw_pixel - 128.
  int8_t* input_data = s_input->data.int8;

  for (int y = 0; y < EDGE_INPUT_SIZE; y++) {
    int src_y = cy + (y * ch) / EDGE_INPUT_SIZE;
    for (int x = 0; x < EDGE_INPUT_SIZE; x++) {
      int src_x = cx + (x * cw) / EDGE_INPUT_SIZE;
      const uint8_t* src = &s_rgb_buffer[(src_y * fw + src_x) * 3];

      for (int c = 0; c < 3; c++) {
        // Quantize raw [0,255] pixel value using the model's scale/zp
        int q = (int)lroundf((float)src[c] / s_input_scale) + s_input_zero_point;
        if (q < -128) q = -128;
        if (q > 127) q = 127;
        input_data[(y * EDGE_INPUT_SIZE + x) * 3 + c] = (int8_t)q;
      }
    }
  }

  return true;
}

#endif  // EDGE_CLASSIFIER_H
