/**
 * mptl fork (Đ3): Claude Code status line command. Claude Code pipes session
 * JSON to it on stdin; its `rate_limits` (claude.ai subscribers, after the
 * first API response) are the only place Claude exposes usage limits, so we
 * store them in ~/.pixel-agents/claude-quota.json for the quota panel, and
 * print a short "5h 24% · 7d 41%" line. Never fails loudly: any error prints
 * nothing and exits 0.
 */
import {
  claudeQuotaFile,
  claudeQuotaFromStatusInput,
  statusLineText,
  writeClaudeQuota,
} from '../../../../quota.js';

async function main(): Promise<void> {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    return;
  }
  const quota = claudeQuotaFromStatusInput(data, Date.now());
  if (!quota) return;
  try {
    writeClaudeQuota(claudeQuotaFile(), quota);
  } catch {
    // unwritable home: still show the line
  }
  // stdout to a pipe is asynchronous on macOS: flush before process.exit.
  await new Promise<void>((resolve) =>
    process.stdout.write(statusLineText(quota), () => resolve()),
  );
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
