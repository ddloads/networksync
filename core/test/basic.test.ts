import { describe, it } from 'node:test';
import assert from 'node:assert';
import { hashBuffer } from '../src/hasher';
import { createIgnoreMatcher, DEFAULT_UNREAL_IGNORE_PATTERNS } from '../src/ignore';

describe('Hasher', () => {
  it('should correctly hash a buffer', () => {
    const buffer = Buffer.from('hello world');
    // SHA-256 of "hello world"
    const expected = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
    const result = hashBuffer(buffer);
    assert.strictEqual(result, expected);
  });
});

describe('Ignore Matcher', () => {
  it('should ignore default patterns', () => {
    const matcher = createIgnoreMatcher(['node_modules/']);
    assert.strictEqual(matcher.ignores('node_modules/package.json'), true);
    assert.strictEqual(matcher.ignores('src/index.ts'), false);
  });

  it('should handle Unreal Engine patterns', () => {
    const matcher = createIgnoreMatcher(DEFAULT_UNREAL_IGNORE_PATTERNS);
    
    // Should ignore
    assert.strictEqual(matcher.ignores('Binaries/Win64/Game.exe'), true);
    assert.strictEqual(matcher.ignores('Intermediate/Build/'), true);
    assert.strictEqual(matcher.ignores('Saved/Config/Windows/Game.ini'), true);
    assert.strictEqual(matcher.ignores('MyProject.sln'), true);
    
    // Should NOT ignore
    assert.strictEqual(matcher.ignores('Content/Characters/Hero.uasset'), false);
    assert.strictEqual(matcher.ignores('Source/MyGame/MyGame.cpp'), false);
    assert.strictEqual(matcher.ignores('MyProject.uproject'), false);
  });

  it('should filter paths correctly', () => {
    const matcher = createIgnoreMatcher(['*.log']);
    const paths = ['file.txt', 'error.log', 'src/main.ts', 'debug.log'];
    const filtered = matcher.filter(paths);
    
    assert.deepStrictEqual(filtered, ['file.txt', 'src/main.ts']);
  });
});