import { exec } from 'child_process';
import { promisify } from 'util';
import mqtt, { MqttClient } from 'mqtt';

const execAsync = promisify(exec);

// Configuration - set via environment variables
const AUTH_MODE = process.env.MQTT_AUTH_MODE || 'password_file'; // 'password_file' or 'dynamic_security'

// Password file mode settings (Homebrew installation)
const PASSWD_FILE = process.env.MQTT_PASSWD_FILE || '/opt/homebrew/etc/mosquitto/passwd';
const MOSQUITTO_PASSWD = process.env.MQTT_MOSQUITTO_PASSWD || '/opt/homebrew/bin/mosquitto_passwd';

// Dynamic Security mode settings (Docker installation)
const DYNSEC_BROKER_URL = process.env.MQTT_DYNSEC_BROKER_URL || 'mqtt://localhost:1883';
const DYNSEC_ADMIN_USER = process.env.MQTT_DYNSEC_ADMIN_USER || 'server_admin';
const DYNSEC_ADMIN_PASS = process.env.MQTT_DYNSEC_ADMIN_PASS || 'mqtt_admin_password';
const DYNSEC_DEFAULT_ROLE = process.env.MQTT_DYNSEC_DEFAULT_ROLE || 'device';

// Debounce mosquitto reload to handle concurrent claims (password file mode only)
let reloadTimer: NodeJS.Timeout | null = null;
const RELOAD_DEBOUNCE_MS = 2000; // Wait 2 seconds after last password update

// Dynamic Security MQTT client (singleton)
let dynsecClient: MqttClient | null = null;
let dynsecConnecting = false;
let dynsecConnected = false;
let pendingCommands: Map<string, { resolve: (response: any) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }> = new Map();

/**
 * Get the current authentication mode
 */
export function getAuthMode(): string {
  return AUTH_MODE;
}

/**
 * Connect to the Dynamic Security MQTT client
 */
async function connectDynsecClient(): Promise<MqttClient> {
  if (dynsecClient?.connected) {
    return dynsecClient;
  }

  if (dynsecConnecting) {
    // Wait for existing connection attempt
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (dynsecConnected && dynsecClient) {
          clearInterval(checkInterval);
          resolve(dynsecClient);
        }
      }, 100);
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Timeout waiting for Dynamic Security connection'));
      }, 10000);
    });
  }

  dynsecConnecting = true;

  return new Promise((resolve, reject) => {
    console.log('[MQTT-AUTH] Connecting to Dynamic Security broker...');

    dynsecClient = mqtt.connect(DYNSEC_BROKER_URL, {
      clientId: `dynsec_admin_${Date.now()}`,
      username: DYNSEC_ADMIN_USER,
      password: DYNSEC_ADMIN_PASS,
      clean: true,
      connectTimeout: 10000,
    });

    dynsecClient.on('connect', () => {
      console.log('[MQTT-AUTH] Connected to Dynamic Security broker');
      dynsecConnected = true;
      dynsecConnecting = false;

      // Subscribe to response topic and wait for SUBACK before resolving
      dynsecClient!.subscribe('$CONTROL/dynamic-security/v1/response', { qos: 0 }, (err) => {
        if (err) {
          console.error('[MQTT-AUTH] Failed to subscribe to dynsec response topic:', err);
          reject(err);
        } else {
          console.log('[MQTT-AUTH] Subscribed to dynsec response topic');
          resolve(dynsecClient!);
        }
      });
    });

    dynsecClient.on('error', (err) => {
      console.error('[MQTT-AUTH] Dynamic Security client error:', err);
      dynsecConnecting = false;
      reject(err);
    });

    dynsecClient.on('message', (topic, message) => {
      console.log(`[MQTT-AUTH] Received message on topic: ${topic}`);
      if (topic === '$CONTROL/dynamic-security/v1/response') {
        try {
          const response = JSON.parse(message.toString());
          console.log('[MQTT-AUTH] Dynamic Security response:', JSON.stringify(response));
          let correlationData = response.correlationData;

          // Mosquitto doesn't include correlationData on error responses
          // If we have exactly one pending command, use that one
          if (!correlationData && pendingCommands.size === 1) {
            correlationData = pendingCommands.keys().next().value;
            console.log(`[MQTT-AUTH] No correlationData in response, using pending: ${correlationData}`);
          }

          if (correlationData && pendingCommands.has(correlationData)) {
            const pending = pendingCommands.get(correlationData)!;
            clearTimeout(pending.timeout);
            pendingCommands.delete(correlationData);

            if (response.responses && response.responses.length > 0) {
              const result = response.responses[0];
              if (result.error) {
                console.log('[MQTT-AUTH] Dynamic Security command error:', result.error);
                pending.reject(new Error(result.error));
              } else {
                console.log('[MQTT-AUTH] Dynamic Security command success');
                pending.resolve(result);
              }
            } else {
              pending.resolve(response);
            }
          } else {
            console.log(`[MQTT-AUTH] No pending command for correlationData: ${correlationData}`);
          }
        } catch (err) {
          console.error('[MQTT-AUTH] Failed to parse dynsec response:', err);
        }
      }
    });

    dynsecClient.on('close', () => {
      console.log('[MQTT-AUTH] Dynamic Security connection closed');
      dynsecConnected = false;
    });
  });
}

/**
 * Send a Dynamic Security command and wait for response
 */
async function sendDynsecCommand(command: any): Promise<any> {
  const client = await connectDynsecClient();

  const correlationData = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const payload = {
    commands: [command],
    correlationData,
  };

  console.log('[MQTT-AUTH] Sending dynsec command:', JSON.stringify(payload));

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log(`[MQTT-AUTH] Command timeout, pending commands: ${Array.from(pendingCommands.keys()).join(', ')}`);
      pendingCommands.delete(correlationData);
      reject(new Error('Dynamic Security command timeout'));
    }, 10000);

    pendingCommands.set(correlationData, { resolve, reject, timeout });
    console.log(`[MQTT-AUTH] Registered pending command: ${correlationData}`);

    client.publish('$CONTROL/dynamic-security/v1', JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) {
        clearTimeout(timeout);
        pendingCommands.delete(correlationData);
        reject(err);
      } else {
        console.log('[MQTT-AUTH] Command published successfully');
      }
    });
  });
}

/**
 * Add a single device's MQTT credentials
 * Automatically uses the configured authentication mode
 */
export async function addMqttDevice(username: string, password: string): Promise<void> {
  if (AUTH_MODE === 'dynamic_security') {
    await addMqttDeviceDynsec(username, password);
  } else {
    await addMqttDevicePasswdFile(username, password);
  }
}

/**
 * Add device using Dynamic Security API
 */
async function addMqttDeviceDynsec(username: string, password: string): Promise<void> {
  try {
    console.log('[MQTT-AUTH] Adding device via Dynamic Security:', username);

    if (!username || !password) {
      throw new Error('Username and password are required');
    }

    // First, try to delete existing client (in case of credential rotation)
    try {
      await sendDynsecCommand({
        command: 'deleteClient',
        username: username,
      });
      console.log('[MQTT-AUTH] Removed existing client:', username);
    } catch {
      // Ignore - client might not exist
    }

    // Create new client with the device role
    await sendDynsecCommand({
      command: 'createClient',
      username: username,
      password: password,
      roles: [{ rolename: DYNSEC_DEFAULT_ROLE }],
    });

    console.log('[MQTT-AUTH] ✓ Device credentials added via Dynamic Security');
  } catch (error: any) {
    console.error('[MQTT-AUTH] ✗ Failed to add device via Dynamic Security:', error.message);
    throw new Error(`Failed to add MQTT credentials for ${username}: ${error.message}`);
  }
}

/**
 * Add device using password file (original implementation)
 */
async function addMqttDevicePasswdFile(username: string, password: string): Promise<void> {
  try {
    console.log('[MQTT-AUTH] Adding device to Mosquitto passwd file:', username);

    if (!username || !password) {
      throw new Error('Username and password are required');
    }

    // Add user to passwd file (mosquitto_passwd will hash it properly)
    const { stderr } = await execAsync(
      `${MOSQUITTO_PASSWD} -b ${PASSWD_FILE} "${username}" "${password}"`
    );

    if (stderr && !stderr.includes('Warning')) {
      console.warn('[MQTT-AUTH] mosquitto_passwd stderr:', stderr);
    }

    console.log('[MQTT-AUTH] ✓ Device credentials added to Mosquitto passwd file');
  } catch (error: any) {
    console.error('[MQTT-AUTH] ✗ Failed to add device credentials:', error.message);
    console.error('[MQTT-AUTH] Command:', `${MOSQUITTO_PASSWD} -b ${PASSWD_FILE} "${username}" "[password hidden]"`);
    throw new Error(`Failed to add MQTT credentials for ${username}: ${error.message}`);
  }
}

/**
 * Remove a device's MQTT credentials
 * Automatically uses the configured authentication mode
 */
export async function removeMqttDevice(username: string): Promise<void> {
  if (AUTH_MODE === 'dynamic_security') {
    await removeMqttDeviceDynsec(username);
  } else {
    await removeMqttDevicePasswdFile(username);
  }
}

/**
 * Remove device using Dynamic Security API
 */
async function removeMqttDeviceDynsec(username: string): Promise<void> {
  try {
    console.log('[MQTT-AUTH] Removing device via Dynamic Security:', username);

    await sendDynsecCommand({
      command: 'deleteClient',
      username: username,
    });

    console.log('[MQTT-AUTH] ✓ Device credentials removed via Dynamic Security');
  } catch (error: any) {
    console.error('[MQTT-AUTH] ✗ Failed to remove device via Dynamic Security:', error.message);
    throw error;
  }
}

/**
 * Remove device using password file
 */
async function removeMqttDevicePasswdFile(username: string): Promise<void> {
  try {
    console.log('[MQTT-AUTH] Removing device from Mosquitto passwd file:', username);

    // Delete user from passwd file (-D flag)
    await execAsync(`${MOSQUITTO_PASSWD} -D ${PASSWD_FILE} "${username}"`);

    console.log('[MQTT-AUTH] ✓ Device credentials removed from Mosquitto passwd file');
  } catch (error: any) {
    console.error('[MQTT-AUTH] ✗ Failed to remove device credentials:', error.message);
    throw error;
  }
}

/**
 * Update a device's MQTT password (for credential rotation)
 * More efficient than delete+add for Dynamic Security mode
 */
export async function updateMqttDevicePassword(username: string, newPassword: string): Promise<void> {
  if (AUTH_MODE === 'dynamic_security') {
    try {
      console.log('[MQTT-AUTH] Updating device password via Dynamic Security:', username);

      await sendDynsecCommand({
        command: 'setClientPassword',
        username: username,
        password: newPassword,
      });

      console.log('[MQTT-AUTH] ✓ Device password updated via Dynamic Security');
    } catch (error: any) {
      // If client doesn't exist, create it
      if (error.message.includes('not found') || error.message.includes('Client not found')) {
        console.log('[MQTT-AUTH] Client not found, creating new client');
        await addMqttDeviceDynsec(username, newPassword);
      } else {
        throw error;
      }
    }
  } else {
    // For password file mode, just use addMqttDevice (overwrites existing)
    await addMqttDevicePasswdFile(username, newPassword);
  }
}

/**
 * Reload Mosquitto to pick up password file changes
 * For Dynamic Security mode, this is a no-op (changes are immediate)
 */
export async function reloadMosquitto(): Promise<void> {
  if (AUTH_MODE === 'dynamic_security') {
    // Dynamic Security changes are immediate - no reload needed
    console.log('[MQTT-AUTH] Dynamic Security mode - no reload needed');
    return;
  }

  // Password file mode - debounced reload
  return new Promise((resolve) => {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
    }

    reloadTimer = setTimeout(async () => {
      try {
        console.log('[MQTT-AUTH] Reloading Mosquitto password file (debounced)...');

        // Send SIGHUP to mosquitto to reload password file
        await execAsync('pkill -SIGHUP mosquitto');

        console.log('[MQTT-AUTH] ✓ Mosquitto password file reloaded');
        reloadTimer = null;
      } catch (error: any) {
        console.error('[MQTT-AUTH] ✗ Failed to reload Mosquitto:', error.message);
        reloadTimer = null;
      }
    }, RELOAD_DEBOUNCE_MS);

    console.log(`[MQTT-AUTH] Mosquitto reload scheduled (${RELOAD_DEBOUNCE_MS}ms debounce)`);
    resolve();
  });
}

/**
 * Add device and optionally reload Mosquitto
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

/**
 * Check if a client exists (Dynamic Security mode only)
 */
export async function clientExists(username: string): Promise<boolean> {
  if (AUTH_MODE !== 'dynamic_security') {
    // For password file mode, we'd need to parse the file
    // For now, just return true to avoid breaking anything
    console.warn('[MQTT-AUTH] clientExists not fully supported in password_file mode');
    return true;
  }

  try {
    await sendDynsecCommand({
      command: 'getClient',
      username: username,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * List all clients (Dynamic Security mode only)
 */
export async function listClients(): Promise<string[]> {
  if (AUTH_MODE !== 'dynamic_security') {
    console.warn('[MQTT-AUTH] listClients only supported in dynamic_security mode');
    return [];
  }

  try {
    const response = await sendDynsecCommand({
      command: 'listClients',
    });
    return response.data?.clients || [];
  } catch (error: any) {
    console.error('[MQTT-AUTH] Failed to list clients:', error.message);
    return [];
  }
}

/**
 * Disconnect the Dynamic Security client (cleanup)
 */
export async function disconnectDynsecClient(): Promise<void> {
  if (dynsecClient) {
    dynsecClient.end();
    dynsecClient = null;
    dynsecConnected = false;
  }
}

/**
 * Add device credentials to Dynamic Security for migration purposes.
 * This function works regardless of AUTH_MODE setting - used to pre-populate
 * Dynamic Security before switching from password_file mode.
 */
export async function addToDynsecForMigration(username: string, password: string): Promise<void> {
  console.log('[MQTT-AUTH] Adding to Dynamic Security for migration:', username);

  try {
    // First try to delete existing client
    try {
      await sendDynsecCommand({
        command: 'deleteClient',
        username: username,
      });
      console.log('[MQTT-AUTH] Removed existing client from Dynamic Security:', username);
    } catch {
      // Ignore - client might not exist
    }

    // Create new client with the device role
    await sendDynsecCommand({
      command: 'createClient',
      username: username,
      password: password,
      roles: [{ rolename: DYNSEC_DEFAULT_ROLE }],
    });

    console.log('[MQTT-AUTH] ✓ Credentials added to Dynamic Security for migration');
  } catch (error: any) {
    console.error('[MQTT-AUTH] ✗ Failed to add to Dynamic Security:', error.message);
    throw new Error(`Failed to add to Dynamic Security for ${username}: ${error.message}`);
  }
}
