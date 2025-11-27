/**
 * UUID Validation Middleware - Fix for 500 errors on malformed UUIDs
 *
 * This middleware should be added to routes that accept UUID parameters
 * to prevent database errors when malformed UUIDs are provided.
 *
 * Issue: Currently, endpoints return 500 errors when given malformed UUIDs
 * Solution: Validate UUID format and return 400 Bad Request
 *
 * Affected endpoints:
 * - GET /api/devices/:id
 * - POST /api/devices/:id/reboot
 * - POST /api/alerts/:id/acknowledge
 * - POST /api/alerts/:id/resolve
 * - DELETE /api/firmware/:id
 * - And all other endpoints using :id parameters
 */

// ============================================================================
// Option 1: Middleware Function (Recommended)
// ============================================================================

/**
 * Validates that the :id parameter is a valid UUID v4 format
 * Returns 400 Bad Request if invalid
 */
function validateUUID(req, res, next) {
  const { id } = req.params;

  // UUID v4 regex pattern
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid UUID format',
    });
  }

  next();
}

// Usage in route files:
// router.get('/:id', validateUUID, async (req, res) => { ... });
// router.post('/:id/reboot', validateUUID, async (req, res) => { ... });

// ============================================================================
// Option 2: Helper Function (Alternative)
// ============================================================================

/**
 * Helper function to validate UUID format
 * @param {string} id - The ID to validate
 * @returns {boolean} - True if valid UUID, false otherwise
 */
function isValidUUID(id) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

// Usage in route handlers:
// router.get('/:id', async (req, res) => {
//   const { id } = req.params;
//
//   if (!isValidUUID(id)) {
//     return res.status(400).json({
//       success: false,
//       error: 'Invalid UUID format',
//     });
//   }
//
//   // Continue with database query...
// });

// ============================================================================
// Option 3: Using a validation library (Best for large projects)
// ============================================================================

// Install: npm install uuid
// const { validate: isUUID } = require('uuid');
//
// function validateUUID(req, res, next) {
//   const { id } = req.params;
//
//   if (!isUUID(id)) {
//     return res.status(400).json({
//       success: false,
//       error: 'Invalid UUID format',
//     });
//   }
//
//   next();
// }

// ============================================================================
// Implementation Example for devices.routes.js
// ============================================================================

/*
const express = require('express');
const router = express.Router();

// Add middleware
function validateUUID(req, res, next) {
  const { id } = req.params;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid UUID format',
    });
  }

  next();
}

// BEFORE (returns 500 on malformed UUID):
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await dbPool.query('SELECT * FROM devices WHERE id = $1', [id]);
    // ... rest of code
  } catch (error) {
    // Catches database UUID casting error, returns 500
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// AFTER (returns 400 on malformed UUID):
router.get('/:id', validateUUID, async (req, res) => {
  try {
    const { id } = req.params;
    // UUID is already validated, safe to query
    const result = await dbPool.query('SELECT * FROM devices WHERE id = $1', [id]);
    // ... rest of code
  } catch (error) {
    // Only catches actual errors, not validation issues
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
*/

// ============================================================================
// Create a shared middleware file
// ============================================================================

// File: src/middleware/validate-uuid.middleware.ts or .js

/*
export function validateUUID(req: Request, res: Response, next: NextFunction) {
  const { id } = req.params;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid UUID format',
    });
  }

  next();
}
*/

// Then import and use in route files:
// import { validateUUID } from '../middleware/validate-uuid.middleware';
// router.get('/:id', validateUUID, async (req, res) => { ... });

// ============================================================================
// Files to Update
// ============================================================================

/*
1. /Users/wadehargrove/Documents/server-deployment/server/src/middleware/validate-uuid.middleware.ts
   - Create the middleware file

2. /Users/wadehargrove/Documents/server-deployment/server/src/routes/devices.routes.ts
   - Import and apply to: GET /:id, POST /:id/reboot, POST /:id/firmware-update, etc.

3. /Users/wadehargrove/Documents/server-deployment/server/src/routes/alerts.routes.ts
   - Import and apply to: POST /:id/acknowledge, POST /:id/resolve, etc.

4. /Users/wadehargrove/Documents/server-deployment/server/src/routes/firmware.routes.ts
   - Import and apply to: DELETE /:id, GET /:id, etc.

5. Any other routes using :id parameters for UUIDs
*/

// ============================================================================
// Testing the Fix
// ============================================================================

/*
After implementing the fix, test with:

# Should return 400 Bad Request (not 500)
curl -i http://192.168.133.110:4000/api/devices/99999 \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected response:
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "success": false,
  "error": "Invalid UUID format"
}

# Valid UUID format (non-existent) should still return 404
curl -i http://192.168.133.110:4000/api/devices/aaaaaaaa-0000-0000-0000-000000000000 \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected response:
HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "success": false,
  "error": "Device not found"
}
*/

module.exports = { validateUUID, isValidUUID };
