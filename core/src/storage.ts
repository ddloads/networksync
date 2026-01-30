/**
 * Content-addressable file storage on NAS
 * Files are stored by their hash, enabling automatic deduplication
 */

import { createReadStream, createWriteStream } from 'node:fs';
import {
  mkdir,
  stat,
  readdir,
  unlink,
  rename,
  rm,
  copyFile,
  open,
} from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { hashFile, hashBuffer } from './hasher';

export interface CopyProgress {
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
}

export type ProgressCallback = (progress: CopyProgress) => void;

export class ContentStorage {
  private objectsPath: string;
  private tempPath: string;

  constructor(nasPath: string) {
    this.objectsPath = join(nasPath, 'objects');
    this.tempPath = join(nasPath, 'temp');
  }

  async initialize(): Promise<void> {
    await mkdir(this.objectsPath, { recursive: true });
    await mkdir(this.tempPath, { recursive: true });
  }

  /**
   * Get the storage path for a given hash
   * Uses first 2 characters as subdirectory for better filesystem performance
   */
  private getObjectPath(hash: string): string {
    const prefix = hash.substring(0, 2);
    return join(this.objectsPath, prefix, hash);
  }

  /**
   * Check if an object exists in storage
   */
  async exists(hash: string): Promise<boolean> {
    try {
      await stat(this.getObjectPath(hash));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the size of an object
   */
  async getSize(hash: string): Promise<number | null> {
    try {
      const stats = await stat(this.getObjectPath(hash));
      return stats.size;
    } catch {
      return null;
    }
  }

  /**
   * Store a file from the local filesystem to NAS storage
   * Returns the hash of the stored file
   */
  async storeFile(
    sourcePath: string,
    onProgress?: ProgressCallback
  ): Promise<string> {
    const hash = await hashFile(sourcePath);

    // Check if already exists (deduplication)
    if (await this.exists(hash)) {
      return hash;
    }

    const objectPath = this.getObjectPath(hash);
    const tempFilePath = join(this.tempPath, `${hash}.${Date.now()}.tmp`);
    
    await mkdir(dirname(objectPath), { recursive: true });

    // Get file size for progress
    const sourceStats = await stat(sourcePath);
    const totalBytes = sourceStats.size;

    try {
      // Copy to temp file first for atomicity
      let bytesTransferred = 0;
      const readStream = createReadStream(sourcePath);
      const gzip = createGzip();
      const writeStream = createWriteStream(tempFilePath);

      if (onProgress) {
        readStream.on('data', (chunk) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytesTransferred += buf.length;
          onProgress({
            bytesTransferred,
            totalBytes,
            percentage: Math.round((bytesTransferred / totalBytes) * 100),
          });
        });
      }

      await pipeline(readStream, gzip, writeStream);

      // Atomically move to final destination
      await rename(tempFilePath, objectPath);
    } catch (error) {
      // Clean up temp file on failure
      try {
        await unlink(tempFilePath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }

    return hash;
  }

  /**
   * Store data from a buffer
   */
  async storeBuffer(data: Buffer): Promise<string> {
    const hash = hashBuffer(data);

    if (await this.exists(hash)) {
      return hash;
    }

    const objectPath = this.getObjectPath(hash);
    await mkdir(dirname(objectPath), { recursive: true });

    const { writeFile } = await import('node:fs/promises');
    await writeFile(objectPath, data);

    return hash;
  }

  /**
   * Retrieve a file from storage to a local path
   */
  async retrieveFile(
    hash: string,
    destPath: string,
    onProgress?: ProgressCallback
  ): Promise<boolean> {
    const objectPath = this.getObjectPath(hash);

    try {
      await mkdir(dirname(destPath), { recursive: true });

      const sourceStats = await stat(objectPath);
      const totalBytes = sourceStats.size;

      // Check for Gzip header
      let isGzipped = false;
      try {
        const handle = await open(objectPath, 'r');
        const buffer = Buffer.alloc(2);
        const { bytesRead } = await handle.read(buffer, 0, 2, 0);
        await handle.close();
        isGzipped = bytesRead === 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
      } catch {
        // Ignore error, treat as not gzipped or let subsequent read fail
      }

      if (isGzipped) {
        let bytesTransferred = 0;
        const readStream = createReadStream(objectPath);
        const gunzip = createGunzip();
        const writeStream = createWriteStream(destPath);

        if (onProgress) {
          readStream.on('data', (chunk) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytesTransferred += buf.length;
            onProgress({
              bytesTransferred,
              totalBytes,
              percentage: Math.round((bytesTransferred / totalBytes) * 100),
            });
          });
        }

        await pipeline(readStream, gunzip, writeStream);
      } else {
        if (onProgress) {
          // Copy with progress tracking
          let bytesTransferred = 0;
          const readStream = createReadStream(objectPath);
          const writeStream = createWriteStream(destPath);

          readStream.on('data', (chunk) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytesTransferred += buf.length;
            onProgress({
              bytesTransferred,
              totalBytes,
              percentage: Math.round((bytesTransferred / totalBytes) * 100),
            });
          });

          await pipeline(readStream, writeStream);
        } else {
          await copyFile(objectPath, destPath);
        }
      }

      // Verify integrity
      const downloadedHash = await hashFile(destPath);
      if (downloadedHash !== hash) {
        // Corrupted file, delete it
        await unlink(destPath);
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get a read stream for an object (for advanced use cases)
   */
  getReadStream(
    hash: string,
    options?: { start?: number; end?: number }
  ): NodeJS.ReadableStream {
    return createReadStream(this.getObjectPath(hash), options);
  }

  /**
   * Delete an object from storage
   */
  async delete(hash: string): Promise<boolean> {
    try {
      await unlink(this.getObjectPath(hash));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    objectCount: number;
    totalSize: number;
  }> {
    let objectCount = 0;
    let totalSize = 0;

    try {
      const prefixes = await readdir(this.objectsPath);

      for (const prefix of prefixes) {
        const prefixPath = join(this.objectsPath, prefix);
        const prefixStat = await stat(prefixPath);

        if (!prefixStat.isDirectory()) continue;

        const files = await readdir(prefixPath);
        for (const file of files) {
          const filePath = join(prefixPath, file);
          const fileStat = await stat(filePath);
          if (fileStat.isFile()) {
            objectCount++;
            totalSize += fileStat.size;
          }
        }
      }
    } catch {
      // Directory doesn't exist yet
    }

    return { objectCount, totalSize };
  }

  /**
   * Clean up temporary files
   */
  async cleanupTemp(): Promise<void> {
    try {
      await rm(this.tempPath, { recursive: true, force: true });
      await mkdir(this.tempPath, { recursive: true });
    } catch {
      // Ignore errors
    }
  }

  /**
   * Prune objects that are not in the active set
   * Returns stats about deleted objects
   */
  async prune(activeHashes: Set<string>): Promise<{ deletedCount: number; deletedSize: number }> {
    let deletedCount = 0;
    let deletedSize = 0;

    try {
      const prefixes = await readdir(this.objectsPath);

      for (const prefix of prefixes) {
        const prefixPath = join(this.objectsPath, prefix);
        const prefixStat = await stat(prefixPath);

        if (!prefixStat.isDirectory()) continue;

        const files = await readdir(prefixPath);
        for (const file of files) {
          if (!activeHashes.has(file)) {
            const filePath = join(prefixPath, file);
            try {
              const fileStat = await stat(filePath);
              await unlink(filePath);
              deletedCount++;
              deletedSize += fileStat.size;
            } catch {
              // Ignore errors deleting individual files
            }
          }
        }

        // Try to remove empty prefix directories
        try {
          const remaining = await readdir(prefixPath);
          if (remaining.length === 0) {
            await rm(prefixPath, { recursive: true });
          }
        } catch {
          // Ignore
        }
      }
    } catch {
      // Directory doesn't exist yet
    }

    return { deletedCount, deletedSize };
  }

  /**
   * Get list of all stored hashes
   */
  async getAllHashes(): Promise<string[]> {
    const hashes: string[] = [];

    try {
      const prefixes = await readdir(this.objectsPath);

      for (const prefix of prefixes) {
        const prefixPath = join(this.objectsPath, prefix);
        const prefixStat = await stat(prefixPath);

        if (!prefixStat.isDirectory()) continue;

        const files = await readdir(prefixPath);
        hashes.push(...files);
      }
    } catch {
      // Directory doesn't exist yet
    }

    return hashes;
  }
}
