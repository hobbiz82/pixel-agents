import { describe, expect, it } from 'vitest';

import { projectOfCwd } from '../src/sessionProject.js';

describe('projectOfCwd', () => {
  it('names a plain repo folder by its last segment', () => {
    expect(projectOfCwd('/Users/seb/local-ai-system')).toBe('local-ai-system');
  });

  it('folds a Claude worktree into its parent repo', () => {
    expect(projectOfCwd('/Users/seb/Desktop/lab_manager/.claude/worktrees/fix-perf')).toBe(
      'lab_manager',
    );
  });

  it('folds a subfolder inside a worktree into the parent repo', () => {
    expect(projectOfCwd('/Users/seb/kho/.claude/worktrees/x/web/src')).toBe('kho');
  });

  it('folds Codex and .claude-worktrees layouts too', () => {
    expect(projectOfCwd('/Users/seb/kho/.codex/worktrees/abc')).toBe('kho');
    expect(projectOfCwd('/Users/seb/kho/.claude-worktrees/abc')).toBe('kho');
  });

  it('ignores a trailing slash', () => {
    expect(projectOfCwd('/Users/seb/skills/')).toBe('skills');
  });

  it('returns undefined for empty or root paths', () => {
    expect(projectOfCwd('')).toBeUndefined();
    expect(projectOfCwd('/')).toBeUndefined();
    expect(projectOfCwd(undefined)).toBeUndefined();
  });
});
