/**
 * Image Storage Service
 *
 * Persists motion-event JPEGs to disk for training data and diagnostics.
 * Images are organized by tenant + date to make rotation/export easy.
 *
 * Directory layout:
 *   {IMAGE_STORAGE_ROOT}/
 *     {tenant_id}/
 *       {YYYY-MM-DD}/
 *         {classification_id}.jpg
 *
 * Configure IMAGE_STORAGE_ROOT in .env (defaults to Server/image_storage/).
 */

import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.service';

const DEFAULT_ROOT = path.resolve(__dirname, '../../image_storage');
export const IMAGE_STORAGE_ROOT =
  process.env.IMAGE_STORAGE_ROOT || DEFAULT_ROOT;

let rootEnsured = false;

async function ensureRoot(): Promise<void> {
  if (rootEnsured) return;
  await fs.mkdir(IMAGE_STORAGE_ROOT, { recursive: true });
  rootEnsured = true;
  logger.info('Image storage root ensured', { root: IMAGE_STORAGE_ROOT });
}

function todayString(): string {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Decode a base64 JPEG (with or without data URL prefix) into a Buffer.
 */
export function decodeBase64Jpeg(imageData: string): Buffer {
  const commaIdx = imageData.indexOf(',');
  const raw = imageData.startsWith('data:') && commaIdx >= 0
    ? imageData.slice(commaIdx + 1)
    : imageData;
  return Buffer.from(raw, 'base64');
}

/**
 * Save a JPEG image to disk under the tenant/date tree.
 * Returns the relative path (from IMAGE_STORAGE_ROOT) suitable for storing
 * in image_classifications.image_path.
 */
export async function saveImage(
  tenantId: string,
  classificationId: string,
  jpegBytes: Buffer
): Promise<string> {
  await ensureRoot();

  const date = todayString();
  const dir = path.join(IMAGE_STORAGE_ROOT, tenantId, date);
  await fs.mkdir(dir, { recursive: true });

  const filename = `${classificationId}.jpg`;
  const fullPath = path.join(dir, filename);

  await fs.writeFile(fullPath, jpegBytes);

  return path.relative(IMAGE_STORAGE_ROOT, fullPath);
}

/**
 * Resolve a stored relative path to an absolute filesystem path.
 * Used by read/export code paths.
 */
export function resolveImagePath(relativePath: string): string {
  return path.join(IMAGE_STORAGE_ROOT, relativePath);
}

/**
 * Read a stored image from disk. Returns null if not found.
 */
export async function readImage(
  relativePath: string
): Promise<Buffer | null> {
  try {
    return await fs.readFile(resolveImagePath(relativePath));
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Delete a stored image. Silently ignores missing files.
 */
export async function deleteImage(relativePath: string): Promise<void> {
  try {
    await fs.unlink(resolveImagePath(relativePath));
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
}
