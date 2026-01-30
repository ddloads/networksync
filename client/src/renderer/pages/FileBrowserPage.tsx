import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock, Unlock, Search, File, Folder, RefreshCw, ArrowLeft } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';

interface FileEntry {
  path: string;
  isDirectory: boolean;
}

interface FileLock {
  projectId: string;
  path: string;
  machineName: string;
  lockedAt: Date;
}

interface FileBrowserPageProps {
  projectId: string;
  localPath: string;
  onBack: () => void;
}

export function FileBrowserPage({ projectId, localPath, onBack }: FileBrowserPageProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [locks, setLocks] = useState<FileLock[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [config, setConfig] = useState<{ machineName: string } | null>(null);

  useEffect(() => {
    loadData();
    window.api.getConfig().then(setConfig);
  }, [projectId, localPath]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [fileList, lockList] = await Promise.all([
        window.api.scanProject(localPath),
        window.api.getFileLocks(projectId)
      ]);
      setFiles(fileList);
      setLocks(lockList);
    } catch (error) {
      console.error('Failed to load files:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLock = async (path: string) => {
    try {
      const success = await window.api.lockFile(projectId, path);
      if (success) {
        await loadData(); // Refresh locks
      } else {
        alert('Failed to lock file. It might be locked by someone else.');
      }
    } catch (error) {
      console.error('Lock failed:', error);
    }
  };

  const handleUnlock = async (path: string) => {
    try {
      const success = await window.api.unlockFile(projectId, path);
      if (success) {
        await loadData();
      } else {
        alert('Failed to unlock file.');
      }
    } catch (error) {
      console.error('Unlock failed:', error);
    }
  };

  const filteredFiles = files.filter(f => 
    f.path.toLowerCase().includes(search.toLowerCase())
  );

  const getLockForFile = (path: string) => locks.find(l => l.path === path);

  return (
    <div className="h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} className="pl-0 hover:bg-transparent hover:text-primary">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
            </Button>
            <h1 className="text-2xl font-bold">Project Files</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input 
            placeholder="Search files..." 
            className="pl-8" 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-y-auto border rounded-md bg-card">
        {loading ? (
            <div className="flex justify-center items-center h-full text-muted-foreground">
                Loading files...
            </div>
        ) : filteredFiles.length === 0 ? (
            <div className="flex justify-center items-center h-full text-muted-foreground">
                No files found.
            </div>
        ) : (
            <div className="divide-y">
                {filteredFiles.map(file => {
                    const lock = getLockForFile(file.path);
                    const isLockedByMe = lock?.machineName === config?.machineName;
                    
                    return (
                        <div key={file.path} className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors">
                            <div className="flex items-center gap-3 overflow-hidden">
                                {file.isDirectory ? <Folder className="h-4 w-4 text-blue-500" /> : <File className="h-4 w-4 text-muted-foreground" />}
                                <span className="truncate" title={file.path}>{file.path}</span>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                                {lock ? (
                                    <div className={`flex items-center gap-2 text-xs px-2 py-1 rounded-full ${isLockedByMe ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
                                        <Lock className="h-3 w-3" />
                                        <span>{isLockedByMe ? 'You' : lock.machineName}</span>
                                        <span className="text-muted-foreground hidden sm:inline">
                                            ({formatRelativeTime(new Date(lock.lockedAt))})
                                        </span>
                                        {isLockedByMe && (
                                            <Button variant="ghost" size="icon" className="h-5 w-5 ml-1 hover:bg-transparent hover:text-red-500" onClick={() => handleUnlock(file.path)}>
                                                <Unlock className="h-3 w-3" />
                                            </Button>
                                        )}
                                    </div>
                                ) : (
                                    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-primary" onClick={() => handleLock(file.path)}>
                                        Lock
                                    </Button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        )}
      </div>
    </div>
  );
}
