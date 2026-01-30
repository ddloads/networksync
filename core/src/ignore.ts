/**
 * .syncignore file parser and matcher
 * Uses the same syntax as .gitignore
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ignoreModule from 'ignore';

// Default patterns for Unreal Engine projects
export const DEFAULT_UNREAL_IGNORE_PATTERNS = [
  // Build outputs
  'Binaries/',
  'Intermediate/',
  'DerivedDataCache/',
  'Saved/',

  // IDE files
  '.vs/',
  '.vscode/',
  '.idea/',
  '*.sln',
  '*.suo',
  '*.opensdf',
  '*.sdf',
  '*.VC.db',
  '*.VC.opendb',

  // System files
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',

  // Logs
  '*.log',

  // Temporary files
  '*.tmp',
  '*.temp',
  '~*',
];

// Default patterns for general projects
export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules/',
  '.git/',
  '.sync/',
  '.DS_Store',
  'Thumbs.db',
  '*.log',
  '*.tmp',
];

export interface IgnoreMatcher {
  ignores(path: string): boolean;
  filter(paths: string[]): string[];
  add(patterns: string[]): void;
}

/**
 * Create an ignore matcher from patterns
 */
export function createIgnoreMatcher(patterns: string[] = []): IgnoreMatcher {
  const ig = ignoreModule().add(patterns);

  return {
    ignores(path: string): boolean {
      // Normalize path separators
      const normalized = path.replace(/\\/g, '/');
      return ig.ignores(normalized);
    },

    filter(paths: string[]): string[] {
      // Return paths that are NOT ignored
      const normalized = paths.map((p) => p.replace(/\\/g, '/'));
      return ig.filter(normalized);
    },

    add(newPatterns: string[]): void {
      ig.add(newPatterns);
    },
  };
}

/**
 * Load ignore patterns from a .syncignore file
 */
export async function loadIgnoreFile(
  projectPath: string
): Promise<string[] | null> {
  const ignorePath = join(projectPath, '.syncignore');

  try {
    const content = await readFile(ignorePath, 'utf8');
    return parseIgnoreFile(content);
  } catch (error) {
    // File doesn't exist or can't be read
    return null;
  }
}

/**
 * Parse .syncignore file content into patterns
 */
export function parseIgnoreFile(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/**
 * Create an ignore matcher for a project
 * Combines default patterns with project-specific .syncignore
 */
export async function createProjectIgnoreMatcher(
  projectPath: string,
  isUnrealProject: boolean = false
): Promise<IgnoreMatcher> {
  const defaultPatterns = isUnrealProject
    ? [...DEFAULT_IGNORE_PATTERNS, ...DEFAULT_UNREAL_IGNORE_PATTERNS]
    : DEFAULT_IGNORE_PATTERNS;

  const matcher = createIgnoreMatcher(defaultPatterns);

  // Load project-specific patterns
  const projectPatterns = await loadIgnoreFile(projectPath);
  if (projectPatterns) {
    matcher.add(projectPatterns);
  }

  return matcher;
}

/**
 * Detect if a project is an Unreal Engine project
 */
export async function isUnrealEngineProject(
  projectPath: string
): Promise<boolean> {
  try {
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(projectPath);
    return files.some((file) => file.endsWith('.uproject'));
  } catch {
    return false;
  }
}
