import React from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, HardDrive, File, Calendar, User, GitBranch } from 'lucide-react';
import { formatBytes, formatRelativeTime } from '@/lib/utils';

interface Snapshot {
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

interface HistoryPageProps {
  projectId: string;
  onBack: () => void;
  onRestore: (snapshotId: string) => void;
}

export function HistoryPage({ projectId, onBack, onRestore }: HistoryPageProps) {
  const [snapshots, setSnapshots] = React.useState<Snapshot[]>([]);
  const [branches, setBranches] = React.useState<string[]>(['main']);
  const [selectedBranch, setSelectedBranch] = React.useState<string>(''); // empty means all
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function loadBranches() {
        const projectBranches = await window.api.getBranches(projectId);
        setBranches(projectBranches);
    }
    loadBranches();
  }, [projectId]);

  React.useEffect(() => {
    async function fetchHistory() {
      try {
        setLoading(true);
        const projectSnapshots = await window.api.getSnapshots(projectId, selectedBranch || undefined);
        setSnapshots(projectSnapshots);
      } catch (error) {
        console.error('Failed to fetch history:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
  }, [projectId, selectedBranch]);

  return (
    <div className="h-full flex flex-col">
      <div className="mb-6 flex justify-between items-start">
        <div>
            <Button variant="ghost" size="sm" onClick={onBack} className="mb-4 pl-0 hover:bg-transparent hover:text-primary">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Project
            </Button>
            <h1 className="text-2xl font-bold">Snapshot History</h1>
            <p className="text-muted-foreground">Browse and restore previous versions of your project.</p>
        </div>

        <div className="flex items-center gap-2 mt-10">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <select 
                className="bg-background border rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary min-w-[120px]"
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
            >
                <option value="">All Branches</option>
                {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto pr-2">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading history...</div>
        ) : snapshots.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No snapshots found for this project.</div>
        ) : (
          <div className="space-y-4">
            {snapshots.map((snapshot) => (
              <div key={snapshot.id} className="p-4 rounded-lg border bg-card text-card-foreground hover:bg-muted/50 transition-colors">
                <div className="flex justify-between items-start gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-lg">{snapshot.message}</h3>
                        <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded font-mono uppercase tracking-wider">
                            {snapshot.branch}
                        </span>
                    </div>
                    
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatRelativeTime(snapshot.createdAt)}
                        </div>
                        <div className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {snapshot.createdBy}
                        </div>
                        <div className="flex items-center gap-1">
                            <File className="h-3 w-3" />
                            {snapshot.fileCount} files
                        </div>
                        <div className="flex items-center gap-1">
                            <HardDrive className="h-3 w-3" />
                            {formatBytes(snapshot.totalSize)}
                        </div>
                    </div>
                  </div>
                  
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => onRestore(snapshot.id)}
                  >
                    Restore
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}