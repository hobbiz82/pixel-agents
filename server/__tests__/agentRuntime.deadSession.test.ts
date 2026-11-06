import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { adoptLiveSessions, isDeadTranscript } from '../src/fileWatcher.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';

/**
 * mptl fork: a Claude character whose process died without a SessionEnd we could
 * match (06/11: the app killed/relaunched a session, the hook arrived as "unknown
 * session") must leave the office, and come back if the session is resumed later.
 */
describe('AgentRuntime.removeDeadSession', () => {
  let runtime: AgentRuntime;
  afterEach(() => runtime?.dispose());

  it('removes the character and lets the same transcript be adopted again when it is live', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pxl-dead-${crypto.randomUUID()}`));
    const file = path.join(dir, 's-dead.jsonl');
    fs.writeFileSync(file, '');
    const store = new AgentStateStore();
    runtime = new AgentRuntime(store, claudeProvider);
    const a = createAgentState({
      id: 5,
      sessionId: 's-dead',
      projectDir: dir,
      jsonlFile: file,
      isExternal: true,
    });
    store.set(5, a);
    runtime.knownJsonlFiles.add(file);

    runtime.removeDeadSession(5);
    expect(store.get(5)).toBeUndefined();
    expect(runtime.knownJsonlFiles.has(file)).toBe(false);
    // The transcript scans adopt any file written in the last 10 minutes: they must
    // skip it, or the character comes back 3 s later (06/11: adopt/remove loop).
    expect(isDeadTranscript(file)).toBe(true);

    adoptLiveSessions(
      [{ file, cwd: dir, sessionId: 's-dead', provider: 'claude' }],
      runtime.knownJsonlFiles,
      store.nextAgentId,
      store,
      runtime.fileWatchers,
      runtime.pollingTimers,
      runtime.waitingTimers,
      runtime.permissionTimers,
      () => {},
    );
    expect([...store.values()].some((x) => x.sessionId === 's-dead')).toBe(true);
    expect(isDeadTranscript(file)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('transcript scans skip a dead session (06/11 adopt/remove loop)', () => {
  it('the global scan adopts a fresh transcript, but not one marked dead', async () => {
    const { markDeadTranscript, scanGlobalProjectDirs, setHookProvider } =
      await import('../src/fileWatcher.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `pxl-glob-${crypto.randomUUID()}`));
    const proj = path.join(root, '-Users-x-proj');
    fs.mkdirSync(proj);
    const live = path.join(proj, 'live.jsonl');
    const dead = path.join(proj, 'dead.jsonl');
    fs.writeFileSync(live, 'x'.repeat(4096));
    fs.writeFileSync(dead, 'x'.repeat(4096));
    markDeadTranscript(dead);
    const store = new AgentStateStore();
    const rt = new AgentRuntime(store, claudeProvider);
    // AgentRuntime registers its own provider; point the scan at the temp root after it.
    setHookProvider({
      ...claudeProvider,
      getAllSessionRoots: () => [root],
    } as unknown as Parameters<typeof setHookProvider>[0]);
    scanGlobalProjectDirs(
      new Set<string>(),
      store.nextAgentId,
      store,
      rt.fileWatchers,
      rt.pollingTimers,
      rt.waitingTimers,
      rt.permissionTimers,
      () => {},
    );
    const files = [...store.values()].map((a) => path.basename(a.jsonlFile));
    rt.dispose();
    setHookProvider(claudeProvider as unknown as Parameters<typeof setHookProvider>[0]);
    fs.rmSync(root, { recursive: true, force: true });
    expect(files).toEqual(['live.jsonl']);
  });
});
