/**
 * File hashing utilities using xxHash for speed
 * xxHash is much faster than SHA-256 for large files while still
 * providing excellent collision resistance for our use case
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ChunkInfo } from './types';

const CHUNK_SIZE = 1024 * 1024; // 1MB chunks

/**
 * Compute SHA-256 hash of a file
 * Used for content-addressable storage
 */
export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Compute hash of a buffer
 */
export function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Compute hash of a string
 */
export function hashString(str: string): string {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * Compute chunk information for a file
 * Used for resumable transfers
 */
export async function computeFileChunks(
  filePath: string,
  chunkSize: number = CHUNK_SIZE
): Promise<ChunkInfo[]> {
  const fileStats = await stat(filePath);
  const totalSize = fileStats.size;
  const chunks: ChunkInfo[] = [];

  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { highWaterMark: chunkSize });
    let index = 0;
    let offset = 0;

    stream.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const hash = hashBuffer(buf);
      chunks.push({
        index,
        offset,
        size: buf.length,
        hash,
      });
      offset += buf.length;
      index++;
    });

    stream.on('end', () => resolve(chunks));
    stream.on('error', reject);
  });
}

/**
 * Compute a manifest hash from file entries
 * This creates a deterministic hash of the entire project state
 */
export function computeManifestHash(
  entries: Array<{ path: string; hash: string }>
): string {
  // Sort entries by path for deterministic ordering
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));

  // Create a hash of all file paths and their hashes
  const combined = sorted.map((e) => `${e.path}:${e.hash}`).join('\n');
  return hashString(combined);
}
