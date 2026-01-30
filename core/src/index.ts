/**
 * @networksync/core
 * Core library for NetworkSync - file scanning, hashing, storage, and sync
 */

// Types
export * from './types';

// Hashing utilities
export {
  hashFile,
  hashBuffer,
  hashString,
  computeFileChunks,
  computeManifestHash,
} from './hasher';

// Ignore pattern matching
export {
  createIgnoreMatcher,
  loadIgnoreFile,
  parseIgnoreFile,
  createProjectIgnoreMatcher,
  isUnrealEngineProject,
  DEFAULT_IGNORE_PATTERNS,
  DEFAULT_UNREAL_IGNORE_PATTERNS,
  type IgnoreMatcher,
} from './ignore';

// File scanning
export {
  scanDirectory,
  buildManifest,
  compareManifests,
  formatSize,
  type ScanOptions,
  type ScanResult,
} from './scanner';

// Database
export { NetworkSyncDb } from './db';

// Content-addressable storage
export {
  ContentStorage,
  type CopyProgress,
  type ProgressCallback,
} from './storage';

// File locking
export {
  NasLock,
  withLock,
  type LockInfo,
  type SyncLock,
} from './lock';

// Sync engine
export {
  SyncEngine,
  type SyncProgress,
  type SyncProgressCallback,
  type PushResult,
  type PullResult,
  type ConflictResolution,
} from './sync';
