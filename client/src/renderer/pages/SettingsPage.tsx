import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatBytes } from '@/lib/utils';
import { ArrowLeft, Trash2, CheckCircle, FolderOpen } from 'lucide-react';

interface SettingsPageProps {
  onBack: () => void;
  onNasPathChange: () => void;
}

export function SettingsPage({ onBack, onNasPathChange }: SettingsPageProps) {
  const [gcResult, setGcResult] = useState<{ deletedCount: number; deletedSize: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [nasPath, setNasPath] = useState<string>('');

  React.useEffect(() => {
    window.api.getConfig().then(config => setNasPath(config.nasPath || ''));
  }, []);

  const handleChangeNasFolder = async () => {
    const path = await window.api.selectNasFolder();
    if (path) {
      await window.api.setNasPath(path);
      setNasPath(path);
      onNasPathChange();
    }
  };

  const handleRunGC = async () => {
    if (!confirm('This will permanently delete unused files from the NAS. Are you sure?')) {
      return;
    }

    setLoading(true);
    setGcResult(null);
    try {
      const result = await window.api.runGC();
      setGcResult(result);
    } catch (error) {
      alert(`Garbage collection failed: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="pl-0 hover:bg-transparent hover:text-primary">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
        </Button>
        <h1 className="text-2xl font-bold">Settings & Maintenance</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            NAS Configuration
          </CardTitle>
          <CardDescription>
            Change the location of your NetworkSync data folder on the network.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-center">
            <div className="flex-1 p-3 bg-muted rounded-lg font-mono text-sm truncate">
              {nasPath || 'No folder selected'}
            </div>
            <Button variant="outline" onClick={handleChangeNasFolder}>
              Change Folder
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5" />
            Storage Maintenance
          </CardTitle>
          <CardDescription>
            Clean up orphaned files and reclaim space on your NAS.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Garbage collection scans the NAS storage and removes any files that are not referenced by any project snapshot. 
              This is safe to run periodically to save disk space.
            </p>
            
            <Button 
                variant="destructive" 
                onClick={handleRunGC} 
                disabled={loading}
            >
                {loading ? 'Cleaning...' : 'Run Garbage Collection'}
            </Button>

            {gcResult && (
                <div className="mt-4 p-4 bg-green-500/10 border border-green-500/20 rounded-md flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                    <div>
                        <h4 className="font-semibold text-green-700">Cleanup Complete</h4>
                        <p className="text-sm text-green-600">
                            Removed {gcResult.deletedCount} files, reclaiming {formatBytes(gcResult.deletedSize)} of space.
                        </p>
                    </div>
                </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
