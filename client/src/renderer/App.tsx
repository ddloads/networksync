import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatBytes, formatRelativeTime } from '@/lib/utils';
import { HistoryPage } from './pages/HistoryPage';
import { ConflictsPage } from './pages/ConflictsPage';
import { FileBrowserPage } from './pages/FileBrowserPage';
import { SelectiveSyncPage } from './pages/SelectiveSyncPage';
import { SettingsPage } from './pages/SettingsPage';
import { useToast } from '@/components/ui/use-toast';
import {
  FolderOpen,
  Upload,
  Download,
  Clock,
  HardDrive,
  RefreshCw,
  Plus,
  Minus,
  Square,
  X,
  History,
  Settings,
  GitBranch,
  Filter,
  Folder,
  Trash2,
  MessageSquare,
} from 'lucide-react';

interface Project {
  id: string;
  name: string;
  createdAt: Date;
  lastSyncAt: Date | null;
  localPath?: string;
}

interface SyncProgress {
  phase: 'scanning' | 'comparing' | 'transferring' | 'finalizing';
  currentFile?: string;
  filesProcessed: number;
  totalFiles: number;
  bytesTransferred: number;
  totalBytes: number;
}

function App() {
  const { toast } = useToast();
  const [nasPath, setNasPath] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [localPath, setLocalPath] = useState<string>('');
  const [branches, setBranches] = useState<string[]>(['main']);
  const [currentBranch, setCurrentBranch] = useState<string>('main');
  const [includePatterns, setIncludePatterns] = useState<string[]>([]);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [view, setView] = useState<'project' | 'history' | 'conflicts' | 'files' | 'settings' | 'selective'>('project');
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [pushMessage, setPushMessage] = useState('');
  const [status, setStatus] = useState<{
    added: number;
    modified: number;
    deleted: number;
    unchanged: number;
  } | null>(null);

  // Load initial config
  useEffect(() => {
    loadConfig();
  }, []);

  // Listen for sync progress
  useEffect(() => {
    const unsubscribe = window.api.onSyncProgress((progress) => {
      setSyncProgress(progress);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Watch project for local and remote changes
  useEffect(() => {
    if (selectedProject && localPath) {
      window.api.watchProject(selectedProject.id, localPath);
    } else {
      window.api.stopWatching();
    }
  }, [selectedProject?.id, localPath]);

  // Listen for change events from main process
  useEffect(() => {
    const unsubLocal = window.api.onLocalChanges(({ projectId }) => {
      if (projectId === selectedProject?.id) {
        console.log('Local changes detected, refreshing status...');
        refreshStatus();
        
        if (autoSyncEnabled && !syncing) {
            console.log('Auto-sync triggered...');
            handlePush();
        }
      }
    });

    const unsubRemote = window.api.onRemoteChanges(({ projectId, snapshot }) => {
      if (projectId === selectedProject?.id) {
        toast({
          title: "New Update Available",
          description: `Snapshot "${snapshot.message}" by ${snapshot.createdBy} is available on NAS.`,
        });
        loadProjects(); // Refresh project list to update last sync info
      }
    });

    return () => {
      unsubLocal();
      unsubRemote();
    };
  }, [selectedProject?.id]);

  const loadConfig = async () => {
    const config = await window.api.getConfig();
    if (config.nasPath) {
      setNasPath(config.nasPath);
      await loadProjects();
    }
  };

  const loadProjects = async () => {
    const projects = await window.api.getProjects();
    setProjects(projects);
  };

  const handleSelectNasFolder = async () => {
    const path = await window.api.selectNasFolder();
    if (path) {
      await window.api.setNasPath(path);
      setNasPath(path);
      await loadProjects();
    }
  };

  const handleSelectProjectFolder = async () => {
    const path = await window.api.selectProjectFolder();
    if (path) {
      setLocalPath(path);
      if (selectedProject) {
        await window.api.setProjectPath(selectedProject.id, path);
        await loadProjects();
      }
    }
  };

  useEffect(() => {
    if (selectedProject && localPath) {
      refreshStatus();
    }
  }, [selectedProject?.id, localPath, currentBranch]);

  const handleDeleteProject = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete project "${name}"? This will remove it from the project list for all users.`)) {
      return;
    }

    try {
      await window.api.deleteProject(id);
      if (selectedProject?.id === id) {
        setSelectedProject(null);
        setLocalPath('');
        setStatus(null);
      }
      await loadProjects();
      toast({ title: "Project deleted" });
    } catch (error) {
      console.error('Failed to delete project:', error);
      toast({ 
        title: "Error", 
        description: `Failed to delete project: ${error}`, 
        variant: "destructive" 
      });
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      setIsCreatingProject(false);
      return;
    }

    try {
      const project = await window.api.createProject(newProjectName.trim());
      await loadProjects();
      setSelectedProject(project);
      setNewProjectName('');
      setIsCreatingProject(false);
      toast({ title: "Project created" });
    } catch (error) {
      console.error('Failed to create project:', error);
      toast({ 
        title: "Error", 
        description: `Failed to create project: ${error}`, 
        variant: "destructive" 
      });
    }
  };

  useEffect(() => {
    if (localPath) {
      window.api.getSelectiveSync(localPath).then(setIncludePatterns);
    }
  }, [localPath]);

  useEffect(() => {
    if (selectedProject) {
      loadBranches();
    }
  }, [selectedProject?.id]);

  const loadBranches = async () => {
    if (!selectedProject) return;
    const projectBranches = await window.api.getBranches(selectedProject.id);
    setBranches(projectBranches);
  };

  const refreshStatus = async () => {
    if (!selectedProject || !localPath) return;
    try {
      const status = await window.api.getStatus(selectedProject.id, localPath, currentBranch);
      setStatus({
        added: status.added.length,
        modified: status.modified.length,
        deleted: status.deleted.length,
        unchanged: status.unchanged,
      });
    } catch (error) {
      console.error('Failed to get status:', error);
    }
  };

  const handlePush = async () => {
    if (!selectedProject || !localPath) return;

    setSyncing(true);
    setSyncProgress(null);
    try {
      const message = pushMessage.trim() || 'Sync';
      const result = await window.api.push(selectedProject.id, localPath, message, currentBranch);
      if (result.success) {
        toast({
          title: "Push complete",
          description: `Added: ${result.filesAdded}, Modified: ${result.filesModified}, Deleted: ${result.filesDeleted}`
        });
        setPushMessage(''); // Clear message on success
        await loadProjects();
        await refreshStatus();
      } else {
        toast({ 
            title: "Push failed", 
            description: result.error, 
            variant: "destructive" 
        });
      }
    } catch (error) {
        toast({ 
            title: "Push failed", 
            description: String(error), 
            variant: "destructive" 
        });
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const handlePull = async () => {
    if (!selectedProject || !localPath) return;

    setSyncing(true);
    setSyncProgress(null);
    try {
      const result = await window.api.pull(selectedProject.id, localPath, currentBranch, undefined, includePatterns);

      if (result.conflicts.length > 0) {
        setConflicts(result.conflicts);
        setView('conflicts');
        toast({
            title: "Conflicts detected",
            description: "Please resolve conflicts to complete the pull.",
            variant: "destructive"
        });
      } else if (result.success) {
        toast({
            title: "Pull complete",
            description: `Downloaded: ${result.filesDownloaded}, Deleted: ${result.filesDeleted}`
        });
        await loadProjects();
        await refreshStatus();
      } else {
        toast({ 
            title: "Pull failed", 
            description: result.error, 
            variant: "destructive" 
        });
      }
    } catch (error) {
        toast({ 
            title: "Pull failed", 
            description: String(error), 
            variant: "destructive" 
        });
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const handleResolveConflicts = async (resolutions: any[]) => {
    if (!selectedProject || !localPath) return;
    
    setSyncing(true);
    try {
      const retryResult = await window.api.pull(selectedProject.id, localPath, currentBranch, resolutions, includePatterns);
      if (retryResult.success) {
        toast({
            title: "Pull complete",
            description: `Downloaded: ${retryResult.filesDownloaded}, Deleted: ${retryResult.filesDeleted}`
        });
        setView('project');
        setConflicts([]);
        await loadProjects();
        await refreshStatus();
      } else {
        toast({ 
            title: "Pull failed", 
            description: retryResult.error, 
            variant: "destructive" 
        });
      }
    } catch (error) {
        toast({ 
            title: "Pull failed", 
            description: String(error), 
            variant: "destructive" 
        });
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const handleCreateBranch = async () => {
    if (!selectedProject || !newBranchName.trim()) {
        setIsCreatingBranch(false);
        return;
    }
    
    try {
      await window.api.createBranch(selectedProject.id, newBranchName.trim());
      await loadBranches();
      setCurrentBranch(newBranchName.trim());
      setNewBranchName('');
      setIsCreatingBranch(false);
      toast({ title: "Branch created" });
    } catch (error) {
      console.error('Failed to create branch:', error);
      toast({ 
        title: "Error", 
        description: `Failed to create branch: ${error}`, 
        variant: "destructive" 
      });
    }
  };

  const handleRestore = async (snapshotId: string) => {
    if (!selectedProject || !localPath) return;

    if (!confirm('Are you sure? This will overwrite your local files with the snapshot version.')) {
      return;
    }

    setSyncing(true);
    setSyncProgress(null);
    try {
      const result = await window.api.restoreSnapshot(selectedProject.id, localPath, snapshotId, includePatterns);
      if (result.success) {
        toast({
            title: "Restore complete",
            description: `Downloaded: ${result.filesDownloaded}, Deleted: ${result.filesDeleted}`
        });
        await refreshStatus();
        setView('project');
      } else {
        toast({ 
            title: "Restore failed", 
            description: result.error, 
            variant: "destructive" 
        });
      }
    } catch (error) {
        toast({ 
            title: "Restore failed", 
            description: String(error), 
            variant: "destructive" 
        });
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  // Setup screen
  if (!nasPath) {
    return (
      <div className="h-screen flex flex-col bg-background">
        {/* Title bar */}
        <div className="h-10 flex items-center justify-between px-4 drag-region border-b">
          <span className="text-sm font-semibold">NetworkSync</span>
          <div className="flex gap-1 no-drag">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.api.minimize()}>
              <Minus className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.api.maximize()}>
              <Square className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-destructive hover:text-destructive-foreground" onClick={() => window.api.close()}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center p-8">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Welcome to NetworkSync</CardTitle>
              <CardDescription>
                Sync your game projects across your local network
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              <div className="text-center text-muted-foreground text-sm">
                Select the NetworkSync folder on your NAS to get started.
                This is where your project data will be stored.
              </div>
              <Button onClick={handleSelectNasFolder} size="lg" className="w-full">
                <FolderOpen className="mr-2 h-5 w-5" />
                Select NAS Folder
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Title bar */}
      <div className="h-10 flex items-center justify-between px-4 drag-region border-b">
        <span className="text-sm font-semibold">NetworkSync</span>
        <div className="flex gap-1 no-drag">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.api.minimize()}>
            <Minus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.api.maximize()}>
            <Square className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-destructive hover:text-destructive-foreground" onClick={() => window.api.close()}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 flex">
        {/* Sidebar */}
        <div className="w-64 border-r p-4 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Projects</h2>
            {!isCreatingProject && (
              <Button variant="ghost" size="icon" onClick={() => setIsCreatingProject(true)}>
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="flex-1 space-y-2 overflow-auto">
            {isCreatingProject && (
              <div className="p-2 space-y-2 border rounded-lg bg-muted/50">
                <input
                  autoFocus
                  className="w-full bg-background border rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Project name..."
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateProject();
                    if (e.key === 'Escape') {
                      setIsCreatingProject(false);
                      setNewProjectName('');
                    }
                  }}
                />
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleCreateProject}>
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 h-7 text-xs"
                    onClick={() => {
                      setIsCreatingProject(false);
                      setNewProjectName('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {projects.map((project) => (
              <div 
                key={project.id}
                className={`group relative w-full rounded-lg transition-colors ${
                  selectedProject?.id === project.id
                    ? 'bg-primary/10 border border-primary/20'
                    : 'hover:bg-muted'
                }`}
              >
                <button
                    onClick={() => {
                    setSelectedProject(project);
                    setLocalPath(project.localPath || '');
                    setStatus(null);
                    setView('project');
                    }}
                    className="w-full text-left p-3 pr-10"
                >
                    <div className="font-medium truncate">{project.name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                    <Clock className="h-3 w-3" />
                    {project.lastSyncAt
                        ? formatRelativeTime(project.lastSyncAt)
                        : 'Never synced'}
                    </div>
                </button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-transparent"
                    onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteProject(project.id, project.name);
                    }}
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            {projects.length === 0 && !isCreatingProject && (
              <div className="text-center text-muted-foreground text-sm py-8">
                No projects yet.
                <br />
                Click + to create one.
              </div>
            )}
          </div>

          <div className="pt-4 border-t mt-4">
            <Button variant="ghost" className="w-full justify-start mb-2" onClick={() => setView('settings')}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
            <div 
                className="text-xs text-muted-foreground flex items-center gap-2 cursor-pointer hover:text-primary transition-colors"
                onClick={() => setView('settings')}
            >
              <HardDrive className="h-3 w-3" />
              <span className="truncate" title={nasPath || ''}>{nasPath}</span>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 p-6">
          {view === 'settings' ? (
            <SettingsPage 
              onBack={() => setView('project')} 
              onNasPathChange={() => {
                  loadProjects();
                  loadConfig();
              }}
            />
          ) : selectedProject ? (
            view === 'history' ? (
              <HistoryPage
                projectId={selectedProject.id}
                onBack={() => setView('project')}
                onRestore={handleRestore}
              />
            ) : view === 'selective' ? (
              <SelectiveSyncPage
                localPath={localPath}
                onBack={() => setView('project')}
                onSave={(patterns) => {
                    setIncludePatterns(patterns);
                    setView('project');
                    refreshStatus();
                }}
              />
            ) : view === 'files' ? (
              <FileBrowserPage
                projectId={selectedProject.id}
                localPath={localPath}
                onBack={() => setView('project')}
              />
            ) : view === 'conflicts' ? (
              <ConflictsPage
                conflicts={conflicts}
                onResolve={handleResolveConflicts}
                onCancel={() => {
                  setView('project');
                  setConflicts([]);
                }}
              />
            ) : (
              <div className="space-y-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h1 className="text-2xl font-bold">{selectedProject.name}</h1>
                    <div className="flex items-center gap-4 mt-1 text-muted-foreground">
                        <p>{selectedProject.lastSyncAt ? `Last synced ${formatRelativeTime(selectedProject.lastSyncAt)}` : 'Never synced'}</p>
                        <div className="flex items-center gap-1 bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-medium">
                            <GitBranch className="h-3 w-3" />
                            {currentBranch}
                        </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {isCreatingBranch ? (
                        <div className="flex gap-1 items-center bg-muted p-1 rounded-md">
                            <input 
                                autoFocus
                                className="bg-background border rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary w-32"
                                placeholder="Branch name..."
                                value={newBranchName}
                                onChange={(e) => setNewBranchName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleCreateBranch();
                                    if (e.key === 'Escape') setIsCreatingBranch(false);
                                }}
                            />
                            <Button size="sm" className="h-7 px-2" onClick={handleCreateBranch}>Save</Button>
                            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setIsCreatingBranch(false)}>Cancel</Button>
                        </div>
                    ) : (
                        <>
                            <select 
                                className="bg-background border rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
                                value={currentBranch}
                                onChange={(e) => {
                                    setCurrentBranch(e.target.value);
                                    setStatus(null); // Clear status when branch changes
                                }}
                            >
                                {branches.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                            <Button variant="outline" size="sm" onClick={() => setIsCreatingBranch(true)}>
                                <Plus className="h-4 w-4" />
                            </Button>
                        </>
                    )}
                    <Button variant="outline" onClick={() => setView('history')}>
                        <History className="mr-2 h-4 w-4" />
                        History
                    </Button>
                    <Button variant="outline" onClick={() => setView('files')}>
                        <Folder className="mr-2 h-4 w-4" />
                        Files
                    </Button>
                    <Button variant="outline" onClick={() => setView('selective')}>
                        <Filter className="mr-2 h-4 w-4" />
                        Selective Sync
                    </Button>
                  </div>
                </div>

                {/* Local folder selection */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Local Folder</CardTitle>
                    <CardDescription>
                      Select the local folder for this project
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-4">
                      <div className="flex-1 p-3 bg-muted rounded-lg font-mono text-sm truncate">
                        {localPath || 'No folder selected'}
                      </div>
                      <Button variant="outline" onClick={handleSelectProjectFolder}>
                        <FolderOpen className="mr-2 h-4 w-4" />
                        Browse
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Status */}
                {localPath && (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">Status</CardTitle>
                        <Button variant="ghost" size="sm" onClick={refreshStatus}>
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {status ? (
                        <div className="grid grid-cols-4 gap-4">
                          <div className="text-center">
                            <div className="text-2xl font-bold text-green-500">{status.added}</div>
                            <div className="text-xs text-muted-foreground">Added</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-yellow-500">{status.modified}</div>
                            <div className="text-xs text-muted-foreground">Modified</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-red-500">{status.deleted}</div>
                            <div className="text-xs text-muted-foreground">Deleted</div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-muted-foreground">{status.unchanged}</div>
                            <div className="text-xs text-muted-foreground">Unchanged</div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center text-muted-foreground py-4">
                          Click refresh to check status
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Auto Sync Toggle */}
                {localPath && (
                  <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border">
                    <div className="flex items-center gap-3">
                        <RefreshCw className={`h-5 w-5 ${autoSyncEnabled ? 'text-primary animate-spin-slow' : 'text-muted-foreground'}`} />
                        <div>
                            <div className="font-medium">Auto Sync</div>
                            <div className="text-xs text-muted-foreground">Automatically push changes to NAS when files are modified</div>
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                            type="checkbox" 
                            className="sr-only peer" 
                            checked={autoSyncEnabled}
                            onChange={(e) => setAutoSyncEnabled(e.target.checked)}
                        />
                        <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                    </label>
                  </div>
                )}

                {/* Sync progress */}
                {syncing && syncProgress && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">
                        {syncProgress.phase === 'scanning' && 'Scanning files...'}
                        {syncProgress.phase === 'comparing' && 'Comparing...'}
                        {syncProgress.phase === 'transferring' && 'Transferring files...'}
                        {syncProgress.phase === 'finalizing' && 'Finalizing...'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {syncProgress.currentFile && (
                        <div className="text-sm text-muted-foreground truncate">
                          {syncProgress.currentFile}
                        </div>
                      )}
                      <Progress
                        value={
                          syncProgress.totalBytes > 0
                            ? (syncProgress.bytesTransferred / syncProgress.totalBytes) * 100
                            : syncProgress.totalFiles > 0
                            ? (syncProgress.filesProcessed / syncProgress.totalFiles) * 100
                            : 0
                        }
                      />
                      <div className="text-xs text-muted-foreground">
                        {syncProgress.filesProcessed} / {syncProgress.totalFiles} files
                        {syncProgress.totalBytes > 0 && (
                          <> • {formatBytes(syncProgress.bytesTransferred)} / {formatBytes(syncProgress.totalBytes)}</>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Actions */}
                {localPath && !syncing && (
                  <div className="space-y-4">
                    {/* Commit Message Input */}
                    <div className="relative">
                        <MessageSquare className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input 
                            placeholder="Enter a message for this push (required)" 
                            className="pl-9" 
                            value={pushMessage}
                            onChange={(e) => setPushMessage(e.target.value)}
                        />
                    </div>

                    <div className="flex gap-4">
                        <Button 
                            onClick={handlePush} 
                            size="lg" 
                            className="flex-1"
                            disabled={!pushMessage.trim()}
                        >
                        <Upload className="mr-2 h-5 w-5" />
                        Push to NAS
                        </Button>
                        <Button onClick={handlePull} variant="outline" size="lg" className="flex-1">
                        <Download className="mr-2 h-5 w-5" />
                        Pull from NAS
                        </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              Select a project from the sidebar
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
