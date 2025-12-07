/**
 * Motion Detection for Scout Device
 *
 * Frame-to-frame comparison with size-based filtering.
 * Detects motion and calculates bounding box of changed region.
 */

#ifndef MOTION_DETECT_H
#define MOTION_DETECT_H

#include <esp_camera.h>
#include <esp_heap_caps.h>

// Motion detection configuration
struct MotionConfig {
  uint8_t threshold;      // Pixel difference threshold (0-255)
  float minSizePercent;   // Minimum motion size (% of frame)
  float maxSizePercent;   // Maximum motion size (% of frame)
  uint16_t blockSize;     // Block size for comparison (8, 16, 32)
  uint16_t cooldownMs;    // Cooldown between detections
};

// Motion detection result
struct MotionResult {
  bool detected;          // Motion was detected
  bool sizeFiltered;      // Was filtered due to size (too big/small)
  uint16_t x;             // Bounding box X
  uint16_t y;             // Bounding box Y
  uint16_t width;         // Bounding box width
  uint16_t height;        // Bounding box height
  float sizePercent;      // Size as percentage of frame
  uint32_t changedBlocks; // Number of blocks that changed
  uint32_t totalBlocks;   // Total blocks analyzed
  float confidence;       // Detection confidence (0-1)
};

// Motion detector class
class MotionDetector {
public:
  MotionDetector() : prevFrame(nullptr), prevWidth(0), prevHeight(0), lastDetectionTime(0) {
    // Default configuration
    config.threshold = 25;
    config.minSizePercent = 1.0;
    config.maxSizePercent = 30.0;
    config.blockSize = 16;
    config.cooldownMs = 2000;
  }

  ~MotionDetector() {
    if (prevFrame) {
      heap_caps_free(prevFrame);
      prevFrame = nullptr;
    }
  }

  void setConfig(const MotionConfig& cfg) {
    config = cfg;
  }

  MotionConfig getConfig() const {
    return config;
  }

  /**
   * Detect motion by comparing current frame to previous.
   * Frame must be in grayscale format.
   *
   * @param frame Current camera frame (will be converted to grayscale if JPEG)
   * @return MotionResult with detection info
   */
  MotionResult detect(camera_fb_t* frame) {
    MotionResult result = {false, false, 0, 0, 0, 0, 0.0, 0, 0, 0.0};

    if (!frame || !frame->buf || frame->len == 0) {
      Serial.println("[Motion] Invalid frame");
      return result;
    }

    // Check cooldown
    if (millis() - lastDetectionTime < config.cooldownMs) {
      return result;
    }

    // For JPEG frames, we need to decode first
    // For now, we'll use a simple JPEG size heuristic
    // (proper implementation would decode to grayscale)
    if (frame->format == PIXFORMAT_JPEG) {
      return detectFromJpegSize(frame);
    }

    // Grayscale frame comparison
    if (frame->format != PIXFORMAT_GRAYSCALE) {
      Serial.println("[Motion] Unsupported pixel format");
      return result;
    }

    uint16_t width = frame->width;
    uint16_t height = frame->height;
    size_t frameSize = width * height;

    // First frame - just store it
    if (!prevFrame || prevWidth != width || prevHeight != height) {
      allocatePrevFrame(width, height);
      if (prevFrame) {
        memcpy(prevFrame, frame->buf, frameSize);
      }
      return result;
    }

    // Compare frames block by block
    uint16_t blocksX = width / config.blockSize;
    uint16_t blocksY = height / config.blockSize;
    result.totalBlocks = blocksX * blocksY;

    uint16_t minX = blocksX, minY = blocksY;
    uint16_t maxX = 0, maxY = 0;

    for (uint16_t by = 0; by < blocksY; by++) {
      for (uint16_t bx = 0; bx < blocksX; bx++) {
        uint32_t blockDiff = 0;
        uint16_t pixelsInBlock = config.blockSize * config.blockSize;

        // Calculate average difference in this block
        for (uint16_t py = 0; py < config.blockSize; py++) {
          for (uint16_t px = 0; px < config.blockSize; px++) {
            uint32_t idx = (by * config.blockSize + py) * width + (bx * config.blockSize + px);
            int diff = abs((int)frame->buf[idx] - (int)prevFrame[idx]);
            blockDiff += diff;
          }
        }

        uint8_t avgDiff = blockDiff / pixelsInBlock;

        if (avgDiff > config.threshold) {
          result.changedBlocks++;
          if (bx < minX) minX = bx;
          if (by < minY) minY = by;
          if (bx > maxX) maxX = bx;
          if (by > maxY) maxY = by;
        }
      }
    }

    // Store current frame for next comparison
    memcpy(prevFrame, frame->buf, frameSize);

    // Check if motion detected
    if (result.changedBlocks > 0) {
      result.detected = true;

      // Calculate bounding box in pixels
      result.x = minX * config.blockSize;
      result.y = minY * config.blockSize;
      result.width = (maxX - minX + 1) * config.blockSize;
      result.height = (maxY - minY + 1) * config.blockSize;

      // Calculate size percentage
      float totalArea = (float)width * height;
      float motionArea = (float)result.width * result.height;
      result.sizePercent = (motionArea / totalArea) * 100.0;

      // Apply size filter
      if (result.sizePercent < config.minSizePercent) {
        result.sizeFiltered = true;
        result.detected = false;  // Too small - probably noise/dust
        Serial.printf("[Motion] Filtered: too small (%.1f%% < %.1f%%)\n",
                      result.sizePercent, config.minSizePercent);
      } else if (result.sizePercent > config.maxSizePercent) {
        result.sizeFiltered = true;
        result.detected = false;  // Too large - probably person/pet
        Serial.printf("[Motion] Filtered: too large (%.1f%% > %.1f%%)\n",
                      result.sizePercent, config.maxSizePercent);
      }

      // Calculate confidence based on block coverage and size
      float blockRatio = (float)result.changedBlocks / result.totalBlocks;
      result.confidence = min(1.0f, blockRatio * 5.0f);  // Scale up small changes

      if (result.detected) {
        lastDetectionTime = millis();
        Serial.printf("[Motion] Detected! Box: (%d,%d) %dx%d, Size: %.1f%%, Conf: %.2f\n",
                      result.x, result.y, result.width, result.height,
                      result.sizePercent, result.confidence);
      }
    }

    return result;
  }

  /**
   * Simple motion detection based on JPEG file size changes.
   * Useful as a quick pre-filter before full analysis.
   */
  MotionResult detectFromJpegSize(camera_fb_t* frame) {
    static size_t prevJpegSize = 0;
    static size_t jpegSizeHistory[5] = {0};
    static int historyIdx = 0;

    MotionResult result = {false, false, 0, 0, 0, 0, 0.0, 0, 0, 0.0};

    // Store in history
    jpegSizeHistory[historyIdx] = frame->len;
    historyIdx = (historyIdx + 1) % 5;

    // Calculate average size
    size_t avgSize = 0;
    int validCount = 0;
    for (int i = 0; i < 5; i++) {
      if (jpegSizeHistory[i] > 0) {
        avgSize += jpegSizeHistory[i];
        validCount++;
      }
    }
    if (validCount > 0) avgSize /= validCount;

    // First few frames - just collect history
    if (prevJpegSize == 0 || validCount < 3) {
      prevJpegSize = frame->len;
      return result;
    }

    // Check for significant size change from average
    float sizeDiff = abs((float)frame->len - (float)avgSize) / (float)avgSize * 100.0;

    // JPEG size changes significantly when scene content changes
    // Threshold of ~10% works well for motion detection
    if (sizeDiff > 10.0) {
      result.detected = true;
      result.sizePercent = sizeDiff;  // Use as proxy for motion amount
      result.confidence = min(1.0f, sizeDiff / 30.0f);

      // Estimate bounding box as center region (we don't know actual location)
      result.x = frame->width / 4;
      result.y = frame->height / 4;
      result.width = frame->width / 2;
      result.height = frame->height / 2;

      // Apply size filter (approximate)
      if (sizeDiff < 3.0) {
        result.sizeFiltered = true;
        result.detected = false;
      } else if (sizeDiff > 50.0) {
        result.sizeFiltered = true;
        result.detected = false;
        Serial.printf("[Motion] Filtered: large scene change (%.1f%%)\n", sizeDiff);
      }

      if (result.detected) {
        lastDetectionTime = millis();
        Serial.printf("[Motion] JPEG size motion: %.1f%% change, conf: %.2f\n",
                      sizeDiff, result.confidence);
      }
    }

    prevJpegSize = frame->len;
    return result;
  }

  void reset() {
    if (prevFrame) {
      heap_caps_free(prevFrame);
      prevFrame = nullptr;
    }
    prevWidth = 0;
    prevHeight = 0;
    lastDetectionTime = 0;
  }

private:
  MotionConfig config;
  uint8_t* prevFrame;
  uint16_t prevWidth;
  uint16_t prevHeight;
  uint32_t lastDetectionTime;

  void allocatePrevFrame(uint16_t width, uint16_t height) {
    if (prevFrame) {
      heap_caps_free(prevFrame);
    }

    size_t size = width * height;

    // Try PSRAM first, fall back to regular RAM
    prevFrame = (uint8_t*)heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!prevFrame) {
      prevFrame = (uint8_t*)heap_caps_malloc(size, MALLOC_CAP_8BIT);
    }

    if (prevFrame) {
      prevWidth = width;
      prevHeight = height;
      Serial.printf("[Motion] Allocated %d bytes for previous frame\n", size);
    } else {
      Serial.println("[Motion] Failed to allocate memory for motion detection");
      prevWidth = 0;
      prevHeight = 0;
    }
  }
};

#endif // MOTION_DETECT_H
