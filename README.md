# NetworkSync

**Local Network Version Control for Game Development**

NetworkSync is a file synchronization application designed specifically for syncing Unreal Engine projects (and other large creative projects) between computers (e.g., a laptop and a desktop) using a simple shared network folder (NAS).

It operates without a dedicated server process on the NAS. All logic is handled by the client application, which treats the shared folder as a "dumb" storage backend with smart versioning capabilities.

## Key Features

- **Serverless Architecture**: No software installation required on your NAS or file server. Just a shared folder is enough.
- **Content-Addressable Storage**: Files are stored by their hash, enabling efficient deduplication across snapshots and projects.
- **Snapshot System**:
    - Create named snapshots (commits) for your project state.
    - Browse history and restore previous versions.
    - Automatic snapshots on every push.
- **Game Dev Optimized**:
    - Pre-configured ignore patterns for Unreal Engine (Intermediate, Saved, Binaries, etc.).
    - Efficient handling of large binary assets.
- **Conflict Resolution**:
    - Detects when files have changed on both local and remote ends.
    - Side-by-side comparison UI to resolve conflicts.
- **Safety**:
    - File locking prevents concurrent modification corruption.
    - Atomic operations ensure database integrity.

## Architecture

The system consists of two main components organized in a monorepo:

1.  **Client (`/client`)**: An Electron + React application that provides the user interface for managing projects, viewing history, and resolving conflicts.
2.  **Core (`/core`)**: A TypeScript library containing the business logic for file scanning, hashing, diffing, and direct database/file operations on the NAS.

### Data Flow
```
[Desktop Client] <── SMB/Network Share ──> [NAS Storage] <── SMB/Network Share ──> [Laptop Client]
```

The NAS storage structure:
-   `sync.db`: SQLite database tracking projects, snapshots, and manifests.
-   `objects/`: Raw file content stored by SHA-256 hash.
-   `temp/`: Staging area for transfers.

## Getting Started

### Prerequisites
-   Node.js (v18 or higher)
-   npm

### Installation

1.  Clone the repository.
2.  Install dependencies:
    ```bash
    npm install
    ```

### Development

To run the application in development mode:

```bash
# Starts the Electron client with hot reload
npm run dev
```

### Building

To build the application for production:

```bash
# Builds both core and client packages
npm run build
```

The executable will be available in `client/release`.

## Usage Workflow

1.  **Setup**: Launch NetworkSync and configure the path to your NAS share.
2.  **Create Project**: Add a new project by selecting a local folder. This initializes it on the NAS.
3.  **Push**: Scan your local changes and upload them to the NAS. This creates a new snapshot.
4.  **Pull**: On another machine, pull the latest snapshot. The app will download only changed files.
5.  **Resolve**: If changes occurred on both ends, use the conflict resolution UI to decide which version to keep.

## Tech Stack

-   **Runtime**: Node.js, Electron
-   **Language**: TypeScript
-   **Frontend**: React, TailwindCSS, shadcn/ui
-   **Database**: SQLite (via `sql.js` for portable file access)
-   **Build Tool**: Vite

## License

Private / Internal Tool.
