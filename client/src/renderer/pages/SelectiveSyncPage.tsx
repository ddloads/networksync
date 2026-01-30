import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Save, Plus, X, Folder, Info } from 'lucide-react';

interface SelectiveSyncPageProps {
  localPath: string;
  onBack: () => void;
  onSave: (patterns: string[]) => void;
}

export function SelectiveSyncPage({ localPath, onBack, onSave }: SelectiveSyncPageProps) {
  const [patterns, setPatterns] = useState<string[]>([]);
  const [newPattern, setNewPattern] = useState('');
  const [suggestedFolders, setSuggestedFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConfig();
  }, [localPath]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const savedPatterns = await window.api.getSelectiveSync(localPath);
      setPatterns(savedPatterns);

      // Scan project to find top-level folders as suggestions
      const files = await window.api.scanProject(localPath);
      const folders = Array.from(new Set(
          files
            .filter(f => f.isDirectory || f.path.includes('/'))
            .map(f => f.path.split('/')[0] + '/')
      )).sort();
      setSuggestedFolders(folders);
    } catch (error) {
      console.error('Failed to load selective sync config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddPattern = (pattern: string) => {
    const trimmed = pattern.trim();
    if (trimmed && !patterns.includes(trimmed)) {
      setPatterns([...patterns, trimmed]);
    }
    setNewPattern('');
  };

  const handleRemovePattern = (index: number) => {
    setPatterns(patterns.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    const success = await window.api.setSelectiveSync(localPath, patterns);
    if (success) {
      onSave(patterns);
    } else {
      alert('Failed to save settings.');
    }
  };

  return (
    <div className="h-full flex flex-col space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onBack} className="pl-0 hover:bg-transparent hover:text-primary">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
            </Button>
            <h1 className="text-2xl font-bold">Selective Sync</h1>
        </div>
        <Button onClick={handleSave} className="gap-2">
            <Save className="h-4 w-4" />
            Save Settings
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 overflow-hidden">
        <div className="flex flex-col space-y-4 overflow-hidden">
            <Card className="flex flex-col overflow-hidden">
                <CardHeader>
                    <CardTitle className="text-lg">Active Sync Patterns</CardTitle>
                    <CardDescription>
                        Only files matching these patterns will be downloaded. 
                        Use glob syntax (e.g., <code>Content/**</code>).
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col space-y-4 overflow-hidden">
                    <div className="flex gap-2">
                        <Input 
                            placeholder="e.g. Content/**" 
                            value={newPattern}
                            onChange={(e) => setNewPattern(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddPattern(newPattern)}
                        />
                        <Button variant="outline" size="icon" onClick={() => handleAddPattern(newPattern)}>
                            <Plus className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="flex-1 overflow-y-auto border rounded-md divide-y">
                        {patterns.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground text-sm">
                                No selective patterns set. Syncing ALL files.
                            </div>
                        ) : (
                            patterns.map((p, i) => (
                                <div key={i} className="flex items-center justify-between p-2 hover:bg-muted/50 group">
                                    <code className="text-sm">{p}</code>
                                    <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive"
                                        onClick={() => handleRemovePattern(i)}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>

        <div className="flex flex-col space-y-4 overflow-hidden">
            <Card className="flex flex-col overflow-hidden">
                <CardHeader>
                    <CardTitle className="text-lg">Suggested Folders</CardTitle>
                    <CardDescription>
                        Top-level folders found in your project. Click to add.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto">
                    <div className="grid grid-cols-1 gap-2">
                        {suggestedFolders.map(folder => (
                            <button
                                key={folder}
                                className="flex items-center gap-2 p-2 text-sm text-left hover:bg-muted rounded-md transition-colors border border-transparent hover:border-primary/20"
                                onClick={() => handleAddPattern(folder + '**')}
                            >
                                <Folder className="h-4 w-4 text-blue-500" />
                                <span>{folder}</span>
                            </button>
                        ))}
                        {suggestedFolders.length === 0 && !loading && (
                            <div className="text-center text-muted-foreground py-8 text-sm">
                                No folders detected yet. Try syncing once.
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            <div className="bg-blue-500/5 border border-blue-500/20 p-4 rounded-lg flex gap-3">
                <Info className="h-5 w-5 text-blue-500 flex-shrink-0" />
                <div className="text-sm text-blue-700">
                    <p className="font-semibold">How it works:</p>
                    <p className="mt-1">
                        Selective sync only affects <strong>downloads</strong> (pull/restore). 
                        All your local changes will still be pushed to the NAS manifest to maintain project integrity.
                    </p>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}
