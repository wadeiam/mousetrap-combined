import { Router, Response } from 'express';
import { Pool } from 'pg';
import multer from 'multer';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.middleware';
import { validateUuid } from '../middleware/validation.middleware';
import { createFirmwareStorageService } from '../services/firmware-storage.service';
import { MqttService } from '../services/mqtt.service';
import { mqttTopics } from '../types/mqtt.types';
import { logger } from '../services/logger.service';

const router = Router();
const firmwareStorage = createFirmwareStorageService();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (_req, file, cb) => {
    // Accept only .bin files
    if (file.mimetype === 'application/octet-stream' || file.originalname.endsWith('.bin')) {
      cb(null, true);
    } else {
      cb(new Error('Only .bin files are allowed'));
    }
  },
});

// Apply authentication to all routes
router.use(authenticate);

// Get database pool and MQTT service from parent app
let dbPool: Pool;
let mqttService: MqttService;
router.use((req: AuthRequest, _res: Response, next) => {
  if (!dbPool && (req.app as any).locals.dbPool) {
    dbPool = (req.app as any).locals.dbPool;
  }
  if (!mqttService && (req.app as any).locals.mqttService) {
    mqttService = (req.app as any).locals.mqttService;
  }
  next();
});

// GET /firmware - List all firmware releases (all authenticated users can view)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;

    // Get both tenant-specific and global firmware releases
    const result = await dbPool.query(
      `SELECT
        id, tenant_id, version, type, url, size, sha256,
        changelog, required, is_global, published_at, deprecated_at, created_at
      FROM firmware_versions
      WHERE (tenant_id = $1 OR is_global = true) AND deprecated_at IS NULL
      ORDER BY published_at DESC`,
      [tenantId]
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error: any) {
    console.error('Get firmware releases error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /firmware - Upload a new firmware release (admin or superadmin only)
router.post('/', requireRole('admin', 'superadmin'), upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    const tenantId = req.user!.tenantId;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'No file provided',
      });
    }

    // Parse metadata from form data
    const data = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data;

    if (!data || !data.version || !data.type) {
      return res.status(400).json({
        success: false,
        error: 'Version and type are required',
      });
    }

    // Validate type
    if (data.type !== 'firmware' && data.type !== 'filesystem') {
      return res.status(400).json({
        success: false,
        error: 'Type must be either "firmware" or "filesystem"',
      });
    }

    // Save firmware file to disk
    const metadata = await firmwareStorage.saveFirmware({
      tenantId,
      version: data.version,
      type: data.type,
      filename: file.originalname,
      buffer: file.buffer,
    });

    console.log('[FIRMWARE] Saved firmware file:', metadata.path);
    logger.info('Firmware file uploaded', {
      tenantId,
      version: data.version,
      type: data.type,
      size: metadata.size,
      sha256: metadata.sha256,
      userId: req.user!.userId,
    });

    // Insert firmware version record into database
    const result = await dbPool.query(
      `INSERT INTO firmware_versions
        (tenant_id, version, type, url, size, sha256, changelog, required, is_global)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING
        id, tenant_id, version, type, url, size, sha256,
        changelog, required, is_global, published_at, deprecated_at, created_at`,
      [
        tenantId,
        data.version,
        data.type,
        metadata.url,
        metadata.size,
        metadata.sha256,
        data.changelog || null,
        data.required || false,
        data.is_global || false,
      ]
    );

    const firmwareRecord = result.rows[0];

    // Publish MQTT notification to devices (if auto_publish not explicitly false)
    const autoPublish = data.auto_publish !== false;
    if (autoPublish && mqttService && mqttService.isConnected()) {
      try {
        const updateMessage = {
          version: firmwareRecord.version,
          url: firmwareRecord.url,
          size: firmwareRecord.size,
          sha256: firmwareRecord.sha256,
          changelog: firmwareRecord.changelog,
          required: firmwareRecord.required,
        };

        if (data.type === 'firmware') {
          await mqttService.publishFirmwareUpdate(tenantId, updateMessage, firmwareRecord.is_global);
          console.log(`[FIRMWARE] Published firmware update notification: ${data.version}`);
          logger.info('Firmware update notification published', {
            tenantId,
            version: data.version,
            type: data.type,
            isGlobal: firmwareRecord.is_global,
          });
        } else {
          await mqttService.publishFilesystemUpdate(tenantId, updateMessage, firmwareRecord.is_global);
          console.log(`[FIRMWARE] Published filesystem update notification: ${data.version}`);
          logger.info('Filesystem update notification published', {
            tenantId,
            version: data.version,
            type: data.type,
            isGlobal: firmwareRecord.is_global,
          });
        }
      } catch (mqttError: any) {
        console.error('[FIRMWARE] Failed to publish MQTT notification:', mqttError.message);
        logger.error('Failed to publish firmware update notification', {
          tenantId,
          version: data.version,
          error: mqttError.message,
        });
        // Don't fail the upload if MQTT publish fails
      }
    }

    res.status(201).json({
      success: true,
      data: firmwareRecord,
    });
  } catch (error: any) {
    console.error('Upload firmware error:', error);
    logger.error('Firmware upload failed', {
      tenantId: req.user!.tenantId,
      userId: req.user!.userId,
      error: error.message,
      stack: error.stack,
    });

    if (error.code === '23505') { // Unique constraint violation
      return res.status(409).json({
        success: false,
        error: 'Firmware version already exists',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// PUT /firmware/:id - Update firmware metadata and optionally replace file (admin or superadmin only)
router.put('/:id', requireRole('admin', 'superadmin'), upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const file = req.file;
    const tenantId = req.user!.tenantId;

    // Parse metadata from form data
    const data = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data;

    // Get existing firmware details
    const selectResult = await dbPool.query(
      `SELECT id, tenant_id, version, type, url, size, sha256, is_global, required, changelog
       FROM firmware_versions
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    if (selectResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Firmware release not found',
      });
    }

    const existingFirmware = selectResult.rows[0];

    // Build update data from metadata or keep existing values
    const newVersion = data?.version !== undefined ? data.version : existingFirmware.version;
    const newType = data?.type !== undefined ? data.type : existingFirmware.type;
    const newChangelog = data?.changelog !== undefined ? data.changelog : existingFirmware.changelog;
    const newRequired = data?.required !== undefined ? data.required : existingFirmware.required;
    const newIsGlobal = data?.is_global !== undefined ? data.is_global : existingFirmware.is_global;

    // Validate type if changed
    if (newType !== 'firmware' && newType !== 'filesystem') {
      return res.status(400).json({
        success: false,
        error: 'Type must be either "firmware" or "filesystem"',
      });
    }

    let fileMetadata = {
      url: existingFirmware.url,
      size: existingFirmware.size,
      sha256: existingFirmware.sha256,
    };

    // Handle file replacement if provided
    if (file) {
      // Delete old file if version or type changed
      if (newVersion !== existingFirmware.version || newType !== existingFirmware.type) {
        try {
          await firmwareStorage.deleteFirmware(
            existingFirmware.tenant_id,
            existingFirmware.type,
            existingFirmware.version
          );
          console.log(`[FIRMWARE] Deleted old firmware file: ${existingFirmware.version}`);
        } catch (fileError: any) {
          console.error('[FIRMWARE] Failed to delete old file:', fileError.message);
          // Continue even if old file deletion fails
        }
      }

      // Save new firmware file
      const savedMetadata = await firmwareStorage.saveFirmware({
        tenantId,
        version: newVersion,
        type: newType,
        filename: file.originalname,
        buffer: file.buffer,
      });

      fileMetadata = {
        url: savedMetadata.url,
        size: savedMetadata.size,
        sha256: savedMetadata.sha256,
      };

      console.log('[FIRMWARE] Replaced firmware file:', savedMetadata.path);
      logger.info('Firmware file replaced', {
        tenantId,
        version: newVersion,
        type: newType,
        size: fileMetadata.size,
        sha256: fileMetadata.sha256,
        userId: req.user!.userId,
      });
    } else if (newVersion !== existingFirmware.version || newType !== existingFirmware.type) {
      // If version or type changed without new file, we need to rename/move the existing file
      try {
        // Read existing file
        const existingFileBuffer = await firmwareStorage.readFirmware(
          existingFirmware.tenant_id,
          existingFirmware.type,
          existingFirmware.version
        );

        // Delete old file
        await firmwareStorage.deleteFirmware(
          existingFirmware.tenant_id,
          existingFirmware.type,
          existingFirmware.version
        );

        // Save with new version/type
        const savedMetadata = await firmwareStorage.saveFirmware({
          tenantId,
          version: newVersion,
          type: newType,
          filename: `${newVersion}.bin`,
          buffer: existingFileBuffer,
        });

        fileMetadata = {
          url: savedMetadata.url,
          size: savedMetadata.size,
          sha256: savedMetadata.sha256,
        };

        console.log('[FIRMWARE] Moved firmware file to new version/type');
      } catch (moveError: any) {
        console.error('[FIRMWARE] Failed to move firmware file:', moveError.message);
        return res.status(500).json({
          success: false,
          error: 'Failed to update version/type without new file',
        });
      }
    }

    // Update database record
    const updateResult = await dbPool.query(
      `UPDATE firmware_versions
       SET version = $1, type = $2, url = $3, size = $4, sha256 = $5,
           changelog = $6, required = $7, is_global = $8, published_at = NOW()
       WHERE id = $9
       RETURNING
        id, tenant_id, version, type, url, size, sha256,
        changelog, required, is_global, published_at, deprecated_at, created_at`,
      [
        newVersion,
        newType,
        fileMetadata.url,
        fileMetadata.size,
        fileMetadata.sha256,
        newChangelog,
        newRequired,
        newIsGlobal,
        id
      ]
    );

    const updatedFirmware = updateResult.rows[0];

    // Publish MQTT notification to devices
    if (mqttService && mqttService.isConnected()) {
      try {
        const updateMessage = {
          version: updatedFirmware.version,
          url: updatedFirmware.url,
          size: updatedFirmware.size,
          sha256: updatedFirmware.sha256,
          changelog: updatedFirmware.changelog,
          required: updatedFirmware.required,
        };

        if (updatedFirmware.type === 'firmware') {
          await mqttService.publishFirmwareUpdate(tenantId, updateMessage, updatedFirmware.is_global);
          console.log(`[FIRMWARE] Published firmware update notification: ${updatedFirmware.version}`);
          logger.info('Firmware update notification published', {
            tenantId,
            version: updatedFirmware.version,
            type: updatedFirmware.type,
            isGlobal: updatedFirmware.is_global,
          });
        } else {
          await mqttService.publishFilesystemUpdate(tenantId, updateMessage, updatedFirmware.is_global);
          console.log(`[FIRMWARE] Published filesystem update notification: ${updatedFirmware.version}`);
          logger.info('Filesystem update notification published', {
            tenantId,
            version: updatedFirmware.version,
            type: updatedFirmware.type,
            isGlobal: updatedFirmware.is_global,
          });
        }
      } catch (mqttError: any) {
        console.error('[FIRMWARE] Failed to publish MQTT notification:', mqttError.message);
        logger.error('Failed to publish firmware update notification', {
          tenantId,
          version: updatedFirmware.version,
          error: mqttError.message,
        });
        // Don't fail the update if MQTT publish fails
      }
    }

    res.json({
      success: true,
      data: updatedFirmware,
    });
  } catch (error: any) {
    console.error('Update firmware error:', error);
    logger.error('Firmware update failed', {
      tenantId: req.user!.tenantId,
      userId: req.user!.userId,
      error: error.message,
      stack: error.stack,
    });

    if (error.code === '23505') { // Unique constraint violation
      return res.status(409).json({
        success: false,
        error: 'Firmware version already exists',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// DELETE /firmware/:id - Delete a firmware release (admin or superadmin only)
router.delete('/:id', requireRole('admin', 'superadmin'), validateUuid(), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;

    // Get firmware details before deleting
    const selectResult = await dbPool.query(
      `SELECT id, tenant_id, version, type, is_global
       FROM firmware_versions
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    if (selectResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Firmware release not found',
      });
    }

    const firmware = selectResult.rows[0];

    // Delete from database first
    await dbPool.query(
      `DELETE FROM firmware_versions WHERE id = $1`,
      [id]
    );

    // Delete physical file
    try {
      await firmwareStorage.deleteFirmware(
        firmware.tenant_id,
        firmware.type,
        firmware.version
      );
      console.log(`[FIRMWARE] Deleted firmware files: ${firmware.version}`);
      logger.info('Firmware deleted', {
        tenantId,
        version: firmware.version,
        type: firmware.type,
        userId: req.user!.userId,
      });
    } catch (fileError: any) {
      console.error('[FIRMWARE] Failed to delete physical file:', fileError.message);
      logger.error('Failed to delete firmware file', {
        tenantId,
        version: firmware.version,
        error: fileError.message,
      });
      // Continue even if file deletion fails
    }

    // Clear or update MQTT retained message
    if (mqttService && mqttService.isConnected()) {
      try {
        const topic = firmware.is_global
          ? (firmware.type === 'firmware'
              ? mqttTopics.globalFirmwareUpdate()
              : mqttTopics.globalFilesystemUpdate())
          : (firmware.type === 'firmware'
              ? mqttTopics.firmwareUpdate(tenantId)
              : mqttTopics.filesystemUpdate(tenantId));

        // Check if there's a newer version to publish (same type, same is_global)
        const newerVersion = await dbPool.query(
          `SELECT version, url, size, sha256, changelog, required
           FROM firmware_versions
           WHERE tenant_id = $1 AND type = $2 AND is_global = $3 AND deprecated_at IS NULL
           ORDER BY published_at DESC
           LIMIT 1`,
          [tenantId, firmware.type, firmware.is_global]
        );

        if (newerVersion.rows.length > 0) {
          // Publish the newer version
          const newer = newerVersion.rows[0];
          const updateMessage = {
            version: newer.version,
            url: newer.url,
            size: newer.size,
            sha256: newer.sha256,
            changelog: newer.changelog,
            required: newer.required,
          };

          if (firmware.type === 'firmware') {
            await mqttService.publishFirmwareUpdate(tenantId, updateMessage, firmware.is_global);
          } else {
            await mqttService.publishFilesystemUpdate(tenantId, updateMessage, firmware.is_global);
          }
          console.log(`[FIRMWARE] Republished newer version ${newer.version} on ${topic}`);
          logger.info('Republished newer firmware version', {
            tenantId,
            topic,
            newVersion: newer.version,
            oldVersion: firmware.version,
          });
        } else {
          // No newer version exists, clear the retained message
          await mqttService.clearRetainedMessage(topic);
          console.log(`[FIRMWARE] Cleared MQTT retained message on ${topic} (no newer version)`);
          logger.info('Cleared MQTT retained message', {
            tenantId,
            topic,
            version: firmware.version,
            type: firmware.type,
          });
        }
      } catch (mqttError: any) {
        console.error('[FIRMWARE] Failed to update MQTT retained message:', mqttError.message);
        logger.error('Failed to update MQTT retained message', {
          tenantId,
          version: firmware.version,
          error: mqttError.message,
        });
        // Don't fail the deletion if MQTT update fails
      }
    }

    res.json({
      success: true,
      data: null,
    });
  } catch (error: any) {
    console.error('Delete firmware error:', error);
    logger.error('Firmware deletion failed', {
      tenantId: req.user!.tenantId,
      userId: req.user!.userId,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /firmware/clear-retained - Clear all retained MQTT messages for firmware/filesystem (admin or superadmin only)
router.post('/clear-retained', requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;

    if (!mqttService || !mqttService.isConnected()) {
      return res.status(503).json({
        success: false,
        error: 'MQTT service not available',
      });
    }

    await mqttService.clearAllRetainedUpdates(tenantId);
    console.log(`[FIRMWARE] Cleared all retained MQTT messages for tenant ${tenantId}`);
    logger.info('Cleared all retained MQTT messages', {
      tenantId,
      userId: req.user!.userId,
    });

    res.json({
      success: true,
      message: 'Cleared all retained firmware/filesystem update messages',
    });
  } catch (error: any) {
    console.error('Clear retained messages error:', error);
    logger.error('Failed to clear retained messages', {
      tenantId: req.user!.tenantId,
      userId: req.user!.userId,
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
