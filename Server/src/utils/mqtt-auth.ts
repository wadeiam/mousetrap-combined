import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PASSWD_FILE = '/opt/homebrew/etc/mosquitto/passwd';
const MOSQUITTO_PASSWD = '/opt/homebrew/bin/mosquitto_passwd';

// Debounce mosquitto reload to handle concurrent claims
let reloadTimer: NodeJS.Timeout | null = null;
const RELOAD_DEBOUNCE_MS = 2000; // Wait 2 seconds after last password update

/**
 * Add a single device's MQTT credentials to Mosquitto passwd file
 * This is more efficient than recreating the entire file
 */
export async function addMqttDevice(username: string, password: string): Promise<void> {
  try {
    console.log('[MQTT-AUTH] Adding device to Mosquitto:', username);

    // Validate inputs
    if (!username || !password) {
      throw new Error('Username and password are required');
    }

    // Add user to passwd file (mosquitto_passwd will hash it properly)
    const { stdout, stderr } = await execAsync(
      `${MOSQUITTO_PASSWD} -b ${PASSWD_FILE} "${username}" "${password}"`
    );

    if (stderr && !stderr.includes('Warning')) {
      console.warn('[MQTT-AUTH] mosquitto_passwd stderr:', stderr);
    }

    console.log('[MQTT-AUTH] ✓ Device credentials added to Mosquitto');
  } catch (error: any) {
    console.error('[MQTT-AUTH] ✗ Failed to add device credentials:', error.message);
    console.error('[MQTT-AUTH] Command:', `${MOSQUITTO_PASSWD} -b ${PASSWD_FILE} "${username}" "[password hidden]"`);
    console.error('[MQTT-AUTH] Error details:', error);
    throw new Error(`Failed to add MQTT credentials for ${username}: ${error.message}`);
  }
}

/**
 * Remove a device's MQTT credentials from Mosquitto passwd file
 */
export async function removeMqttDevice(username: string): Promise<void> {
  try {
    console.log('[MQTT-AUTH] Removing device from Mosquitto:', username);

    // Delete user from passwd file (-D flag)
    await execAsync(`${MOSQUITTO_PASSWD} -D ${PASSWD_FILE} "${username}"`);

    console.log('[MQTT-AUTH] ✓ Device credentials removed from Mosquitto');
  } catch (error: any) {
    console.error('[MQTT-AUTH] ✗ Failed to remove device credentials:', error.message);
    throw error;
  }
}

/**
 * Reload Mosquitto to pick up password file changes
 * Uses SIGHUP to reload config and password file without full restart
 * DEBOUNCED: Multiple rapid calls will be batched into a single reload
 */
export async function reloadMosquitto(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Clear existing timer
    if (reloadTimer) {
      clearTimeout(reloadTimer);
    }

    // Schedule reload after debounce period
    reloadTimer = setTimeout(async () => {
      try {
        console.log('[MQTT-AUTH] Reloading Mosquitto password file (debounced)...');

        // Send SIGHUP to mosquitto to reload password file
        // This is much faster and safer than full restart
        await execAsync('pkill -SIGHUP mosquitto');

        console.log('[MQTT-AUTH] ✓ Mosquitto password file reloaded');
        reloadTimer = null;
        resolve();
      } catch (error: any) {
        console.error('[MQTT-AUTH] ✗ Failed to reload Mosquitto:', error.message);
        reloadTimer = null;
        reject(error);
      }
    }, RELOAD_DEBOUNCE_MS);

    // Don't wait for the timer - resolve immediately
    // The reload will happen in the background
    console.log(`[MQTT-AUTH] Mosquitto reload scheduled (${RELOAD_DEBOUNCE_MS}ms debounce)`);
    resolve();
  });
}

/**
 * Add device and optionally reload Mosquitto
 * For efficiency, you might want to skip reload and let Mosquitto pick it up
 * on its own (passwd file is checked on each connection)
 */
export async function syncMqttDevice(
  username: string,
  password: string,
  reload: boolean = false
): Promise<void> {
  await addMqttDevice(username, password);

  if (reload) {
    await reloadMosquitto();
  }
}
