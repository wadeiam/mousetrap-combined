import { Router, Response } from 'express';
import { Pool } from 'pg';
import { authenticate, AuthRequest, requireRole } from '../middleware/auth.middleware';
import { validateUuid } from '../middleware/validation.middleware';
import { MqttService } from '../services/mqtt.service';

const router = Router();

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

// Helper to get device and verify access
async function getDeviceForControl(
  deviceId: string,
  tenantId: string,
  userId: string,
  requireOnline: boolean = true
): Promise<{ device: any; error?: string; statusCode?: number }> {
  // Check if user is superadmin
  const superadminCheck = await dbPool.query(
    `SELECT user_is_superadmin($1) as is_superadmin`,
    [userId]
  );
  const isSuperadmin = superadminCheck.rows[0].is_superadmin;

  let result;
  if (isSuperadmin) {
    result = await dbPool.query(
      `SELECT id, name, mqtt_client_id, tenant_id, online, device_type, local_ip
       FROM devices WHERE id = $1 AND unclaimed_at IS NULL`,
      [deviceId]
    );
  } else {
    result = await dbPool.query(
      `SELECT id, name, mqtt_client_id, tenant_id, online, device_type, local_ip
       FROM devices WHERE id = $1 AND tenant_id = $2 AND unclaimed_at IS NULL`,
      [deviceId, tenantId]
    );
  }

  if (result.rows.length === 0) {
    return { device: null, error: 'Device not found', statusCode: 404 };
  }

  const device = result.rows[0];

  if (requireOnline && !device.online) {
    return { device: null, error: 'Device is offline', statusCode: 503 };
  }

  return { device };
}

// ============================================================================
// GET /devices/:id/camera-settings - Get camera settings from device
// ============================================================================
router.get('/:id/camera-settings', validateUuid(), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    const { device, error, statusCode } = await getDeviceForControl(id, tenantId, userId);
    if (error) {
      return res.status(statusCode!).json({ success: false, error });
    }

    // Request camera settings via MQTT and wait for response
    const settings = await mqttService.requestDeviceSettings(
      device.tenant_id,
      device.mqtt_client_id,
      'camera-settings'
    );

    res.json({
      success: true,
      data: settings,
    });
  } catch (error: any) {
    console.error('[Device Controls] Get camera settings error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

// ============================================================================
// POST /devices/:id/camera-settings - Update camera settings on device
// ============================================================================
router.post('/:id/camera-settings', validateUuid(), requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;
    const settings = req.body;

    const { device, error, statusCode } = await getDeviceForControl(id, tenantId, userId);
    if (error) {
      return res.status(statusCode!).json({ success: false, error });
    }

    // Send camera settings via MQTT
    await mqttService.publishDeviceCommand(device.tenant_id, device.mqtt_client_id, {
      command: 'set_camera_settings',
      timestamp: Date.now(),
      settings,
    });

    console.log(`[Device Controls] Camera settings sent to ${device.name}`);

    res.json({
      success: true,
      message: 'Camera settings sent to device',
    });
  } catch (error: any) {
    console.error('[Device Controls] Set camera settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// ============================================================================
// GET /devices/:id/calibration - Get calibration settings (Trap only)
// ============================================================================
router.get('/:id/calibration', validateUuid(), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    const { device, error, statusCode } = await getDeviceForControl(id, tenantId, userId);
    if (error) {
      return res.status(statusCode!).json({ success: false, error });
    }

    if (device.device_type === 'scout') {
      return res.status(400).json({
        success: false,
        error: 'Calibration settings only available for trap devices',
      });
    }

    const settings = await mqttService.requestDeviceSettings(
      device.tenant_id,
      device.mqtt_client_id,
      'calibration'
    );

    res.json({
      success: true,
      data: settings,
    });
  } catch (error: any) {
    console.error('[Device Controls] Get calibration error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

// ============================================================================
// POST /devices/:id/calibration - Update calibration settings (Trap only)
// ============================================================================
router.post('/:id/calibration', validateUuid(), requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;
    const { calibrationOffset, overrideThreshold } = req.body;

    const { device, error, statusCode } = await getDeviceForControl(id, tenantId, userId);
    if (error) {
      return res.status(statusCode!).json({ success: false, error });
    }

    if (device.device_type === 'scout') {
      return res.status(400).json({
        success: false,
        error: 'Calibration settings only available for trap devices',
      });
    }

    await mqttService.publishDeviceCommand(device.tenant_id, device.mqtt_client_id, {
      command: 'set_calibration',
      timestamp: Date.now(),
      calibrationOffset,
      overrideThreshold,
    });

    console.log(`[Device Controls] Calibration settings sent to ${device.name}`);

    res.json({
      success: true,
      message: 'Calibration settings sent to device',
    });
  } catch (error: any) {
    console.error('[Device Controls] Set calibration error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// ============================================================================
// POST /devices/:id/recalibrate - Trigger recalibration (Trap only)
// ============================================================================
router.post('/:id/recalibrate', validateUuid(), requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    const { device, error, statusCode } = await getDeviceForControl(id, tenantId, userId);
    if (error) {
      return res.status(statusCode!).json({ success: false, error });
    }

    if (device.device_type === 'scout') {
      return res.status(400).json({
        success: false,
        error: 'Recalibration only available for trap devices',
      });
    }

    await mqttService.publishDeviceCommand(device.tenant_id, device.mqtt_client_id, {
      command: 'recalibrate',
      timestamp: Date.now(),
    });

    console.log(`[Device Controls] Recalibrate command sent to ${device.name}`);

    res.json({
      success: true,
      message: 'Recalibration command sent to device',
    });
  } catch (error: any) {
    console.error('[Device Controls] Recalibrate error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// ============================================================================
// GET /devices/:id/servo-settings - Get servo settings (Trap only)
// ============================================================================
router.get('/:id/servo-settings', validateUuid(), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    const { device, error, statusCode } = await getDeviceForControl(id, tenantId, userId);
    if (error) {
      return res.status(statusCode!).json({ success: false, error });
    }

    if (device.device_type === 'scout') {
      return res.status(400).json({
        success: false,
        error: 'Servo settings only available for trap devices',
      });
    }

    const settings = await mqttService.requestDeviceSettings(
      device.tenant_id,
      device.mqtt_client_id,
      'servo'
    );

    res.json({
      success: true,
      data: settings,
    });
  } catch (error: any) {
    console.error('[Device Controls] Get servo settings error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

// ============================================================================
// POST /devices/:id/servo-settings - Update servo settings (Trap only)
// ============================================================================
router.post('/:id/servo-settings', validateUuid(), requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;
    const { startUS, endUS, disabled } = req.body;

    const { device, error, statusCode } = await getDeviceForControl(id, tenantId, userId);
    if (error) {
      return res.status(statusCode!).json({ success: false, error });
    }

    if (device.device_type === 'scout') {
      return res.status(400).json({
        success: false,
        error: 'Servo settings only available for trap devices',
      });
    }

    // Validate servo microseconds range
    if (startUS !== undefined && (startUS < 500 || startUS > 2500)) {
      return res.status(400).json({
        success: false,
        error: 'Start position must be between 500 and 2500 microseconds',
      });
    }
    if (endUS !== undefined && (endUS < 500 || endUS > 2500)) {
      return res.status(400).json({
        success: false,
        error: 'End position must be between 500 and 2500 microseconds',
      });
    }

    await mqttService.publishDeviceCommand(device.tenant_id, device.mqtt_client_id, {
      command: 'set_servo_settings',
      timestamp: Date.now(),
      startUS,
      endUS,
      disabled,
    });

    console.log(`[Device Controls] Servo settings sent to ${device.name}`);

    res.json({
      success: true,
      message: 'Servo settings sent to device',
    });
  } catch (error: any) {
    console.error('[Device Controls] Set servo settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// ============================================================================
// POST /devices/:id/test-servo - Test servo movement (Trap only)
// ============================================================================
router.post('/:id/test-servo', validateUuid(), requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    const { device, error, statusCode } = await getDeviceForControl(id, tenantId, userId);
    if (error) {
      return res.status(statusCode!).json({ success: false, error });
    }

    if (device.device_type === 'scout') {
      return res.status(400).json({
        success: false,
        error: 'Servo test only available for trap devices',
      });
    }

    await mqttService.publishDeviceCommand(device.tenant_id, device.mqtt_client_id, {
      command: 'test_servo',
      timestamp: Date.now(),
    });

    console.log(`[Device Controls] Test servo command sent to ${device.name}`);

    res.json({
      success: true,
      message: 'Test servo command sent to device',
    });
  } catch (error: any) {
    console.error('[Device Controls] Test servo error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// ============================================================================
// GET /devices/:id/motion-config - Get motion config (Scout only)
// ============================================================================
router.get('/:id/motion-config', validateUuid(), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;

    const { device, error, statusCode } = await getDeviceForControl(id, tenantId, userId);
    if (error) {
      return res.status(statusCode!).json({ success: false, error });
    }

    if (device.device_type !== 'scout') {
      return res.status(400).json({
        success: false,
        error: 'Motion config only available for scout devices',
      });
    }

    const settings = await mqttService.requestDeviceSettings(
      device.tenant_id,
      device.mqtt_client_id,
      'motion-config'
    );

    res.json({
      success: true,
      data: settings,
    });
  } catch (error: any) {
    console.error('[Device Controls] Get motion config error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

// ============================================================================
// POST /devices/:id/motion-config - Update motion config (Scout only)
// ============================================================================
router.post('/:id/motion-config', validateUuid(), requireRole('admin', 'superadmin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId;
    const { threshold, minSize, maxSize } = req.body;

    const { device, error, statusCode } = await getDeviceForControl(id, tenantId, userId);
    if (error) {
      return res.status(statusCode!).json({ success: false, error });
    }

    if (device.device_type !== 'scout') {
      return res.status(400).json({
        success: false,
        error: 'Motion config only available for scout devices',
      });
    }

    await mqttService.publishDeviceCommand(device.tenant_id, device.mqtt_client_id, {
      command: 'set_motion_config',
      timestamp: Date.now(),
      threshold,
      minSize,
      maxSize,
    });

    console.log(`[Device Controls] Motion config sent to ${device.name}`);

    res.json({
      success: true,
      message: 'Motion config sent to device',
    });
  } catch (error: any) {
    console.error('[Device Controls] Set motion config error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
