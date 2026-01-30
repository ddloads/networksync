import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { scanDirectory, buildManifest } from '../src/scanner';

const TEST_DIR = join(process.cwd(), 'test-data-scanner');

describe('Scanner', () => {
  before(async () => {
    // Setup test directory structure
    await mkdir(TEST_DIR, { recursive: true });
    await mkdir(join(TEST_DIR, 'src'), { recursive: true });
    await mkdir(join(TEST_DIR, 'dist'), { recursive: true }); // Should be ignored if we configure it
    
    await writeFile(join(TEST_DIR, 'root.txt'), 'root content');
    await writeFile(join(TEST_DIR, 'src/main.ts'), 'console.log("hello")');
    await writeFile(join(TEST_DIR, 'dist/bundle.js'), 'bundle content');
  });

  after(async () => {
    // Cleanup
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('should scan directory recursively', async () => {
    const result = await scanDirectory(TEST_DIR);
    
    assert.strictEqual(result.fileCount, 3);
    
    const paths = result.entries.map(f => f.path).sort();
    assert.deepStrictEqual(paths, ['dist/bundle.js', 'root.txt', 'src/main.ts']);
  });

  it('should respect ignore patterns', async () => {
    // Create a .syncignore file
    await writeFile(join(TEST_DIR, '.syncignore'), 'dist/');
    
    const result = await scanDirectory(TEST_DIR);
    
    // Should exclude dist/bundle.js but include .syncignore
    const paths = result.entries.map(f => f.path).sort();
    
    assert.ok(paths.includes('root.txt'));
    assert.ok(paths.includes('src/main.ts'));
    assert.ok(paths.includes('.syncignore'));
    assert.ok(!paths.includes('dist/bundle.js'));
  });

  it('should build a valid manifest', async () => {
    const scanResult = await scanDirectory(TEST_DIR);
    const manifest = buildManifest('test-project-id', scanResult);
    
    assert.strictEqual(manifest.projectId, 'test-project-id');
    assert.strictEqual(manifest.entries.length, scanResult.fileCount);
    
    // Check root hash calculation (deterministic)
    assert.ok(manifest.rootHash);
    assert.ok(manifest.rootHash.length > 0);
  });
});
