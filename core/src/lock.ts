/**
 * File locking for NAS access
 * Prevents multiple clients from syncing simultaneously
 */

import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { writeFile, mkdir, unlink, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export interface LockInfo {
  machineName: string;
  lockedAt: Date;
  operation: 'push' | 'pull' | 'restore' | 'gc';
}

export interface SyncLock {
  release: () => Promise<void>;
  info: LockInfo;
}

const LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes - consider lock stale after this

export class NasLock {
  private lockFilePath: string;
  private infoFilePath: string;

  constructor(nasPath: string) {
    this.lockFilePath = join(nasPath, 'sync.lock');
    this.infoFilePath = join(nasPath, 'sync.lock.info');
  }

  /**
   * Acquire a lock for sync operations
   * @throws Error if lock cannot be acquired
   */
  async acquire(
    machineName: string,
    operation: 'push' | 'pull' | 'restore' | 'gc'
  ): Promise<SyncLock> {
    // Ensure lock file exists
    if (!existsSync(this.lockFilePath)) {
      await mkdir(join(this.lockFilePath, '..'), { recursive: true });
      await writeFile(this.lockFilePath, '');
    }

    try {
      // Try to acquire the lock
      const release = await lockfile.lock(this.lockFilePath, {
        stale: LOCK_STALE_MS,
        retries: {
          retries: 3,
          minTimeout: 1000,
          maxTimeout: 3000,
        },
      });

      // Write lock info
      const info: LockInfo = {
        machineName,
        lockedAt: new Date(),
        operation,
      };
      await writeFile(this.infoFilePath, JSON.stringify(info, null, 2));

      return {
        release: async () => {
          try {
            await unlink(this.infoFilePath);
          } catch {
            // Ignore if info file doesn't exist
          }
          await release();
        },
        info,
      };
    } catch (error) {
      // Lock is held by someone else, try to get info
      const existingInfo = await this.getLockInfo();
      if (existingInfo) {
        throw new Error(
          `Sync in progress by ${existingInfo.machineName} ` +
            `(${existingInfo.operation} started at ${existingInfo.lockedAt.toLocaleTimeString()})`
        );
      }
      throw new Error('Unable to acquire sync lock. Another operation may be in progress.');
    }
  }

  /**
   * Check if lock is currently held
   */
  async isLocked(): Promise<boolean> {
    if (!existsSync(this.lockFilePath)) {
      return false;
    }

    try {
      const isLocked = await lockfile.check(this.lockFilePath, {
        stale: LOCK_STALE_MS,
      });
      return isLocked;
    } catch {
      return false;
    }
  }

  /**
   * Get information about the current lock holder
   */
  async getLockInfo(): Promise<LockInfo | null> {
    try {
      const content = await readFile(this.infoFilePath, 'utf8');
      const info = JSON.parse(content);
      return {
        ...info,
        lockedAt: new Date(info.lockedAt),
      };
    } catch {
      return null;
    }
  }

  /**
   * Force release a stale lock (use with caution)
   */
  async forceRelease(): Promise<void> {
    try {
      await lockfile.unlock(this.lockFilePath);
    } catch {
      // Lock wasn't held
    }
    try {
      await unlink(this.infoFilePath);
    } catch {
      // Info file doesn't exist
    }
  }
}

/**
 * Execute a function while holding the sync lock
 */
export async function withLock<T>(
  nasPath: string,
  machineName: string,
  operation: 'push' | 'pull' | 'restore' | 'gc',
  fn: () => Promise<T>
): Promise<T> {
  const lock = new NasLock(nasPath);
  const syncLock = await lock.acquire(machineName, operation);

  try {
    return await fn();
  } finally {
    await syncLock.release();
  }
}
