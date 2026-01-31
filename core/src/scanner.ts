/**
 * File system scanner for building project manifests
 */

import { readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { hashFile } from './hasher';
import {
  createProjectIgnoreMatcher,
  isUnrealEngineProject,
  type IgnoreMatcher,
} from './ignore';
import type { FileEntry, FileManifest } from './types';
import { computeManifestHash } from './hasher';

export interface ScanOptions {
  /** Custom ignore matcher (if not provided, will create one) */
  ignoreMatcher?: IgnoreMatcher;
  /** Progress callback */
  onProgress?: (scanned: number, filePath: string) => void;
  /** Whether to compute file hashes (can be slow for large projects) */
  computeHashes?: boolean;
  /** Maximum concurrent hash operations */
  concurrency?: number;
  /** Path to cache file for incremental scanning */
  cachePath?: string;
}

export interface ScanResult {
  entries: FileEntry[];
  totalSize: number;
  fileCount: number;
  directoryCount: number;
  scannedAt: Date;
}

interface HashCacheEntry {
  mtime: number; // timestamp
  size: number;
  hash: string;
}

interface HashCache {
  [filePath: string]: HashCacheEntry;
}

async function loadCache(path: string): Promise<HashCache> {
  try {
    if (existsSync(path)) {
      const data = await readFile(path, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    // Ignore cache load errors
  }
  return {};
}

async function saveCache(path: string, cache: HashCache): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(cache, null, 2));
  } catch (error) {
    // Ignore cache save errors
  }
}

// Helper to create directory if it doesn't exist
async function mkdir(path: string, options?: { recursive?: boolean }) {
  const { mkdir } = await import('node:fs/promises');
  return mkdir(path, options);
}

/**
 * Scan a directory recursively and build a list of file entries
 */
export async function scanDirectory(
  rootPath: string,
  options: ScanOptions = {}
): Promise<ScanResult> {
  const {
    onProgress,
    computeHashes = true,
    concurrency = 10,
    cachePath,
  } = options;

  // Load cache if provided
  let cache: HashCache = {};
  if (cachePath) {
    cache = await loadCache(cachePath);
  }

  // Create ignore matcher if not provided
  let ignoreMatcher = options.ignoreMatcher;
  if (!ignoreMatcher) {
    const isUnreal = await isUnrealEngineProject(rootPath);
    ignoreMatcher = await createProjectIgnoreMatcher(rootPath, isUnreal);
  }

  const entries: FileEntry[] = [];
  let totalSize = 0;
  let fileCount = 0;
  let directoryCount = 0;
  let scanned = 0;

  // Collect all file paths first
  const filesToProcess: Array<{ fullPath: string; relativePath: string }> = [];

  async function walk(currentPath: string): Promise<void> {
    const items = await readdir(currentPath, { withFileTypes: true });

    for (const item of items) {
      const fullPath = join(currentPath, item.name);
      const relativePath = relative(rootPath, fullPath).replace(/\\/g, '/');

      // Check if ignored
      if (ignoreMatcher!.ignores(relativePath)) {
        continue;
      }

      if (item.isDirectory()) {
        directoryCount++;
        // Recurse into directory
        await walk(fullPath);
      } else if (item.isFile()) {
        filesToProcess.push({ fullPath, relativePath });
      }
    }
  }

  // Walk the directory tree
  await walk(rootPath);

  // New cache to be saved (filters out stale entries implicitly)
  const newCache: HashCache = {};

  // Process files with controlled concurrency
  const processFile = async (file: {
    fullPath: string;
    relativePath: string;
  }): Promise<FileEntry> => {
    const fileStats = await stat(file.fullPath);
    let hash = '';

    if (computeHashes) {
      // Check cache
      const cached = cache[file.relativePath];
      if (
        cached &&
        cached.mtime === fileStats.mtime.getTime() &&
        cached.size === fileStats.size
      ) {
        hash = cached.hash;
      } else {
        hash = await hashFile(file.fullPath);
      }

      // Update new cache
      newCache[file.relativePath] = {
        mtime: fileStats.mtime.getTime(),
        size: fileStats.size,
        hash,
      };
    }

    scanned++;
    onProgress?.(scanned, file.relativePath);

    return {
      path: file.relativePath,
      hash,
      size: fileStats.size,
      modifiedAt: fileStats.mtime,
      isDirectory: false,
    };
  };

  // Process files with controlled concurrency using a pool
  // This avoids "lock-step" batching where one slow file blocks the batch
  const limit = pLimit(concurrency);
  const promises = filesToProcess.map((file) =>
    limit(async () => {
      const entry = await processFile(file);
      return entry;
    })
  );

  const results = await Promise.all(promises);

  for (const entry of results) {
    entries.push(entry);
    totalSize += entry.size;
    fileCount++;
  }

  // Save cache if path provided and hashes were computed
  if (cachePath && computeHashes) {
    await saveCache(cachePath, newCache);
  }

  return {
    entries,
    totalSize,
    fileCount,
    directoryCount,
    scannedAt: new Date(),
  };
}

/**
 * Simple concurrency limiter to avoid EMFILE errors and manage load
 */
function pLimit(concurrency: number) {
  const queue: (() => void)[] = [];
  let active = 0;

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        active++;
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        } finally {
          active--;
          if (queue.length > 0) {
            queue.shift()!();
          }
        }
      };

      if (active < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

/**
 * Build a complete manifest from a scan result
 */
export function buildManifest(
  projectId: string,
  scanResult: ScanResult
): FileManifest {
  const rootHash = computeManifestHash(
    scanResult.entries.map((e) => ({ path: e.path, hash: e.hash }))
  );

  return {
    projectId,
    createdAt: scanResult.scannedAt,
    rootHash,
    entries: scanResult.entries,
  };
}

/**
 * Compare two manifests and compute the differences
 */
export function compareManifests(
  local: FileManifest,
  remote: FileManifest
): {
  added: FileEntry[];
  modified: FileEntry[];
  deleted: string[];
  unchanged: FileEntry[];
} {
  const localMap = new Map(local.entries.map((e) => [e.path, e]));
  const remoteMap = new Map(remote.entries.map((e) => [e.path, e]));

  const added: FileEntry[] = [];
  const modified: FileEntry[] = [];
  const deleted: string[] = [];
  const unchanged: FileEntry[] = [];

  // Find added and modified files (in local but different or missing in remote)
  for (const [path, localEntry] of localMap) {
    const remoteEntry = remoteMap.get(path);

    if (!remoteEntry) {
      added.push(localEntry);
    } else if (localEntry.hash !== remoteEntry.hash) {
      modified.push(localEntry);
    } else {
      unchanged.push(localEntry);
    }
  }

  // Find deleted files (in remote but not in local)
  for (const path of remoteMap.keys()) {
    if (!localMap.has(path)) {
      deleted.push(path);
    }
  }

  return { added, modified, deleted, unchanged };
}

/**
 * Format file size for display
 */
export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
