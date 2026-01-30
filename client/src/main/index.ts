/**
 * Electron Main Process
 */

import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } from 'electron';
import { join } from 'node:path';
import { SyncEngine } from '@networksync/core';
import chokidar from 'chokidar';
import fs from 'node:fs/promises';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let syncEngine: SyncEngine | null = null;
let watcher: chokidar.FSWatcher | null = null;
let remotePollInterval: NodeJS.Timeout | null = null;
let lastKnownSnapshotId: string | null = null;

// Store config
interface AppConfig {
  nasPath: string | null;
  machineName: string;
  projects: Record<string, { localPath: string }>;
}

let config: AppConfig = {
  nasPath: null,
  machineName: require('os').hostname(),
  projects: {},
};

async function loadConfig() {
  try {
    const configPath = join(app.getPath('userData'), 'config.json');
    const data = await fs.readFile(configPath, 'utf8');
    const loaded = JSON.parse(data);
    config = { ...config, ...loaded };
    
    // Initialize sync engine if nasPath exists
    if (config.nasPath) {
      syncEngine = new SyncEngine(config.nasPath);
      await syncEngine.initialize();
    }
  } catch (error) {
    // Config doesn't exist or is invalid, use defaults
    console.log('No existing config found, using defaults.');
  }
}

async function saveConfig() {
  try {
    const configPath = join(app.getPath('userData'), 'config.json');
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a0a',
      symbolColor: '#ffffff',
      height: 40,
    },
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0a0a0a',
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('close', (event) => {
    if (tray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray() {
  // Create a simple tray icon (you'd want a proper icon file in production)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open NetworkSync',
      click: () => {
        mainWindow?.show();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        tray?.destroy();
        tray = null;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('NetworkSync');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow?.show();
  });
}

// IPC Handlers
function setupIpcHandlers() {
  // Select NAS folder
  ipcMain.handle('select-nas-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select NetworkSync folder on NAS',
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // Select local project folder
  ipcMain.handle('select-project-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select local project folder',
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // Set NAS path and initialize sync engine
  ipcMain.handle('set-nas-path', async (_event, nasPath: string) => {
    config.nasPath = nasPath;
    await saveConfig();
    syncEngine = new SyncEngine(nasPath);
    await syncEngine.initialize();
    return true;
  });

  // Get config
  ipcMain.handle('get-config', () => {
    return config;
  });

  // Get projects
  ipcMain.handle('get-projects', () => {
    if (!syncEngine) return [];
    const nasProjects = syncEngine.getProjects();
    // Merge with local config
    return nasProjects.map(p => ({
        ...p,
        localPath: config.projects[p.id]?.localPath
    }));
  });

  // Set project path
  ipcMain.handle('set-project-path', async (_event, projectId: string, localPath: string) => {
    if (!config.projects[projectId]) {
        config.projects[projectId] = { localPath };
    } else {
        config.projects[projectId].localPath = localPath;
    }
    await saveConfig();
    return true;
  });

  // Create project
  ipcMain.handle('create-project', (_event, name: string) => {
    if (!syncEngine) throw new Error('NAS not configured');
    return syncEngine.createProject(name);
  });

  // Delete project
  ipcMain.handle('delete-project', async (_event, id: string) => {
    if (!syncEngine) throw new Error('NAS not configured');
    syncEngine.deleteProject(id);
    
    // Also remove from local config
    if (config.projects[id]) {
        delete config.projects[id];
        await saveConfig();
    }
  });

  // Get snapshots
  ipcMain.handle('get-snapshots', (_event, projectId: string, branch?: string, limit?: number) => {
    if (!syncEngine) return [];
    return syncEngine.getSnapshots(projectId, branch, limit);
  });

  // Get sync status
  ipcMain.handle(
    'get-status',
    async (_event, projectId: string, localPath: string, branch: string = 'main') => {
      if (!syncEngine) throw new Error('NAS not configured');
      const project = syncEngine.getProject(projectId);
      if (!project) throw new Error('Project not found');
      return syncEngine.getStatus(project, localPath, branch);
    }
  );

  // Push
  ipcMain.handle(
    'push',
    async (_event, projectId: string, localPath: string, message: string, branch: string = 'main') => {
      if (!syncEngine) throw new Error('NAS not configured');
      const project = syncEngine.getProject(projectId);
      if (!project) throw new Error('Project not found');

      return syncEngine.push(project, localPath, config.machineName, message, branch, (progress) => {
        mainWindow?.webContents.send('sync-progress', progress);
      });
    }
  );

  // Pull
  ipcMain.handle(
    'pull',
    async (
      _event,
      projectId: string,
      localPath: string,
      branch: string = 'main',
      conflictResolutions?: Array<{ path: string; resolution: string }>,
      includePatterns?: string[]
    ) => {
      if (!syncEngine) throw new Error('NAS not configured');
      const project = syncEngine.getProject(projectId);
      if (!project) throw new Error('Project not found');

      return syncEngine.pull(
        project,
        localPath,
        config.machineName,
        branch,
        conflictResolutions as any,
        (progress) => {
          mainWindow?.webContents.send('sync-progress', progress);
        },
        includePatterns
      );
    }
  );

  // Restore snapshot
  ipcMain.handle(
    'restore-snapshot',
    async (
      _event,
      projectId: string,
      localPath: string,
      snapshotId: string,
      includePatterns?: string[]
    ) => {
      if (!syncEngine) throw new Error('NAS not configured');
      const project = syncEngine.getProject(projectId);
      if (!project) throw new Error('Project not found');

      return syncEngine.restoreSnapshot(
        project,
        localPath,
        snapshotId,
        config.machineName,
        (progress) => {
          mainWindow?.webContents.send('sync-progress', progress);
        },
        includePatterns
      );
    }
  );

  // Selective Sync Management
  ipcMain.handle('get-selective-sync', async (_event, localPath: string) => {
    try {
      const fs = await import('node:fs/promises');
      const configPath = join(localPath, '.sync', 'selective.json');
      if (await fs.stat(configPath).catch(() => null)) {
        const data = await fs.readFile(configPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to read selective sync config:', error);
    }
    return [];
  });

  ipcMain.handle('set-selective-sync', async (_event, localPath: string, patterns: string[]) => {
    try {
      const fs = await import('node:fs/promises');
      const configPath = join(localPath, '.sync', 'selective.json');
      await fs.mkdir(join(localPath, '.sync'), { recursive: true });
      await fs.writeFile(configPath, JSON.stringify(patterns, null, 2));
      return true;
    } catch (error) {
      console.error('Failed to write selective sync config:', error);
      return false;
    }
  });

  // Branch management
  ipcMain.handle('create-branch', async (_event, projectId: string, name: string) => {
    if (!syncEngine) throw new Error('NAS not configured');
    return syncEngine.createBranch(projectId, name);
  });

  ipcMain.handle('get-branches', async (_event, projectId: string) => {
    if (!syncEngine) return ['main'];
    return syncEngine.getBranches(projectId);
  });

  // Check lock status
  ipcMain.handle('is-locked', async () => {
    if (!syncEngine) return false;
    return syncEngine.isLocked();
  });

  // Get lock info
  ipcMain.handle('get-lock-info', async () => {
    if (!syncEngine) return null;
    return syncEngine.getLockInfo();
  });

  ipcMain.handle('scan-project', async (_event, localPath: string) => {
    if (!syncEngine) throw new Error('NAS not configured');
    return syncEngine.scanProject(localPath);
  });

  // Garbage Collection
  ipcMain.handle('run-gc', async () => {
    if (!syncEngine) throw new Error('NAS not configured');
    return syncEngine.runGarbageCollection(config.machineName);
  });

  // File Locking
  ipcMain.handle('lock-file', async (_event, projectId: string, path: string) => {
    if (!syncEngine) throw new Error('NAS not configured');
    return syncEngine.lockFile(projectId, path, config.machineName);
  });

  ipcMain.handle('unlock-file', async (_event, projectId: string, path: string) => {
    if (!syncEngine) throw new Error('NAS not configured');
    return syncEngine.unlockFile(projectId, path, config.machineName);
  });

  ipcMain.handle('get-file-locks', async (_event, projectId: string) => {
    if (!syncEngine) return [];
    return syncEngine.getFileLocks(projectId);
  });

  ipcMain.handle('is-file-locked', async (_event, projectId: string, path: string) => {
    if (!syncEngine) return null;
    return syncEngine.isFileLocked(projectId, path);
  });

  // File Watching
  ipcMain.handle('watch-project', (_event, projectId: string, localPath: string) => {
    if (watcher) {
      watcher.close();
    }

    if (!localPath) return;

    // Watch local path for changes
    watcher = chokidar.watch(localPath, {
      ignored: [
        /(^|[\/\\])\../, // ignore dotfiles
        '**/node_modules/**',
        '**/.sync/**',
        '**/Binaries/**',
        '**/Intermediate/**',
        '**/Saved/**',
        '**/DerivedDataCache/**'
      ],
      persistent: true,
      ignoreInitial: true,
    });

    let debounceTimer: NodeJS.Timeout;
    const notifyChanges = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        mainWindow?.webContents.send('local-changes', { projectId });
      }, 1000); // 1 second debounce
    };

    watcher.on('add', notifyChanges);
    watcher.on('change', notifyChanges);
    watcher.on('unlink', notifyChanges);
    watcher.on('addDir', notifyChanges);
    watcher.on('unlinkDir', notifyChanges);

    // Also start polling for remote changes
    if (remotePollInterval) {
        clearInterval(remotePollInterval);
    }

    lastKnownSnapshotId = null; // Reset to force initial check
    remotePollInterval = setInterval(async () => {
        if (!syncEngine || !mainWindow) return;
        
        try {
            const latest = syncEngine.getLatestSnapshot(projectId);
            if (latest && latest.id !== lastKnownSnapshotId) {
                if (lastKnownSnapshotId !== null) {
                    mainWindow.webContents.send('remote-changes', { 
                        projectId, 
                        snapshot: latest 
                    });
                }
                lastKnownSnapshotId = latest.id;
            }
        } catch (error) {
            console.error('Remote polling failed:', error);
        }
    }, 30000); // Poll every 30 seconds

    return true;
  });

  ipcMain.handle('stop-watching', () => {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    if (remotePollInterval) {
      clearInterval(remotePollInterval);
      remotePollInterval = null;
    }
    return true;
  });

  // Window controls
  ipcMain.handle('window-minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.handle('window-close', () => {
    mainWindow?.close();
  });
}

// App lifecycle
app.whenReady().then(async () => {
  await loadConfig();
  createWindow();
  createTray();
  setupIpcHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Don't quit, stay in tray
    if (!tray) {
      app.quit();
    }
  }
});

app.on('before-quit', () => {
  syncEngine?.close();
});
