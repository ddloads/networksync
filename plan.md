# NetworkSync - Local Network Version Control for Game Dev

## Overview
A file synchronization application with snapshot capabilities, designed for syncing Unreal Engine projects between a laptop and desktop using a shared NAS folder.

## Tech Stack
- **Runtime**: Node.js with TypeScript
- **Desktop App**: Electron (React for UI, TailwindCSS + shadcn/ui for styling)
- **Database**: SQLite (stored on NAS, accessed by clients)
- **Build Tools**: Vite

---

## Architecture

### High-Level Design
```
┌─────────────┐                    ┌─────────────┐
│   Desktop   │                    │   Laptop    │
│  (Electron) │                    │  (Electron) │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │    Direct File Access (SMB)      │
       └────────────┬─────────────────────┘
                    │
          ┌─────────▼─────────┐
          │   NAS (Shared     │
          │   Network Folder) │
          │   ├── sync.db     │
          │   ├── objects/    │
          │   └── projects/   │
          └───────────────────┘
```

**Key Change**: No server runs on the NAS. The Electron app on each machine handles all sync logic, reading/writing directly to the shared NAS folder.

### Components

#### 1. Desktop App (`/client`)
Electron application - handles ALL logic

- **System Tray** - Quick access, sync status indicator
- **Main Window** - Project list, sync controls, history
- **Conflict Resolver** - Side-by-side comparison UI
- **Settings** - NAS path config, ignore patterns, preferences
- **Sync Engine** - Push/pull operations, file transfers
- **Database Access** - Direct SQLite access with file locking

#### 2. Core Library (`/core`)
Shared logic (used by Electron main process)

- **File Scanner** - Walk directory, compute hashes
- **Diff Engine** - Detect changes, generate manifests
- **File Transfer** - Copy files to/from NAS with progress
- **Ignore Matcher** - .syncignore file support
- **Database** - SQLite wrapper with locking

#### 3. NAS Storage Structure
```
\\NAS\NetworkSync\
├── sync.db              # SQLite database (projects, snapshots, manifests)
├── sync.db.lock         # Lock file for concurrent access
├── objects/             # Content-addressable file storage
│   ├── ab/
│   │   └── ab12cd34...  # Files stored by hash
│   └── cd/
│       └── cd45ef67...
└── temp/                # Temporary files during sync
```

---

## Data Models

### Project
```typescript
interface Project {
  id: string;
  name: string;
  nasPath: string;        // Path on NAS for this project
  localPath?: string;     // Each machine stores its local path separately
  createdAt: Date;
  lastSyncAt: Date;
}
```

### Snapshot
```typescript
interface Snapshot {
  id: string;
  projectId: string;
  message: string;
  createdAt: Date;
  createdBy: string;       // Machine name
  manifestHash: string;    // Root hash of file tree
}
```

### FileEntry
```typescript
interface FileEntry {
  path: string;            // Relative to project root
  hash: string;            // SHA-256 of content
  size: number;
  modifiedAt: Date;
  isDirectory: boolean;
}
```

### LocalConfig (stored per-machine, not on NAS)
```typescript
interface LocalConfig {
  nasPath: string;         // e.g., "\\\\NAS\\NetworkSync" or "Z:\\"
  machineName: string;
  projects: {
    [projectId: string]: {
      localPath: string;   // Local project folder
    };
  };
}
```

---

## Key Features

### 1. Manual Push/Pull Workflow
- **Push**: Scan local project → Compare to NAS manifest → Copy changed files to NAS → Create snapshot
- **Pull**: Get NAS manifest → Compare to local → Copy files from NAS → Update local

### 2. Snapshot System
- Create named snapshots before/after major changes
- Browse snapshot history
- Restore entire project or individual files from snapshots
- Automatic snapshot on each push

### 3. Conflict Resolution
- Detect conflicts during pull (local + remote both modified since last sync)
- UI shows both versions side-by-side
- For text files: diff view
- For binary files: metadata comparison (size, date)
- Options: Keep local, Keep remote, Keep both

### 4. Unreal Engine Optimizations
Default `.syncignore`:
```
Intermediate/
Saved/
Binaries/
DerivedDataCache/
.vs/
*.sln
*.log
```

### 5. File Locking
- Use lock file to prevent simultaneous sync operations
- Check lock before push/pull
- Auto-release lock after operation or timeout

---

## Project Structure

```
networksync/
├── core/                    # Shared library
│   ├── src/
│   │   ├── scanner.ts       # File system scanning
│   │   ├── hasher.ts        # Content hashing
│   │   ├── diff.ts          # Change detection
│   │   ├── storage.ts       # Content-addressable store
│   │   ├── db.ts            # SQLite wrapper with locking
│   │   ├── ignore.ts        # .syncignore parsing
│   │   └── types.ts         # Shared types
│   └── package.json
│
├── client/                  # Electron app
│   ├── src/
│   │   ├── main/            # Electron main process
│   │   │   ├── index.ts
│   │   │   ├── tray.ts
│   │   │   ├── ipc.ts
│   │   │   └── sync.ts      # Sync operations
│   │   ├── renderer/        # React UI
│   │   │   ├── App.tsx
│   │   │   ├── pages/
│   │   │   │   ├── Projects.tsx
│   │   │   │   ├── Sync.tsx
│   │   │   │   ├── History.tsx
│   │   │   │   └── Conflicts.tsx
│   │   │   └── components/
│   │   └── preload.ts
│   └── package.json
│
├── package.json             # Workspace root
└── README.md
```

---

## Implementation Phases

### Phase 1: Core Foundation ✅ Complete
1. ✅ Set up monorepo structure with npm workspaces
2. ✅ Implement core library:
   - ✅ File scanner with hash computation
   - ✅ Ignore pattern matcher
   - ✅ Type definitions
3. ✅ NAS-based storage:
   - ✅ SQLite database module
   - ✅ Content-addressable file storage
   - ✅ File locking mechanism

### Phase 2: Sync Engine ✅ Complete
1. ✅ Manifest diff algorithm
2. ✅ File copy operations (local ↔ NAS)
3. ✅ Push/pull logic with progress callbacks
4. ✅ Snapshot creation

### Phase 3: Electron Client ✅ Complete
1. ✅ Set up Electron + React + Vite + TailwindCSS + shadcn/ui
2. ✅ Modern, sleek project configuration UI
3. ✅ Sync status and progress display
4. ✅ System tray integration

### Phase 4: Conflict Resolution ✅ Basic Implementation
1. ✅ Detect conflicts during pull
2. ✅ Basic conflict resolution (keep local/remote)
3. 🔲 Text file diff viewer (future enhancement)
4. 🔲 Binary file comparison view (future enhancement)

### Phase 5: Polish & UE Optimization (Remaining)
1. ✅ Default Unreal Engine ignore patterns
2. 🔲 Large file optimization (chunked transfers)
3. 🔲 Snapshot browser and restore UI
4. 🔲 Error handling improvements

---

## Sync Algorithm

### Push Operation
```
1. Acquire NAS lock
2. Scan local project directory
3. Load current NAS manifest
4. Compare manifests:
   - Find new files (in local, not in NAS)
   - Find modified files (different hash)
   - Find deleted files (in NAS, not in local)
5. For each new/modified file:
   - Copy to NAS objects/ (by hash, for deduplication)
6. Create new snapshot with manifest
7. Release NAS lock
```

### Pull Operation
```
1. Acquire NAS lock
2. Scan local project directory
3. Load current NAS manifest
4. Compare manifests
5. Detect conflicts (file modified both locally and remotely)
6. If conflicts: prompt user for resolution
7. For each file to download:
   - Copy from NAS objects/ to local project
8. Delete local files that were deleted on NAS
9. Release NAS lock
```

---

## Verification Plan

### Testing the Implementation
1. **Unit Tests**: Core library functions (hashing, diffing, ignore matching)
2. **Manual Testing**:
   - Point app to NAS folder
   - Create test Unreal project
   - Push from desktop
   - Pull to laptop
   - Modify on both, test conflict resolution
   - Create and restore snapshots

### Success Criteria
- [ ] Can push a 10GB+ Unreal project to NAS
- [ ] Transfers show progress for large files
- [ ] Conflicts are properly detected and resolved
- [ ] Snapshots can be browsed and restored
- [ ] Ignored files are excluded from sync
- [ ] File locking prevents concurrent sync issues
