import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export interface FirmwareFile {
  tenantId: string;
  version: string;
  type: 'firmware' | 'filesystem';
  filename: string;
  buffer: Buffer;
}

export interface FirmwareMetadata {
  path: string;
  url: string;
  size: number;
  sha256: string;
}

export class FirmwareStorageService {
  private basePath: string;
  private baseUrl: string;

  constructor(storagePath: string, baseUrl: string) {
    this.basePath = storagePath;
    this.baseUrl = baseUrl;
  }

  /**
   * Save firmware file to disk and return metadata
   */
  async saveFirmware(file: FirmwareFile): Promise<FirmwareMetadata> {
    // Create directory structure: {basePath}/{tenantId}/{type}/{version}/
    const dir = path.join(
      this.basePath,
      file.tenantId,
      file.type,
      file.version
    );

    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    // Full file path
    const filePath = path.join(dir, file.filename);

    // Write file to disk
    await fs.writeFile(filePath, file.buffer);

    // Calculate SHA256 hash
    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // Generate download URL
    const url = `${this.baseUrl}/api/firmware-files/${file.tenantId}/${file.type}/${file.version}/${file.filename}`;

    return {
      path: filePath,
      url,
      size: file.buffer.length,
      sha256,
    };
  }

  /**
   * Delete firmware version directory from disk
   */
  async deleteFirmware(tenantId: string, type: string, version: string): Promise<void> {
    const versionDir = path.join(
      this.basePath,
      tenantId,
      type,
      version
    );

    try {
      // Delete entire version directory
      await fs.rm(versionDir, { recursive: true, force: true });
      console.log(`[FIRMWARE-STORAGE] Deleted firmware directory: ${versionDir}`);

      // Try to remove empty parent directories
      const typeDir = path.dirname(versionDir);
      const tenantDir = path.dirname(typeDir);

      try {
        await fs.rmdir(typeDir);
        await fs.rmdir(tenantDir);
      } catch {
        // Ignore errors - directories may not be empty
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // Directory doesn't exist - that's okay
    }
  }

  /**
   * Check if firmware file exists
   */
  async fileExists(tenantId: string, type: string, version: string, filename: string): Promise<boolean> {
    const filePath = path.join(
      this.basePath,
      tenantId,
      type,
      version,
      filename
    );

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file size
   */
  async getFileSize(tenantId: string, type: string, version: string, filename: string): Promise<number> {
    const filePath = path.join(
      this.basePath,
      tenantId,
      type,
      version,
      filename
    );

    const stats = await fs.stat(filePath);
    return stats.size;
  }

  /**
   * Read firmware file from disk
   */
  async readFirmware(tenantId: string, type: string, version: string): Promise<Buffer> {
    const versionDir = path.join(
      this.basePath,
      tenantId,
      type,
      version
    );

    // Read directory to find the firmware file
    const files = await fs.readdir(versionDir);
    if (files.length === 0) {
      throw new Error('No firmware file found in version directory');
    }

    // Use the first .bin file found
    const binFile = files.find(f => f.endsWith('.bin')) || files[0];
    const filePath = path.join(versionDir, binFile);

    return await fs.readFile(filePath);
  }

  /**
   * Generate download URL for firmware file
   */
  getDownloadUrl(tenantId: string, type: string, version: string, filename: string): string {
    return `${this.baseUrl}/api/firmware-files/${tenantId}/${type}/${version}/${filename}`;
  }
}

/**
 * Factory function to create firmware storage service
 */
export function createFirmwareStorageService(): FirmwareStorageService {
  const storagePath = process.env.FIRMWARE_STORAGE_PATH || path.join(__dirname, '../../firmware');
  const baseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

  return new FirmwareStorageService(storagePath, baseUrl);
}
