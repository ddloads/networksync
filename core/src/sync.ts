/**
 * Sync operations - push and pull logic
 */

import { v4 as uuid } from 'uuid';
import { join } from 'node:path';
import { unlink, mkdir } from 'node:fs/promises';
import { NetworkSyncDb } from './db';
import { ContentStorage, type ProgressCallback } from './storage';
import { NasLock } from './lock';
import {
  scanDirectory,
  compareManifests,
  buildManifest,
  formatSize,
} from './scanner';
import { computeManifestHash } from './hasher';
import type {
  Project,
  Snapshot,
  FileEntry,
  FileManifest,
  Conflict,
  FileLock,
} from './types';

export interface SyncProgress {
  phase: 'scanning' | 'comparing' | 'transferring' | 'finalizing';
  currentFile?: string;
  filesProcessed: number;
  totalFiles: number;
  bytesTransferred: number;
  totalBytes: number;
}

export type SyncProgressCallback = (progress: SyncProgress) => void;

export interface PushResult {
  success: boolean;
  snapshot?: Snapshot;
  filesAdded: number;
  filesModified: number;
  filesDeleted: number;
  bytesTransferred: number;
  error?: string;
}

export interface PullResult {
  success: boolean;
  filesDownloaded: number;
  filesDeleted: number;
  bytesTransferred: number;
  conflicts: Conflict[];
  error?: string;
}

export interface ConflictResolution {
  path: string;
  resolution: 'keep_local' | 'keep_remote' | 'keep_both';
}

export class SyncEngine {
  private db: NetworkSyncDb;
  private storage: ContentStorage;
  private lock: NasLock;
  private nasPath: string;

  constructor(nasPath: string) {
    this.nasPath = nasPath;
    this.db = new NetworkSyncDb(nasPath);
    this.storage = new ContentStorage(nasPath);
    this.lock = new NasLock(nasPath);
  }

  async initialize(): Promise<void> {
    await this.db.initialize();
    await this.storage.initialize();
  }

  /**
   * Push local changes to NAS
   */
  async push(
    project: Project,
    localPath: string,
    machineName: string,
    message: string = 'Sync',
    branch: string = 'main',
    onProgress?: SyncProgressCallback
  ): Promise<PushResult> {
    const syncLock = await this.lock.acquire(machineName, 'push');

    try {
      // Phase 1: Scan local directory
      onProgress?.({
        phase: 'scanning',
        filesProcessed: 0,
        totalFiles: 0,
        bytesTransferred: 0,
        totalBytes: 0,
      });

      const cachePath = join(localPath, '.sync', 'cache.json');
      const scanResult = await scanDirectory(localPath, {
        cachePath,
        onProgress: (scanned, filePath) => {
          onProgress?.({
            phase: 'scanning',
            currentFile: filePath,
            filesProcessed: scanned,
            totalFiles: scanned,
            bytesTransferred: 0,
            totalBytes: 0,
          });
        },
      });

      const localManifest = buildManifest(project.id, scanResult);

      // Phase 2: Compare with remote manifest
      onProgress?.({
        phase: 'comparing',
        filesProcessed: 0,
        totalFiles: scanResult.fileCount,
        bytesTransferred: 0,
        totalBytes: scanResult.totalSize,
      });

      const latestSnapshot = this.db.getLatestSnapshot(project.id, branch);
      let remoteEntries: FileEntry[] = [];
      if (latestSnapshot) {
        remoteEntries = this.db.getSnapshotEntries(latestSnapshot.id);
      }

      const remoteManifest: FileManifest = {
        projectId: project.id,
        createdAt: latestSnapshot?.createdAt ?? new Date(),
        rootHash: latestSnapshot?.manifestHash ?? '',
        entries: remoteEntries,
      };

      const diff = compareManifests(localManifest, remoteManifest);

      // Phase 3: Transfer files
      const filesToTransfer = [...diff.added, ...diff.modified];
      let bytesTransferred = 0;
      const totalBytes = filesToTransfer.reduce((sum, f) => sum + f.size, 0);
      const concurrency = 20;

      for (let i = 0; i < filesToTransfer.length; i += concurrency) {
        const batch = filesToTransfer.slice(i, i + concurrency);
        
        await Promise.all(batch.map(async (file, batchIndex) => {
          const localFilePath = join(localPath, file.path);
          const globalIndex = i + batchIndex;

          onProgress?.({
            phase: 'transferring',
            currentFile: file.path,
            filesProcessed: globalIndex,
            totalFiles: filesToTransfer.length,
            bytesTransferred,
            totalBytes,
          });

          // Check if file already exists in storage (deduplication)
          const exists = await this.storage.exists(file.hash);
          if (!exists) {
            await this.storage.storeFile(localFilePath, (progress) => {
              // Note: granular progress updates from parallel transfers 
              // might be too noisy/inaccurate for the total calculation
              // so we might want to simplify or just update on completion
            });
          }

          bytesTransferred += file.size;
        }));
      }

      // Phase 4: Create snapshot
      onProgress?.({
        phase: 'finalizing',
        filesProcessed: filesToTransfer.length,
        totalFiles: filesToTransfer.length,
        bytesTransferred,
        totalBytes,
      });

      const manifestHash = computeManifestHash(
        localManifest.entries.map((e) => ({ path: e.path, hash: e.hash }))
      );

      const snapshot: Snapshot = {
        id: uuid(),
        projectId: project.id,
        message,
        createdAt: new Date(),
        createdBy: machineName,
        manifestHash,
        fileCount: localManifest.entries.length,
        totalSize: scanResult.totalSize,
        branch,
      };

      this.db.createSnapshot(snapshot, localManifest.entries);
      this.db.updateProject(project.id, { lastSyncAt: new Date() });

      return {
        success: true,
        snapshot,
        filesAdded: diff.added.length,
        filesModified: diff.modified.length,
        filesDeleted: diff.deleted.length,
        bytesTransferred,
      };
    } catch (error) {
      return {
        success: false,
        filesAdded: 0,
        filesModified: 0,
        filesDeleted: 0,
        bytesTransferred: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      await syncLock.release();
    }
  }

  /**
   * Pull changes from NAS to local
   * Returns conflicts if any files were modified both locally and remotely
   */
  async pull(
    project: Project,
    localPath: string,
    machineName: string,
    branch: string = 'main',
    conflictResolutions?: ConflictResolution[],
    onProgress?: SyncProgressCallback,
    includePatterns?: string[]
  ): Promise<PullResult> {
    const syncLock = await this.lock.acquire(machineName, 'pull');

    try {
      // Phase 1: Scan local directory
      onProgress?.({
        phase: 'scanning',
        filesProcessed: 0,
        totalFiles: 0,
        bytesTransferred: 0,
        totalBytes: 0,
      });

      const cachePath = join(localPath, '.sync', 'cache.json');
      const scanResult = await scanDirectory(localPath, {
        cachePath,
        onProgress: (scanned, filePath) => {
          onProgress?.({
            phase: 'scanning',
            currentFile: filePath,
            filesProcessed: scanned,
            totalFiles: scanned,
            bytesTransferred: 0,
            totalBytes: 0,
          });
        },
      });

      const localManifest = buildManifest(project.id, scanResult);

      // Phase 2: Get remote manifest
      onProgress?.({
        phase: 'comparing',
        filesProcessed: 0,
        totalFiles: scanResult.fileCount,
        bytesTransferred: 0,
        totalBytes: 0,
      });

      const latestSnapshot = this.db.getLatestSnapshot(project.id, branch);
      if (!latestSnapshot) {
        // Nothing to pull
        return {
          success: true,
          filesDownloaded: 0,
          filesDeleted: 0,
          bytesTransferred: 0,
          conflicts: [],
        };
      }

      const remoteEntries = this.db.getSnapshotEntries(latestSnapshot.id);
      const remoteManifest: FileManifest = {
        projectId: project.id,
        createdAt: latestSnapshot.createdAt,
        rootHash: latestSnapshot.manifestHash,
        entries: remoteEntries,
      };

      // Compare manifests (from remote perspective)
      const localMap = new Map(localManifest.entries.map((e) => [e.path, e]));
      const remoteMap = new Map(remoteManifest.entries.map((e) => [e.path, e]));

      const filesToDownload: FileEntry[] = [];
      const filesToDelete: string[] = [];
      const conflicts: Conflict[] = [];

      // Create an ignore matcher if includePatterns provided
      let selectiveMatcher: any = null;
      if (includePatterns && includePatterns.length > 0) {
          const { createIgnoreMatcher } = await import('./ignore');
          selectiveMatcher = createIgnoreMatcher(includePatterns);
      }

      // Find files to download and conflicts
      for (const [path, remoteEntry] of remoteMap) {
        // Skip if selective sync is active and path doesn't match
        if (selectiveMatcher && !selectiveMatcher.ignores(path)) {
            continue;
        }

        const localEntry = localMap.get(path);

        if (!localEntry) {
          // New file on remote - download it
          filesToDownload.push(remoteEntry);
        } else if (localEntry.hash !== remoteEntry.hash) {
          // File differs - check if it's a conflict
          const localNewer =
            localEntry.modifiedAt.getTime() > remoteEntry.modifiedAt.getTime();

          if (localNewer) {
            conflicts.push({
              path,
              localEntry,
              remoteEntry,
              localModifiedAt: localEntry.modifiedAt,
              remoteModifiedAt: remoteEntry.modifiedAt,
            });
          } else {
            filesToDownload.push(remoteEntry);
          }
        }
      }

      // Find files to delete (exist locally but not remotely OR no longer in selective sync)
      for (const path of localMap.keys()) {
        const inRemote = remoteMap.has(path);
        const inSelective = !selectiveMatcher || selectiveMatcher.ignores(path);

        if (!inRemote || !inSelective) {
          filesToDelete.push(path);
        }
      }

      // If there are conflicts and no resolutions provided, return them
      if (conflicts.length > 0 && !conflictResolutions) {
        return {
          success: false,
          filesDownloaded: 0,
          filesDeleted: 0,
          bytesTransferred: 0,
          conflicts,
        };
      }

      // Apply conflict resolutions
      if (conflictResolutions) {
        const resolutionMap = new Map(
          conflictResolutions.map((r) => [r.path, r.resolution])
        );

        for (const conflict of conflicts) {
          const resolution = resolutionMap.get(conflict.path);
          if (resolution === 'keep_remote') {
            filesToDownload.push(conflict.remoteEntry);
          } else if (resolution === 'keep_both') {
            // Rename local file and download remote
            const localFilePath = join(localPath, conflict.path);
            const ext = conflict.path.includes('.')
              ? '.' + conflict.path.split('.').pop()
              : '';
            const baseName = conflict.path.replace(ext, '');
            const conflictPath = `${baseName}.local${ext}`;
            const conflictFilePath = join(localPath, conflictPath);

            // Rename local file
            const { rename } = await import('node:fs/promises');
            await rename(localFilePath, conflictFilePath);

            filesToDownload.push(conflict.remoteEntry);
          }
          // 'keep_local' - do nothing
        }
      }

      // Phase 3: Download files
      let bytesTransferred = 0;
      const totalBytes = filesToDownload.reduce((sum, f) => sum + f.size, 0);
      const concurrency = 20;

      for (let i = 0; i < filesToDownload.length; i += concurrency) {
        const batch = filesToDownload.slice(i, i + concurrency);

        await Promise.all(batch.map(async (file, batchIndex) => {
          const localFilePath = join(localPath, file.path);
          const globalIndex = i + batchIndex;

          onProgress?.({
            phase: 'transferring',
            currentFile: file.path,
            filesProcessed: globalIndex,
            totalFiles: filesToDownload.length,
            bytesTransferred,
            totalBytes,
          });

          await this.storage.retrieveFile(file.hash, localFilePath);
          bytesTransferred += file.size;
        }));
      }

      // Phase 4: Delete files
      onProgress?.({
        phase: 'finalizing',
        filesProcessed: filesToDownload.length,
        totalFiles: filesToDownload.length,
        bytesTransferred,
        totalBytes,
      });

      for (const path of filesToDelete) {
        const localFilePath = join(localPath, path);
        try {
          await unlink(localFilePath);
        } catch {
          // File might not exist
        }
      }

      return {
        success: true,
        filesDownloaded: filesToDownload.length,
        filesDeleted: filesToDelete.length,
        bytesTransferred,
        conflicts: [],
      };
    } catch (error) {
      return {
        success: false,
        filesDownloaded: 0,
        filesDeleted: 0,
        bytesTransferred: 0,
        conflicts: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      await syncLock.release();
    }
  }

  /**
   * Restore a project to a specific snapshot
   * This effectively makes the local state identical to the snapshot, discarding local changes
   */
  async restoreSnapshot(
    project: Project,
    localPath: string,
    snapshotId: string,
    machineName: string,
    onProgress?: SyncProgressCallback,
    includePatterns?: string[]
  ): Promise<PullResult> {
    const syncLock = await this.lock.acquire(machineName, 'restore');

    try {
      // Phase 1: Get target snapshot
      const snapshot = this.db.getSnapshot(snapshotId);
      if (!snapshot) {
        throw new Error('Snapshot not found');
      }

      // Phase 2: Scan local directory
      onProgress?.({
        phase: 'scanning',
        filesProcessed: 0,
        totalFiles: 0,
        bytesTransferred: 0,
        totalBytes: 0,
      });

      const cachePath = join(localPath, '.sync', 'cache.json');
      const scanResult = await scanDirectory(localPath, {
        cachePath,
        onProgress: (scanned, filePath) => {
          onProgress?.({
            phase: 'scanning',
            currentFile: filePath,
            filesProcessed: scanned,
            totalFiles: scanned,
            bytesTransferred: 0,
            totalBytes: 0,
          });
        },
      });

      const localManifest = buildManifest(project.id, scanResult);

      // Phase 3: Compare manifests
      onProgress?.({
        phase: 'comparing',
        filesProcessed: 0,
        totalFiles: scanResult.fileCount,
        bytesTransferred: 0,
        totalBytes: 0,
      });

      const remoteEntries = this.db.getSnapshotEntries(snapshotId);
      const remoteManifest: FileManifest = {
        projectId: project.id,
        createdAt: snapshot.createdAt,
        rootHash: snapshot.manifestHash,
        entries: remoteEntries,
      };

      const localMap = new Map(localManifest.entries.map((e) => [e.path, e]));
      const remoteMap = new Map(remoteManifest.entries.map((e) => [e.path, e]));

      const filesToDownload: FileEntry[] = [];
      const filesToDelete: string[] = [];

      // Create an ignore matcher if includePatterns provided
      let selectiveMatcher: any = null;
      if (includePatterns && includePatterns.length > 0) {
          const { createIgnoreMatcher } = await import('./ignore');
          selectiveMatcher = createIgnoreMatcher(includePatterns);
      }

      // Find files to download (remote files that are different or missing locally)
      for (const [path, remoteEntry] of remoteMap) {
        // Skip if selective sync is active and path doesn't match
        if (selectiveMatcher && !selectiveMatcher.ignores(path)) {
            continue;
        }

        const localEntry = localMap.get(path);

        if (!localEntry || localEntry.hash !== remoteEntry.hash) {
          filesToDownload.push(remoteEntry);
        }
      }

      // Find files to delete (files present locally but not in snapshot OR no longer in selective sync)
      for (const path of localMap.keys()) {
        const inSnapshot = remoteMap.has(path);
        const inSelective = !selectiveMatcher || selectiveMatcher.ignores(path);

        if (!inSnapshot || !inSelective) {
          filesToDelete.push(path);
        }
      }

      // Phase 4: Download files
      let bytesTransferred = 0;
      const totalBytes = filesToDownload.reduce((sum, f) => sum + f.size, 0);
      const concurrency = 20;

      for (let i = 0; i < filesToDownload.length; i += concurrency) {
        const batch = filesToDownload.slice(i, i + concurrency);

        await Promise.all(batch.map(async (file, batchIndex) => {
          const localFilePath = join(localPath, file.path);
          const globalIndex = i + batchIndex;

          onProgress?.({
            phase: 'transferring',
            currentFile: file.path,
            filesProcessed: globalIndex,
            totalFiles: filesToDownload.length,
            bytesTransferred,
            totalBytes,
          });

          await this.storage.retrieveFile(file.hash, localFilePath);
          bytesTransferred += file.size;
        }));
      }

      // Phase 5: Delete files
      onProgress?.({
        phase: 'finalizing',
        filesProcessed: filesToDownload.length,
        totalFiles: filesToDownload.length,
        bytesTransferred,
        totalBytes,
      });

      for (const path of filesToDelete) {
        const localFilePath = join(localPath, path);
        try {
          await unlink(localFilePath);
        } catch {
          // File might not exist
        }
      }

      return {
        success: true,
        filesDownloaded: filesToDownload.length,
        filesDeleted: filesToDelete.length,
        bytesTransferred,
        conflicts: [],
      };
    } catch (error) {
      return {
        success: false,
        filesDownloaded: 0,
        filesDeleted: 0,
        bytesTransferred: 0,
        conflicts: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      await syncLock.release();
    }
  }

  /**
   * Get status - compare local and remote without making changes
   */
  async getStatus(
    project: Project,
    localPath: string,
    branch: string = 'main'
  ): Promise<{
    added: FileEntry[];
    modified: FileEntry[];
    deleted: string[];
    unchanged: number;
    localSize: number;
    remoteSize: number;
  }> {
    const cachePath = join(localPath, '.sync', 'cache.json');
    const scanResult = await scanDirectory(localPath, { cachePath });
    const localManifest = buildManifest(project.id, scanResult);

    const latestSnapshot = this.db.getLatestSnapshot(project.id, branch);
    let remoteEntries: FileEntry[] = [];
    let remoteSize = 0;

    if (latestSnapshot) {
      remoteEntries = this.db.getSnapshotEntries(latestSnapshot.id);
      remoteSize = latestSnapshot.totalSize;
    }

    const remoteManifest: FileManifest = {
      projectId: project.id,
      createdAt: latestSnapshot?.createdAt ?? new Date(),
      rootHash: latestSnapshot?.manifestHash ?? '',
      entries: remoteEntries,
    };

    const diff = compareManifests(localManifest, remoteManifest);

    return {
      ...diff,
      unchanged: diff.unchanged.length,
      localSize: scanResult.totalSize,
      remoteSize,
    };
  }

  /**
   * Create a new project
   */
  createProject(name: string): Project {
    const project: Project = {
      id: uuid(),
      name,
      createdAt: new Date(),
      lastSyncAt: null,
    };
    this.db.createProject(project);
    return project;
  }

  /**
   * Get all projects
   */
  getProjects(): Project[] {
    return this.db.getAllProjects();
  }

  /**
   * Get project by ID
   */
  getProject(id: string): Project | null {
    return this.db.getProject(id);
  }

  /**
   * Delete a project
   */
  deleteProject(id: string): void {
    this.db.deleteProject(id);
  }

  /**
   * Get snapshots for a project
   */
  getSnapshots(projectId: string, branch?: string, limit?: number): Snapshot[] {
    return this.db.getProjectSnapshots(projectId, branch, limit);
  }

  /**
   * Get latest snapshot for a branch
   */
  getLatestSnapshot(projectId: string, branch: string = 'main'): Snapshot | null {
    return this.db.getLatestSnapshot(projectId, branch);
  }

  /**
   * Create a new branch
   */
  async createBranch(projectId: string, name: string): Promise<void> {
    return this.db.createBranch(projectId, name);
  }

  /**
   * Get all branches for a project
   */
  async getBranches(projectId: string): Promise<string[]> {
    return this.db.getProjectBranches(projectId);
  }

  /**
   * Get files in a snapshot
   */
  getSnapshotFiles(snapshotId: string): FileEntry[] {
    return this.db.getSnapshotEntries(snapshotId);
  }

  /**
   * Restore a specific file from a snapshot
   */
  async restoreFile(
    snapshotId: string,
    filePath: string,
    destPath: string
  ): Promise<boolean> {
    const entries = this.db.getSnapshotEntries(snapshotId);
    const entry = entries.find((e) => e.path === filePath);

    if (!entry) {
      return false;
    }

    return this.storage.retrieveFile(entry.hash, destPath);
  }

  /**
   * Scan project directory to get file list
   */
  async scanProject(localPath: string): Promise<FileEntry[]> {
    const cachePath = join(localPath, '.sync', 'cache.json');
    const result = await scanDirectory(localPath, { cachePath });
    return result.entries;
  }

  /**
   * Acquire a lock for a specific file
   */
  async lockFile(projectId: string, path: string, machineName: string): Promise<boolean> {
    return this.db.acquireFileLock(projectId, path, machineName);
  }

  /**
   * Release a lock for a specific file
   */
  async unlockFile(projectId: string, path: string, machineName: string): Promise<boolean> {
    return this.db.releaseFileLock(projectId, path, machineName);
  }

  /**
   * Get all locked files for a project
   */
  async getFileLocks(projectId: string): Promise<FileLock[]> {
    return this.db.getFileLocks(projectId);
  }

  /**
   * Check if a specific file is locked
   */
  async isFileLocked(projectId: string, path: string): Promise<FileLock | null> {
    return this.db.getFileLock(projectId, path);
  }

  /**
   * Run garbage collection to remove orphaned files
   */
  async runGarbageCollection(machineName: string): Promise<{ deletedCount: number; deletedSize: number }> {
    const syncLock = await this.lock.acquire(machineName, 'gc' as any); // cast to any to allow new operation type if strict

    try {
      // Get all hashes currently referenced by any snapshot
      const activeHashes = this.db.getAllReferencedHashes();
      
      // Prune storage
      const result = await this.storage.prune(activeHashes);
      
      // Cleanup temp files as well
      await this.storage.cleanupTemp();
      
      return result;
    } finally {
      await syncLock.release();
    }
  }

  /**
   * Check lock status
   */
  async isLocked(): Promise<boolean> {
    return this.lock.isLocked();
  }

  /**
   * Get lock info
   */
  async getLockInfo() {
    return this.lock.getLockInfo();
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}
