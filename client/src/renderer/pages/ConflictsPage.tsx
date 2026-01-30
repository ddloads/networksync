import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatBytes, formatRelativeTime } from '@/lib/utils';
import { AlertTriangle, Check, Copy } from 'lucide-react';

interface Conflict {
  path: string;
  localEntry: {
    size: number;
    modifiedAt: Date;
  };
  remoteEntry: {
    size: number;
    modifiedAt: Date;
  };
}

interface ConflictResolution {
  path: string;
  resolution: 'keep_local' | 'keep_remote' | 'keep_both';
}

interface ConflictsPageProps {
  conflicts: Conflict[];
  onResolve: (resolutions: ConflictResolution[]) => void;
  onCancel: () => void;
}

export function ConflictsPage({ conflicts, onResolve, onCancel }: ConflictsPageProps) {
  const [resolutions, setResolutions] = useState<Record<string, 'keep_local' | 'keep_remote' | 'keep_both'>>({});

  // Initialize with 'keep_local' (or no selection)
  React.useEffect(() => {
    const initial: Record<string, 'keep_local' | 'keep_remote' | 'keep_both'> = {};
    conflicts.forEach(c => {
        initial[c.path] = 'keep_local'; // Default to local for safety? Or maybe force user to choose?
    });
    setResolutions(initial);
  }, [conflicts]);

  const handleSetResolution = (path: string, resolution: 'keep_local' | 'keep_remote' | 'keep_both') => {
    setResolutions(prev => ({ ...prev, [path]: resolution }));
  };

  const handleResolveAll = (resolution: 'keep_local' | 'keep_remote') => {
    const newResolutions: Record<string, 'keep_local' | 'keep_remote' | 'keep_both'> = {};
    conflicts.forEach(c => {
        newResolutions[c.path] = resolution;
    });
    setResolutions(newResolutions);
  };

  const handleSubmit = () => {
    const finalResolutions: ConflictResolution[] = Object.entries(resolutions).map(([path, res]) => ({
        path,
        resolution: res
    }));
    onResolve(finalResolutions);
  };

  return (
    <div className="h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="text-yellow-500 h-6 w-6" />
            Resolve Conflicts
        </h1>
        <Button variant="ghost" onClick={onCancel}>Cancel Sync</Button>
      </div>
      
      <p className="text-muted-foreground">
        The following files have been modified both locally and on the server since the last sync. 
        Please choose which version to keep.
      </p>

      <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => handleResolveAll('keep_local')}>
              Keep All Local
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleResolveAll('keep_remote')}>
              Keep All Remote
          </Button>
      </div>

      <div className="flex-1 overflow-y-auto border rounded-md">
        <div className="divide-y">
            {conflicts.map(conflict => (
                <div key={conflict.path} className="p-4 hover:bg-muted/30">
                    <div className="font-medium mb-2">{conflict.path}</div>
                    <div className="flex gap-4 items-stretch">
                        {/* Local Version */}
                        <div 
                            className={`flex-1 border rounded p-3 cursor-pointer transition-colors ${resolutions[conflict.path] === 'keep_local' ? 'bg-primary/10 border-primary' : 'hover:bg-muted'}`}
                            onClick={() => handleSetResolution(conflict.path, 'keep_local')}
                        >
                            <div className="flex justify-between items-start">
                                <span className="font-semibold text-sm">Local Version</span>
                                {resolutions[conflict.path] === 'keep_local' && <Check className="h-4 w-4 text-primary" />}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                                <div>Size: {formatBytes(conflict.localEntry.size)}</div>
                                <div>Modified: {formatRelativeTime(conflict.localEntry.modifiedAt)}</div>
                            </div>
                        </div>

                        {/* Remote Version */}
                        <div 
                            className={`flex-1 border rounded p-3 cursor-pointer transition-colors ${resolutions[conflict.path] === 'keep_remote' ? 'bg-primary/10 border-primary' : 'hover:bg-muted'}`}
                            onClick={() => handleSetResolution(conflict.path, 'keep_remote')}
                        >
                            <div className="flex justify-between items-start">
                                <span className="font-semibold text-sm">Remote Version</span>
                                {resolutions[conflict.path] === 'keep_remote' && <Check className="h-4 w-4 text-primary" />}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                                <div>Size: {formatBytes(conflict.remoteEntry.size)}</div>
                                <div>Modified: {formatRelativeTime(conflict.remoteEntry.modifiedAt)}</div>
                            </div>
                        </div>

                         {/* Keep Both */}
                         <div 
                            className={`flex-0 w-32 border rounded p-3 cursor-pointer transition-colors flex flex-col items-center justify-center text-center ${resolutions[conflict.path] === 'keep_both' ? 'bg-primary/10 border-primary' : 'hover:bg-muted'}`}
                            onClick={() => handleSetResolution(conflict.path, 'keep_both')}
                        >
                            <Copy className="h-4 w-4 mb-1" />
                            <span className="text-sm">Keep Both</span>
                            <span className="text-[10px] text-muted-foreground">(Rename Local)</span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
      </div>

      <div className="pt-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleSubmit}>Resolve & Continue</Button>
      </div>
    </div>
  );
}
