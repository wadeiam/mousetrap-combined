import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import * as tf from '@tensorflow/tfjs-node';
import * as mobilenet from '@tensorflow-models/mobilenet';

const app = express();
const PORT = process.env.PORT || 3100;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Model state
let model: mobilenet.MobileNet | null = null;
let modelLoading = false;
let modelLoadTime: number | null = null;
let classificationCount = 0;
let lastClassificationTime: number | null = null;

// Rodent-related ImageNet classes
const RODENT_CLASSES = [
  'hamster',
  'guinea pig',
  'wood rabbit', 'cottontail', 'cottontail rabbit',
  'hare',
  'porcupine', 'hedgehog',
  'marmot',
  'beaver',
  'mouse', 'computer mouse', // note: computer mouse is different
  'rat',
  'squirrel',
  'chipmunk',
  'prairie dog',
  'gopher',
  'capybara',
];

const PET_CLASSES = [
  'tabby', 'tabby cat',
  'tiger cat',
  'Persian cat',
  'Siamese cat',
  'Egyptian cat',
  'cougar', 'puma', 'catamount', 'mountain lion', 'painter', 'panther',
  'lynx', 'catamount',
  'leopard',
  'lion',
  'tiger',
  'cheetah',
  'golden retriever',
  'Labrador retriever',
  'German shepherd',
  'beagle',
  'boxer',
  'bulldog',
  'poodle',
  'Rottweiler',
  'Doberman',
  'husky',
  'collie',
  'Border collie',
  'cocker spaniel',
  'dachshund',
  'Chihuahua',
  'Yorkshire terrier',
  'pug',
  'Shih-Tzu',
  'Maltese dog',
  'Pomeranian',
  'Boston bull',
  'French bulldog',
];

const PERSON_CLASSES = [
  'person',
  'man',
  'woman',
  'boy',
  'girl',
  'face',
];

// Load the model
async function loadModel(): Promise<void> {
  if (model || modelLoading) return;

  modelLoading = true;
  const startTime = Date.now();

  console.log('Loading MobileNet model...');
  try {
    model = await mobilenet.load({
      version: 2,
      alpha: 1.0
    });
    modelLoadTime = Date.now() - startTime;
    console.log(`MobileNet model loaded in ${modelLoadTime}ms`);
  } catch (error) {
    console.error('Failed to load model:', error);
    throw error;
  } finally {
    modelLoading = false;
  }
}

// Classify an image
async function classifyImage(imageBuffer: Buffer): Promise<{
  predictions: Array<{ className: string; probability: number }>;
  classification: 'rodent' | 'pet' | 'person' | 'other' | 'unknown';
  confidence: number;
  topMatch: string;
}> {
  if (!model) {
    await loadModel();
  }

  if (!model) {
    throw new Error('Model not loaded');
  }

  // Decode image
  let tensor: tf.Tensor3D;
  try {
    const decoded = tf.node.decodeImage(imageBuffer, 3);
    tensor = decoded as tf.Tensor3D;
  } catch (error) {
    throw new Error('Failed to decode image');
  }

  // Classify
  const predictions = await model.classify(tensor);
  tensor.dispose();

  // Update stats
  classificationCount++;
  lastClassificationTime = Date.now();

  // Determine classification
  let classification: 'rodent' | 'pet' | 'person' | 'other' | 'unknown' = 'unknown';
  let confidence = 0;
  let topMatch = predictions[0]?.className || 'unknown';

  for (const pred of predictions) {
    const className = pred.className.toLowerCase();

    // Check rodent
    if (RODENT_CLASSES.some(r => className.includes(r.toLowerCase()))) {
      if (pred.probability > confidence) {
        classification = 'rodent';
        confidence = pred.probability;
        topMatch = pred.className;
      }
    }

    // Check pet
    if (PET_CLASSES.some(p => className.includes(p.toLowerCase()))) {
      if (pred.probability > confidence) {
        classification = 'pet';
        confidence = pred.probability;
        topMatch = pred.className;
      }
    }

    // Check person
    if (PERSON_CLASSES.some(p => className.includes(p.toLowerCase()))) {
      if (pred.probability > confidence) {
        classification = 'person';
        confidence = pred.probability;
        topMatch = pred.className;
      }
    }
  }

  // If no specific match, classify as 'other' with top prediction confidence
  if (classification === 'unknown' && predictions.length > 0) {
    classification = 'other';
    confidence = predictions[0].probability;
  }

  return {
    predictions: predictions.map(p => ({
      className: p.className,
      probability: p.probability
    })),
    classification,
    confidence,
    topMatch
  };
}

// Routes

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    modelLoaded: !!model,
    modelLoading,
    uptime: process.uptime()
  });
});

// Model status
app.get('/status', (req: Request, res: Response) => {
  res.json({
    modelLoaded: !!model,
    modelLoading,
    modelLoadTime,
    classificationCount,
    lastClassificationTime,
    memoryUsage: process.memoryUsage(),
    tfMemory: tf.memory()
  });
});

// Classify image from base64
app.post('/classify', async (req: Request, res: Response) => {
  try {
    const { image, imageUrl } = req.body;

    let imageBuffer: Buffer;

    if (image) {
      // Base64 image
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else if (imageUrl) {
      // Fetch from URL
      const response = await fetch(imageUrl);
      if (!response.ok) {
        return res.status(400).json({ error: 'Failed to fetch image from URL' });
      }
      const arrayBuffer = await response.arrayBuffer();
      imageBuffer = Buffer.from(arrayBuffer);
    } else {
      return res.status(400).json({ error: 'No image provided. Send "image" (base64) or "imageUrl"' });
    }

    const result = await classifyImage(imageBuffer);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Classification error:', error);
    res.status(500).json({
      error: 'Classification failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Classify uploaded file
app.post('/classify/upload', upload.single('image'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const result = await classifyImage(req.file.buffer);

    res.json({
      success: true,
      filename: req.file.originalname,
      ...result
    });
  } catch (error) {
    console.error('Classification error:', error);
    res.status(500).json({
      error: 'Classification failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Preload model endpoint
app.post('/load-model', async (req: Request, res: Response) => {
  try {
    await loadModel();
    res.json({
      success: true,
      modelLoadTime,
      message: 'Model loaded successfully'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to load model',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Classification service running on port ${PORT}`);
  console.log('Endpoints:');
  console.log('  GET  /health         - Health check');
  console.log('  GET  /status         - Model and stats status');
  console.log('  POST /classify       - Classify base64 image or URL');
  console.log('  POST /classify/upload - Classify uploaded file');
  console.log('  POST /load-model     - Preload the model');

  // Preload model on startup
  loadModel().catch(err => {
    console.error('Failed to preload model:', err);
  });
});
