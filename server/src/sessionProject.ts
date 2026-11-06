/**
 * mptl fork: which project a session belongs to, so the "Phiên" table and the
 * office can group sessions. A worktree (<repo>/.claude/worktrees/<name>,
 * .codex/worktrees, .claude-worktrees) folds into its parent repo. Pure: no git
 * calls (macOS privacy can block them for the launchd service).
 */
const WORKTREE = /^(.*?)\/(?:\.claude\/worktrees|\.codex\/worktrees|\.claude-worktrees)\/[^/]+/;

export function projectOfCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const trimmed = cwd.replace(/\/+$/, '');
  const root = WORKTREE.exec(trimmed)?.[1] ?? trimmed;
  const name = root.split('/').pop();
  return name || undefined;
}
