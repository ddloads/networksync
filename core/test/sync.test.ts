import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SyncEngine } from '../src/sync';

const TEST_ROOT = join(process.cwd(), 'test-data-sync');
const NAS_PATH = join(TEST_ROOT, 'nas');
const LOCAL_PATH_A = join(TEST_ROOT, 'client-a');
const LOCAL_PATH_B = join(TEST_ROOT, 'client-b');

describe('SyncEngine Integration', () => {
  let engine: SyncEngine;
  let projectId: string;

  before(async () => {
    // Setup environment
    await mkdir(TEST_ROOT, { recursive: true });
    await mkdir(NAS_PATH, { recursive: true });
    await mkdir(LOCAL_PATH_A, { recursive: true });
    await mkdir(LOCAL_PATH_B, { recursive: true });

    engine = new SyncEngine(NAS_PATH);
    await engine.initialize();
  });

  after(async () => {
    engine.close();
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('should create a project', () => {
    const project = engine.createProject('Test Project');
    projectId = project.id;
    assert.ok(projectId);
    assert.strictEqual(project.name, 'Test Project');
  });

  it('should push files from client A', async () => {
    // Create files in Client A
    await writeFile(join(LOCAL_PATH_A, 'file1.txt'), 'content 1');
    await writeFile(join(LOCAL_PATH_A, 'file2.txt'), 'content 2');
    
    const project = engine.getProject(projectId);
    if (!project) throw new Error('Project not found');

    const result = await engine.push(project, LOCAL_PATH_A, 'MachineA', 'Initial Commit');
    
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.filesAdded, 2);
    assert.ok(result.snapshot);
  });

  it('should pull files to client B', async () => {
    const project = engine.getProject(projectId);
    if (!project) throw new Error('Project not found');

    const result = await engine.pull(project, LOCAL_PATH_B, 'MachineB');
    
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.filesDownloaded, 2);
    
    // Verify files exist
    const content1 = await readFile(join(LOCAL_PATH_B, 'file1.txt'), 'utf8');
    assert.strictEqual(content1, 'content 1');
  });

  it('should handle modifications', async () => {
    // Modify file in Client A
    await writeFile(join(LOCAL_PATH_A, 'file1.txt'), 'content 1 modified');
    
    const project = engine.getProject(projectId);
    if (!project) throw new Error('Project not found');

    // Push from A
    const pushResult = await engine.push(project, LOCAL_PATH_A, 'MachineA', 'Update file1');
    if (!pushResult.success) throw new Error(`Push failed: ${pushResult.error}`);
    assert.strictEqual(pushResult.success, true);
    assert.strictEqual(pushResult.filesModified, 1);
    
    // Pull to B
    const pullResult = await engine.pull(project, LOCAL_PATH_B, 'MachineB');
    if (!pullResult.success) console.error('Pull failed:', pullResult.error);
    assert.strictEqual(pullResult.success, true);
    
    const content1 = await readFile(join(LOCAL_PATH_B, 'file1.txt'), 'utf8');
    assert.strictEqual(content1, 'content 1 modified');
  });
  
  it('should handle large number of files (concurrency check)', async () => {
      // Create 30 files to trigger concurrency > 20
      for (let i = 0; i < 30; i++) {
          await writeFile(join(LOCAL_PATH_A, `bulk-${i}.txt`), `bulk content ${i}`);
      }
      
      const project = engine.getProject(projectId);
      if (!project) throw new Error('Project not found');

      // Push from A
      const pushResult = await engine.push(project, LOCAL_PATH_A, 'MachineA', 'Bulk add');
      if (!pushResult.success) throw new Error(`Bulk push failed: ${pushResult.error}`);
      assert.strictEqual(pushResult.success, true);
      assert.strictEqual(pushResult.filesAdded, 30);
      
      // Pull to B
      const pullResult = await engine.pull(project, LOCAL_PATH_B, 'MachineB');
      if (!pullResult.success) console.error('Bulk pull failed:', pullResult.error);
      assert.strictEqual(pullResult.success, true);
      assert.strictEqual(pullResult.filesDownloaded, 30);
  });
});
