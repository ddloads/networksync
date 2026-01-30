/**
 * SQLite database wrapper for NetworkSync using sql.js (no native dependencies)
 * Database is stored on NAS and accessed directly by clients
 */

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import type { Project, Snapshot, FileEntry, FileLock } from './types';

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function getSqlJs() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

export class NetworkSyncDb {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;
  private dirty: boolean = false;

  constructor(nasPath: string) {
    this.dbPath = join(nasPath, 'sync.db');
  }

  async initialize(): Promise<void> {
    const SqlJs = await getSqlJs();

    // Ensure directory exists
    await mkdir(dirname(this.dbPath), { recursive: true });

    // Load existing database or create new one
    if (existsSync(this.dbPath)) {
      const buffer = await readFile(this.dbPath);
      this.db = new SqlJs.Database(buffer);
    } else {
      this.db = new SqlJs.Database();
    }

    this.createTables();
  }

  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_sync_at TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        manifest_hash TEXT NOT NULL,
        file_count INTEGER NOT NULL,
        total_size INTEGER NOT NULL,
        branch TEXT NOT NULL DEFAULT 'main',
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    // Migration: Add branch column to snapshots if it doesn't exist
    try {
      this.db.run("ALTER TABLE snapshots ADD COLUMN branch TEXT NOT NULL DEFAULT 'main'");
    } catch (e) {
      // Column probably already exists, ignore error
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS branches (
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, name),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS file_entries (
        snapshot_id TEXT NOT NULL,
        path TEXT NOT NULL,
        hash TEXT NOT NULL,
        size INTEGER NOT NULL,
        modified_at TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, path),
        FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS file_locks (
        project_id TEXT NOT NULL,
        path TEXT NOT NULL,
        machine_name TEXT NOT NULL,
        locked_at TEXT NOT NULL,
        PRIMARY KEY (project_id, path)
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_project ON snapshots(project_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created_at)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_file_entries_hash ON file_entries(hash)`);

    this.dirty = true;
    this.save();
  }

  async save(): Promise<void> {
    if (!this.db || !this.dirty) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    await writeFile(this.dbPath, buffer);
    this.dirty = false;
  }

  // Project operations
  createProject(project: Project): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO projects (id, name, created_at, last_sync_at) VALUES (?, ?, ?, ?)`,
      [
        project.id,
        project.name,
        project.createdAt.toISOString(),
        project.lastSyncAt?.toISOString() ?? null,
      ]
    );
    this.dirty = true;
    this.save();
  }

  getProject(id: string): Project | null {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM projects WHERE id = ?');
    stmt.bind([id]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.mapProject(row);
    }
    stmt.free();
    return null;
  }

  getAllProjects(): Project[] {
    if (!this.db) throw new Error('Database not initialized');

    const results: Project[] = [];
    const stmt = this.db.prepare('SELECT * FROM projects ORDER BY name');

    while (stmt.step()) {
      results.push(this.mapProject(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  updateProject(
    id: string,
    updates: Partial<Pick<Project, 'name' | 'lastSyncAt'>>
  ): void {
    if (!this.db) throw new Error('Database not initialized');

    const fields: string[] = [];
    const values: (string | null)[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.lastSyncAt !== undefined) {
      fields.push('last_sync_at = ?');
      values.push(updates.lastSyncAt?.toISOString() ?? null);
    }

    if (fields.length === 0) return;

    values.push(id);
    this.db.run(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, values);
    this.dirty = true;
    this.save();
  }

  deleteProject(id: string): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run('DELETE FROM projects WHERE id = ?', [id]);
    this.dirty = true;
    this.save();
  }

  // Snapshot operations
  createSnapshot(snapshot: Snapshot, entries: FileEntry[]): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(
      `INSERT INTO snapshots (id, project_id, message, created_at, created_by, manifest_hash, file_count, total_size, branch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshot.id,
        snapshot.projectId,
        snapshot.message,
        snapshot.createdAt.toISOString(),
        snapshot.createdBy,
        snapshot.manifestHash,
        snapshot.fileCount,
        snapshot.totalSize,
        snapshot.branch || 'main',
      ]
    );

    // Ensure branch exists in branches table
    this.createBranch(snapshot.projectId, snapshot.branch || 'main');

    for (const entry of entries) {
      this.db.run(
        `INSERT INTO file_entries (snapshot_id, path, hash, size, modified_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          snapshot.id,
          entry.path,
          entry.hash,
          entry.size,
          entry.modifiedAt.toISOString(),
        ]
      );
    }

    this.dirty = true;
    this.save();
  }

  getSnapshot(id: string): Snapshot | null {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM snapshots WHERE id = ?');
    stmt.bind([id]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.mapSnapshot(row);
    }
    stmt.free();
    return null;
  }

  getProjectSnapshots(projectId: string, branch?: string, limit?: number): Snapshot[] {
    if (!this.db) throw new Error('Database not initialized');

    const results: Snapshot[] = [];
    let query = 'SELECT * FROM snapshots WHERE project_id = ?';
    const params: (string | number)[] = [projectId];

    if (branch) {
      query += ' AND branch = ?';
      params.push(branch);
    }

    query += ' ORDER BY created_at DESC';

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }

    const stmt = this.db.prepare(query);
    stmt.bind(params);

    while (stmt.step()) {
      results.push(this.mapSnapshot(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  getLatestSnapshot(projectId: string, branch: string = 'main'): Snapshot | null {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(
      'SELECT * FROM snapshots WHERE project_id = ? AND branch = ? ORDER BY created_at DESC LIMIT 1'
    );
    stmt.bind([projectId, branch]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.mapSnapshot(row);
    }
    stmt.free();
    return null;
  }

  // Branch operations
  createBranch(projectId: string, name: string): void {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.run(
        'INSERT OR IGNORE INTO branches (project_id, name, created_at) VALUES (?, ?, ?)',
        [projectId, name, new Date().toISOString()]
      );
      this.dirty = true;
      this.save();
    } catch (error) {
      // Ignore
    }
  }

  getProjectBranches(projectId: string): string[] {
    if (!this.db) throw new Error('Database not initialized');

    const results: string[] = [];
    const stmt = this.db.prepare('SELECT name FROM branches WHERE project_id = ? ORDER BY name');
    stmt.bind([projectId]);

    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push(row.name as string);
    }
    stmt.free();

    if (results.length === 0) {
      return ['main'];
    }
    return results;
  }

  getSnapshotEntries(snapshotId: string): FileEntry[] {
    if (!this.db) throw new Error('Database not initialized');

    const results: FileEntry[] = [];
    const stmt = this.db.prepare('SELECT * FROM file_entries WHERE snapshot_id = ?');
    stmt.bind([snapshotId]);

    while (stmt.step()) {
      results.push(this.mapFileEntry(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  deleteSnapshot(id: string): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run('DELETE FROM file_entries WHERE snapshot_id = ?', [id]);
    this.db.run('DELETE FROM snapshots WHERE id = ?', [id]);
    this.dirty = true;
    this.save();
  }

  // Check if a file hash exists in any snapshot
  isHashInUse(hash: string): boolean {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT 1 FROM file_entries WHERE hash = ? LIMIT 1');
    stmt.bind([hash]);
    const exists = stmt.step();
    stmt.free();
    return exists;
  }

  // Get all unique hashes for a project
  getProjectHashes(projectId: string): string[] {
    if (!this.db) throw new Error('Database not initialized');

    const results: string[] = [];
    const stmt = this.db.prepare(`
      SELECT DISTINCT fe.hash
      FROM file_entries fe
      JOIN snapshots s ON fe.snapshot_id = s.id
      WHERE s.project_id = ?
    `);
    stmt.bind([projectId]);

    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push(row.hash as string);
    }
    stmt.free();
    return results;
  }

  // Get all unique hashes referenced by ANY snapshot in the database
  getAllReferencedHashes(): Set<string> {
    if (!this.db) throw new Error('Database not initialized');

    const hashes = new Set<string>();
    const stmt = this.db.prepare('SELECT DISTINCT hash FROM file_entries');

    while (stmt.step()) {
      const row = stmt.getAsObject();
      hashes.add(row.hash as string);
    }
    stmt.free();
    return hashes;
  }

  // File Locking operations
  acquireFileLock(projectId: string, path: string, machineName: string): boolean {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.run(
        `INSERT INTO file_locks (project_id, path, machine_name, locked_at) VALUES (?, ?, ?, ?)`,
        [projectId, path, machineName, new Date().toISOString()]
      );
      this.dirty = true;
      this.save();
      return true;
    } catch (error) {
      // Constraint violation (already locked)
      return false;
    }
  }

  releaseFileLock(projectId: string, path: string, machineName: string): boolean {
    if (!this.db) throw new Error('Database not initialized');

    // Only allow releasing if held by the same machine
    const stmt = this.db.prepare(
      'SELECT machine_name FROM file_locks WHERE project_id = ? AND path = ?'
    );
    stmt.bind([projectId, path]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      if (row.machine_name !== machineName) {
        return false; // Lock held by someone else
      }
    } else {
      stmt.free();
      return true; // Not locked, so "released"
    }

    this.db.run(
      'DELETE FROM file_locks WHERE project_id = ? AND path = ?',
      [projectId, path]
    );
    this.dirty = true;
    this.save();
    return true;
  }

  getFileLocks(projectId: string): FileLock[] {
    if (!this.db) throw new Error('Database not initialized');

    const results: FileLock[] = [];
    const stmt = this.db.prepare('SELECT * FROM file_locks WHERE project_id = ?');
    stmt.bind([projectId]);

    while (stmt.step()) {
      results.push(this.mapFileLock(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  getFileLock(projectId: string, path: string): FileLock | null {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(
      'SELECT * FROM file_locks WHERE project_id = ? AND path = ?'
    );
    stmt.bind([projectId, path]);

    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.mapFileLock(row);
    }
    stmt.free();
    return null;
  }

  // Helper methods
  private mapProject(row: Record<string, unknown>): Project {
    return {
      id: row.id as string,
      name: row.name as string,
      createdAt: new Date(row.created_at as string),
      lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at as string) : null,
    };
  }

  private mapSnapshot(row: Record<string, unknown>): Snapshot {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      message: row.message as string,
      createdAt: new Date(row.created_at as string),
      createdBy: row.created_by as string,
      manifestHash: row.manifest_hash as string,
      fileCount: row.file_count as number,
      totalSize: row.total_size as number,
      branch: row.branch as string,
    };
  }

  private mapFileEntry(row: Record<string, unknown>): FileEntry {
    return {
      path: row.path as string,
      hash: row.hash as string,
      size: row.size as number,
      modifiedAt: new Date(row.modified_at as string),
      isDirectory: false,
    };
  }

  private mapFileLock(row: Record<string, unknown>): FileLock {
    return {
      projectId: row.project_id as string,
      path: row.path as string,
      machineName: row.machine_name as string,
      lockedAt: new Date(row.locked_at as string),
    };
  }

  close(): void {
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
    }
  }
}
