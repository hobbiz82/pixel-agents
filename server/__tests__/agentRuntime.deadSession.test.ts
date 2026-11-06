import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { adoptLiveSessions } from '../src/fileWatcher.js';
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
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
