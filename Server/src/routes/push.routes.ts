/**
 * Push Notification Routes
 *
 * API endpoints for managing push notification tokens and preferences.
 */

import { Router, Response } from 'express';
import { Pool } from 'pg';
import { getPushService } from '../services/push.service';
import { getEscalationService, ESCALATION_PRESETS } from '../services/escalation.service';
import { AuthRequest, authenticate } from '../middleware/auth.middleware';

const router = Router();

// Get database pool from parent app
let dbPool: Pool;
router.use((req, _res, next) => {
  if (!dbPool && (req.app as any).locals.dbPool) {
    dbPool = (req.app as any).locals.dbPool;
  }
  next();
});

// All routes require authentication
router.use(authenticate);

/**
 * POST /push/register-token
 * Register a push notification token for the authenticated user
 */
router.post('/register-token', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { token, platform, deviceName } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }

    if (!platform || !['ios', 'android', 'web'].includes(platform)) {
      return res.status(400).json({
        success: false,
        error: 'Platform must be one of: ios, android, web',
      });
    }

    const pushService = getPushService();
    if (!pushService) {
      return res.status(500).json({ success: false, error: 'Push service not initialized' });
    }

    const result = await pushService.registerToken(userId, token, platform, deviceName);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({ success: true, message: 'Token registered successfully' });
  } catch (error: any) {
    console.error('[PUSH] Error registering token:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /push/token
 * Remove a push notification token
 */
router.delete('/token', async (req: AuthRequest, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }

    const pushService = getPushService();
    if (!pushService) {
      return res.status(500).json({ success: false, error: 'Push service not initialized' });
    }

    await pushService.removeToken(token);
    res.json({ success: true, message: 'Token removed successfully' });
  } catch (error: any) {
    console.error('[PUSH] Error removing token:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /push/preferences
 * Get notification preferences for the authenticated user
 */
router.get('/preferences', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const pushService = getPushService();
    if (!pushService) {
      return res.status(500).json({ success: false, error: 'Push service not initialized' });
    }

    const preferences = await pushService.getPreferences(userId);
    res.json({ success: true, preferences });
  } catch (error: any) {
    console.error('[PUSH] Error getting preferences:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PUT /push/preferences
 * Update notification preferences for the authenticated user
 */
router.put('/preferences', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const {
      trap_alerts,
      device_offline,
      device_online,
      low_battery,
      quiet_hours_enabled,
      quiet_hours_start,
      quiet_hours_end,
    } = req.body;

    const pushService = getPushService();
    if (!pushService) {
      return res.status(500).json({ success: false, error: 'Push service not initialized' });
    }

    await pushService.updatePreferences(userId, {
      trap_alerts,
      device_offline,
      device_online,
      low_battery,
      quiet_hours_enabled,
      quiet_hours_start,
      quiet_hours_end,
    });

    res.json({ success: true, message: 'Preferences updated successfully' });
  } catch (error: any) {
    console.error('[PUSH] Error updating preferences:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /push/test
 * Send a test notification to the authenticated user
 */
router.post('/test', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const pushService = getPushService();
    if (!pushService) {
      return res.status(500).json({ success: false, error: 'Push service not initialized' });
    }

    const result = await pushService.sendTestNotification(userId);

    if (result.sent === 0 && result.failed === 0) {
      return res.status(404).json({
        success: false,
        error: 'No push tokens registered. Please register a device first.',
      });
    }

    res.json({
      success: true,
      message: `Test notification sent to ${result.sent} device(s)`,
      sent: result.sent,
      failed: result.failed,
    });
  } catch (error: any) {
    console.error('[PUSH] Error sending test notification:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================================
// Escalation Settings Endpoints
// ============================================================================

/**
 * GET /push/escalation/presets
 * Get available escalation presets with timing details
 */
router.get('/escalation/presets', async (_req: AuthRequest, res: Response) => {
  try {
    res.json({
      success: true,
      presets: {
        relaxed: {
          name: 'Relaxed',
          description: 'Longer intervals between escalation levels',
          ...ESCALATION_PRESETS.relaxed,
        },
        normal: {
          name: 'Normal',
          description: 'Balanced escalation timing (default)',
          ...ESCALATION_PRESETS.normal,
        },
        aggressive: {
          name: 'Aggressive',
          description: 'Faster escalation for quicker response',
          ...ESCALATION_PRESETS.aggressive,
        },
      },
    });
  } catch (error: any) {
    console.error('[PUSH] Error getting escalation presets:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /push/escalation/settings
 * Get user's escalation configuration
 */
router.get('/escalation/settings', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const result = await dbPool.query(
      `SELECT escalation_preset, custom_escalation, critical_override_dnd, dnd_override_acknowledged
       FROM notification_preferences
       WHERE user_id = $1`,
      [userId]
    );

    const settings = result.rows[0] || {
      escalation_preset: 'normal',
      custom_escalation: null,
      critical_override_dnd: true,
      dnd_override_acknowledged: false,
    };

    res.json({ success: true, settings });
  } catch (error: any) {
    console.error('[PUSH] Error getting escalation settings:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PUT /push/escalation/settings
 * Update user's escalation configuration
 */
router.put('/escalation/settings', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { escalation_preset, custom_escalation, critical_override_dnd, dnd_override_acknowledged } = req.body;

    // Validate preset
    if (escalation_preset && !['relaxed', 'normal', 'aggressive', 'custom'].includes(escalation_preset)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid escalation preset. Must be: relaxed, normal, aggressive, or custom',
      });
    }

    // Validate custom escalation if custom preset selected
    if (escalation_preset === 'custom' && custom_escalation) {
      const { level2, level3, level4, level5 } = custom_escalation;
      if (level2 && level3 && level4 && level5) {
        if (level2 >= level3 || level3 >= level4 || level4 >= level5) {
          return res.status(400).json({
            success: false,
            error: 'Custom escalation levels must be in ascending order',
          });
        }
      }
    }

    await dbPool.query(
      `INSERT INTO notification_preferences (user_id, escalation_preset, custom_escalation, critical_override_dnd, dnd_override_acknowledged)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id)
       DO UPDATE SET
         escalation_preset = COALESCE($2, notification_preferences.escalation_preset),
         custom_escalation = COALESCE($3, notification_preferences.custom_escalation),
         critical_override_dnd = COALESCE($4, notification_preferences.critical_override_dnd),
         dnd_override_acknowledged = COALESCE($5, notification_preferences.dnd_override_acknowledged)`,
      [
        userId,
        escalation_preset || 'normal',
        custom_escalation ? JSON.stringify(custom_escalation) : null,
        critical_override_dnd ?? true,
        dnd_override_acknowledged ?? false,
      ]
    );

    res.json({ success: true, message: 'Escalation settings updated successfully' });
  } catch (error: any) {
    console.error('[PUSH] Error updating escalation settings:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================================
// Emergency Contacts Endpoints
// ============================================================================

/**
 * GET /push/emergency-contacts
 * List user's emergency contacts
 */
router.get('/emergency-contacts', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const result = await dbPool.query(
      `SELECT id, contact_type, contact_value, contact_name, escalation_level, enabled, created_at
       FROM emergency_contacts
       WHERE user_id = $1
       ORDER BY escalation_level, created_at`,
      [userId]
    );

    res.json({ success: true, contacts: result.rows });
  } catch (error: any) {
    console.error('[PUSH] Error getting emergency contacts:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /push/emergency-contacts
 * Add an emergency contact
 */
router.post('/emergency-contacts', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { contact_type, contact_value, contact_name, escalation_level } = req.body;

    // Validate contact type
    if (!contact_type || !['app_user', 'sms', 'email'].includes(contact_type)) {
      return res.status(400).json({
        success: false,
        error: 'Contact type must be: app_user, sms, or email',
      });
    }

    // Validate contact value
    if (!contact_value) {
      return res.status(400).json({ success: false, error: 'Contact value is required' });
    }

    // Validate email format
    if (contact_type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_value)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    // Validate phone format (basic check)
    if (contact_type === 'sms' && !/^\+?[1-9]\d{1,14}$/.test(contact_value.replace(/[\s-]/g, ''))) {
      return res.status(400).json({ success: false, error: 'Invalid phone number format' });
    }

    // Validate escalation level
    const level = escalation_level ?? 4;
    if (level < 1 || level > 5) {
      return res.status(400).json({
        success: false,
        error: 'Escalation level must be between 1 and 5',
      });
    }

    // If app_user, verify the user exists
    if (contact_type === 'app_user') {
      const userCheck = await dbPool.query('SELECT id FROM users WHERE id = $1', [contact_value]);
      if (userCheck.rows.length === 0) {
        return res.status(400).json({ success: false, error: 'User not found' });
      }
    }

    const result = await dbPool.query(
      `INSERT INTO emergency_contacts (user_id, contact_type, contact_value, contact_name, escalation_level)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, contact_type, contact_value, contact_name, escalation_level, enabled, created_at`,
      [userId, contact_type, contact_value, contact_name || null, level]
    );

    res.status(201).json({ success: true, contact: result.rows[0] });
  } catch (error: any) {
    console.error('[PUSH] Error adding emergency contact:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * PUT /push/emergency-contacts/:id
 * Update an emergency contact
 */
router.put('/emergency-contacts/:id', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { id } = req.params;
    const { contact_name, escalation_level, enabled } = req.body;

    const result = await dbPool.query(
      `UPDATE emergency_contacts
       SET contact_name = COALESCE($3, contact_name),
           escalation_level = COALESCE($4, escalation_level),
           enabled = COALESCE($5, enabled)
       WHERE id = $1 AND user_id = $2
       RETURNING id, contact_type, contact_value, contact_name, escalation_level, enabled, created_at`,
      [id, userId, contact_name, escalation_level, enabled]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }

    res.json({ success: true, contact: result.rows[0] });
  } catch (error: any) {
    console.error('[PUSH] Error updating emergency contact:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /push/emergency-contacts/:id
 * Remove an emergency contact
 */
router.delete('/emergency-contacts/:id', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { id } = req.params;

    const result = await dbPool.query(
      'DELETE FROM emergency_contacts WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }

    res.json({ success: true, message: 'Contact removed successfully' });
  } catch (error: any) {
    console.error('[PUSH] Error removing emergency contact:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
