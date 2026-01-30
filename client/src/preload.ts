/**
 * Electron Preload Script
 * Exposes a safe API to the renderer process
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface SyncProgress {
  phase: 'scanning' | 'comparing' | 'transferring' | 'finalizing';
  currentFile?: string;
  filesProcessed: number;
  totalFiles: number;
  bytesTransferred: number;
  totalBytes: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: Date;
  lastSyncAt: Date | null;
  localPath?: string;
}

export interface Snapshot {
  id: string;
  projectId: string;
  message: string;
  createdAt: Date;
  createdBy: string;
  manifestHash: string;
  fileCount: number;
  totalSize: number;
  branch: string;
}

export interface SyncStatus {
  added: Array<{ path: string; size: number }>;
  modified: Array<{ path: string; size: number }>;
  deleted: string[];
  unchanged: number;
  localSize: number;
  remoteSize: number;
}

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
  conflicts: Array<{
    path: string;
    localEntry: { path: string; size: number; modifiedAt: Date };
    remoteEntry: { path: string; size: number; modifiedAt: Date };
  }>;
  error?: string;
}

export interface FileLock {
  projectId: string;
  path: string;
  machineName: string;
  lockedAt: Date;
}

export interface AppConfig {
  nasPath: string | null;
  machineName: string;
}

// API exposed to renderer
const api = {
  // Dialogs
  selectNasFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('select-nas-folder'),
  selectProjectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('select-project-folder'),

  // Configuration
  setNasPath: (nasPath: string): Promise<boolean> =>
    ipcRenderer.invoke('set-nas-path', nasPath),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('get-config'),

  // Projects
    getProjects: (): Promise<Project[]> => ipcRenderer.invoke('get-projects'),
    setProjectPath: (projectId: string, localPath: string): Promise<boolean> => 
      ipcRenderer.invoke('set-project-path', projectId, localPath),
    createProject: (name: string): Promise<Project> =>
      ipcRenderer.invoke('create-project', name),
    deleteProject: (id: string): Promise<void> =>
      ipcRenderer.invoke('delete-project', id),
  
    // Snapshots
    getSnapshots: (projectId: string, branch?: string, limit?: number): Promise<Snapshot[]> =>

      ipcRenderer.invoke('get-snapshots', projectId, branch, limit),

  

    // Sync operations

    getStatus: (projectId: string, localPath: string, branch?: string): Promise<SyncStatus> =>

      ipcRenderer.invoke('get-status', projectId, localPath, branch),

    push: (

      projectId: string,

      localPath: string,

      message: string,

      branch?: string

    ): Promise<PushResult> =>

      ipcRenderer.invoke('push', projectId, localPath, message, branch),

      pull: (

        projectId: string,

        localPath: string,

        branch?: string,

        conflictResolutions?: Array<{ path: string; resolution: string }>,

        includePatterns?: string[]

      ): Promise<PullResult> =>

        ipcRenderer.invoke('pull', projectId, localPath, branch, conflictResolutions, includePatterns),

      

      // Branch management

      createBranch: (projectId: string, name: string): Promise<void> =>

        ipcRenderer.invoke('create-branch', projectId, name),

      getBranches: (projectId: string): Promise<string[]> =>

        ipcRenderer.invoke('get-branches', projectId),

    

      restoreSnapshot: (

        projectId: string,

        localPath: string,

        snapshotId: string,

        includePatterns?: string[]

      ): Promise<PullResult> =>

        ipcRenderer.invoke('restore-snapshot', projectId, localPath, snapshotId, includePatterns),

    

      // Selective Sync

      getSelectiveSync: (localPath: string): Promise<string[]> =>

        ipcRenderer.invoke('get-selective-sync', localPath),

      setSelectiveSync: (localPath: string, patterns: string[]): Promise<boolean> =>

        ipcRenderer.invoke('set-selective-sync', localPath, patterns),

    

      runGC: (): Promise<{ deletedCount: number; deletedSize: number }> =>
    ipcRenderer.invoke('run-gc'),

  scanProject: (localPath: string): Promise<Array<{ path: string; isDirectory: boolean }>> =>
    ipcRenderer.invoke('scan-project', localPath),

  // File Locking
  lockFile: (projectId: string, path: string): Promise<boolean> =>
    ipcRenderer.invoke('lock-file', projectId, path),
  unlockFile: (projectId: string, path: string): Promise<boolean> =>
    ipcRenderer.invoke('unlock-file', projectId, path),
  getFileLocks: (projectId: string): Promise<FileLock[]> =>
    ipcRenderer.invoke('get-file-locks', projectId),
  isFileLocked: (projectId: string, path: string): Promise<FileLock | null> =>
    ipcRenderer.invoke('is-file-locked', projectId, path),

  // Lock status
  isLocked: (): Promise<boolean> => ipcRenderer.invoke('is-locked'),
  getLockInfo: (): Promise<{
    machineName: string;
    lockedAt: Date;
    operation: string;
  } | null> => ipcRenderer.invoke('get-lock-info'),

  // File Watching
  watchProject: (projectId: string, localPath: string): Promise<boolean> =>
    ipcRenderer.invoke('watch-project', projectId, localPath),
  stopWatching: (): Promise<boolean> =>
    ipcRenderer.invoke('stop-watching'),

  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),

  // Events
  onSyncProgress: (callback: (progress: SyncProgress) => void) => {
    const listener = (_event: any, progress: SyncProgress) => callback(progress);
    ipcRenderer.on('sync-progress', listener);
    return () => ipcRenderer.removeListener('sync-progress', listener);
  },
  onLocalChanges: (callback: (data: { projectId: string }) => void) => {
    const listener = (_event: any, data: { projectId: string }) => callback(data);
    ipcRenderer.on('local-changes', listener);
    return () => ipcRenderer.removeListener('local-changes', listener);
  },
  onRemoteChanges: (callback: (data: { projectId: string, snapshot: Snapshot }) => void) => {
    const listener = (_event: any, data: { projectId: string, snapshot: Snapshot }) => callback(data);
    ipcRenderer.on('remote-changes', listener);
    return () => ipcRenderer.removeListener('remote-changes', listener);
  },
};

contextBridge.exposeInMainWorld('api', api);

// Type declaration for renderer
declare global {
  interface Window {
    api: typeof api;
  }
}
