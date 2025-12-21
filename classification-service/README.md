# MouseTrap Classification Service

AI-powered image classification microservice for rodent detection. Uses TensorFlow.js with MobileNet v2 to classify images as rodent, pet, person, or other.

## Architecture

```
┌─────────────────┐     ┌─────────────────────────┐
│  Scout Device   │────▶│    Main Server          │
│  (ESP32-S3)     │     │    (Node.js)            │
└─────────────────┘     └───────────┬─────────────┘
                                    │
                                    ▼ HTTP POST
                        ┌─────────────────────────┐
                        │  Classification Service │
                        │  (Docker Container)     │
                        │  - TensorFlow.js        │
                        │  - MobileNet v2         │
                        │  - Port 3100            │
                        └─────────────────────────┘
```

## Quick Start

### Option 1: Standalone Docker (for testing)

```bash
cd /Users/wadehargrove/Documents/MouseTrap/classification-service

# Build and run
docker compose up --build

# In another terminal, run tests
node test/test-classification.js
```

### Option 2: With Full Stack

```bash
cd /Users/wadehargrove/Documents/MouseTrap/Server

# Start all services (mosquitto + classification)
docker compose up --build -d

# Check status
docker compose ps
docker compose logs classification
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/status` | Model status, memory usage, classification count |
| POST | `/classify` | Classify image (base64 or URL) |
| POST | `/classify/upload` | Classify uploaded file |
| POST | `/load-model` | Preload the model |

### POST /classify

Request body:
```json
{
  "image": "data:image/jpeg;base64,/9j/4AAQ..."
}
```
or
```json
{
  "imageUrl": "https://example.com/image.jpg"
}
```

Response:
```json
{
  "success": true,
  "classification": "rodent",
  "confidence": 0.87,
  "topMatch": "hamster",
  "predictions": [
    { "className": "hamster", "probability": 0.87 },
    { "className": "guinea pig", "probability": 0.05 },
    { "className": "mouse", "probability": 0.03 }
  ]
}
```

### Classification Categories

| Category | Description | Examples |
|----------|-------------|----------|
| `rodent` | Target animals | mouse, rat, hamster, guinea pig |
| `pet` | Common pets to filter out | cat, dog (various breeds) |
| `person` | Humans to filter out | person, face |
| `other` | Other detected objects | furniture, food, etc. |
| `unknown` | Low confidence | No clear match |

## Testing Plan

### Phase 1: Standalone Testing (Before Server Integration)

1. **Build the container:**
   ```bash
   cd classification-service
   docker compose up --build
   ```

2. **Wait for model to load** (check logs for "MobileNet model loaded"):
   ```bash
   docker compose logs -f
   ```

3. **Run automated tests:**
   ```bash
   node test/test-classification.js
   ```

4. **Manual curl tests:**
   ```bash
   # Health check
   curl http://localhost:3100/health

   # Status
   curl http://localhost:3100/status

   # Classify a mouse image
   curl -X POST http://localhost:3100/classify \
     -H "Content-Type: application/json" \
     -d '{"imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Mouse_white_background.jpg/1200px-Mouse_white_background.jpg"}'

   # Classify a cat image (should return "pet")
   curl -X POST http://localhost:3100/classify \
     -H "Content-Type: application/json" \
     -d '{"imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/1200px-Cat03.jpg"}'
   ```

### Phase 2: Integration Testing

Once standalone tests pass:

1. **Add to main docker-compose** (already done in `Server/docker-compose.yml`)

2. **Update main server** to call classification service instead of local TensorFlow

3. **Test MQTT → Classification flow:**
   - Scout device sends motion event with image
   - Server receives event
   - Server calls classification service
   - Classification result stored in database

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3100 | Server port |
| `NODE_ENV` | development | Environment |

## Resource Requirements

- **Memory:** 512MB minimum, 2GB recommended
- **CPU:** Model loading is CPU-intensive (~10-30 seconds)
- **Disk:** ~500MB for dependencies and model

## Troubleshooting

### Model loading fails
- Check memory limits in docker-compose
- Increase `start_period` in healthcheck

### Classification takes too long
- First classification may take longer (model warmup)
- Subsequent classifications should be ~100-500ms

### Container won't start
- Check if port 3100 is already in use
- Try `docker compose down` then `docker compose up --build`

## Development

### Local development (without Docker)

```bash
cd classification-service
npm install
npm run dev
```

### Rebuild after changes

```bash
docker compose down
docker compose up --build
```
