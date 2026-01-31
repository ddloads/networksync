/**
 * File hashing utilities using xxHash for speed
 * xxHash is much faster than SHA-256 for large files while still
 * providing excellent collision resistance for our use case
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import xxhash from 'xxhash-wasm';
import type { ChunkInfo } from './types';

const CHUNK_SIZE = 1024 * 1024; // 1MB chunks

// Singleton instance for xxhash
let hasherInstance: Awaited<ReturnType<typeof xxhash>> | null = null;

async function getHasher() {
  if (!hasherInstance) {
    hasherInstance = await xxhash();
  }
  return hasherInstance;
}

/**
 * Compute xxHash-64 hash of a file
 * Optimized for speed using WebAssembly
 */
export async function hashFile(filePath: string): Promise<string> {
  const { create64 } = await getHasher();
  const hash = create64();

  return new Promise((resolve, reject) => {
    // Use a larger buffer for file reading to reduce IO overhead
    const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest().toString(16).padStart(16, '0')));
    stream.on('error', reject);
  });
}

/**
 * Compute hash of a buffer (SHA-256)
 * Kept as SHA-256 for synchronous compatibility where needed
 */
export function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Compute hash of a string (SHA-256)
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
  const { create64 } = await getHasher();

  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { highWaterMark: chunkSize });
    let index = 0;
    let offset = 0;

    stream.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      // Use xxHash for chunks as well for consistency and speed
      const hasher = create64();
      hasher.update(buf);
      const hash = hasher.digest().toString(16).padStart(16, '0');
      
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
