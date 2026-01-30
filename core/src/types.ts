/**
 * Core types for NetworkSync
 */

export interface Project {
  id: string;
  name: string;
  createdAt: Date;
  lastSyncAt: Date | null;
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

export interface FileEntry {
  path: string;
  hash: string;
  size: number;
  modifiedAt: Date;
  isDirectory: boolean;
}

export interface FileManifest {
  projectId: string;
  createdAt: Date;
  rootHash: string;
  entries: FileEntry[];
}

export interface SyncStatus {
  added: FileEntry[];
  modified: FileEntry[];
  deleted: string[];
  unchanged: number;
}

export interface Conflict {
  path: string;
  localEntry: FileEntry;
  remoteEntry: FileEntry;
  localModifiedAt: Date;
  remoteModifiedAt: Date;
}

export interface TransferProgress {
  filePath: string;
  bytesTransferred: number;
  totalBytes: number;
  chunksCompleted: number;
  totalChunks: number;
}

export interface ChunkInfo {
  index: number;
  offset: number;
  size: number;
  hash: string;
}

export interface FileTransferRequest {
  projectId: string;
  filePath: string;
  fileHash: string;
  totalSize: number;
  chunks: ChunkInfo[];
}

export type SyncDirection = 'push' | 'pull';

export interface SyncOperation {
  direction: SyncDirection;
  projectId: string;
  files: FileEntry[];
  conflicts: Conflict[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress: {
    filesCompleted: number;
    totalFiles: number;
    bytesTransferred: number;
    totalBytes: number;
  };
}

export interface ServerConfig {
  host: string;
  port: number;
  storagePath: string;
  maxChunkSize: number;
}

export interface ClientConfig {
  serverUrl: string;
  machineName: string;
  defaultIgnorePatterns: string[];
}

export interface FileLock {
  projectId: string;
  path: string;
  machineName: string;
  lockedAt: Date;
}