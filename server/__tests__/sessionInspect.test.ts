import { describe, expect, it } from 'vitest';

import {
  type InspectIO,
  inspectSession,
  lastMessages,
  parseGitStatus,
  parseLsofPorts,
  parsePsRows,
  verifyStopTargets,
} from '../src/sessionInspect.js';

const START = 'Thu Nov  6 08:00:00 2026';
const LATER = 'Thu Nov  6 09:15:00 2026';
const EARLY = 'Wed Nov  5 07:00:00 2026';

function psLine(pid: number, ppid: number, start: string, comm: string): string {
  return `${String(pid).padStart(5)} ${String(ppid).padStart(5)} ${start} ${comm}`;
}

describe('parsePsRows', () => {
  it('reads pid, ppid, UTC start and the first word of the name', () => {
    const rows = parsePsRows(
      [
        psLine(100, 1, START, '/Users/x/.local/bin/claude'),
        psLine(200, 100, LATER, 'npm exec chrome-devtools-mcp@latest --flag'),
        'garbage',
      ].join('\n'),
    );
    expect(rows.get(100)).toEqual({ pid: 100, ppid: 1, start: START, name: 'claude', mcp: false });
    expect(rows.get(200)).toMatchObject({ name: 'npm', mcp: true });
    expect(rows.size).toBe(2);
  });
});

describe('parseLsofPorts', () => {
  it('maps pid to the ports it listens on, or counts its connections', () => {
    const out = ['p300', 'n*:3000', 'n127.0.0.1:3001', 'p301', 'n[::1]:5173', 'p302', 'nx->y'].join(
      '\n',
    );
    const m = parseLsofPorts(out);
    expect(m.get(300)).toEqual([3000, 3001]);
    expect(m.get(301)).toEqual([5173]);
    expect(m.get(302)).toEqual([]);
  });
});

describe('parseGitStatus', () => {
  it('reads branch, changed files and commits ahead of upstream', () => {
    const out = [
      '# branch.oid abc',
      '# branch.head feat/x',
      '# branch.upstream origin/feat/x',
      '# branch.ab +2 -0',
      '1 .M N... 100644 100644 100644 a b src/a.ts',
      '? new.txt',
    ].join('\n');
    expect(parseGitStatus(out)).toEqual({ branch: 'feat/x', changed: 2, unpushed: 2 });
  });

  it('a branch with no upstream has unknown unpushed', () => {
    expect(parseGitStatus('# branch.head main\n')).toEqual({
      branch: 'main',
      changed: 0,
      unpushed: null,
    });
  });
});

describe('lastMessages', () => {
  it('finds the last real prompt and reply in a Claude transcript', () => {
    const lines = [
      { type: 'user', message: { role: 'user', content: 'Câu đầu' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Trả lời đầu' }] } },
      { type: 'user', message: { role: 'user', content: 'Sửa giúp em   lỗi\nở trang Kho' } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
      {
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] },
      },
      { type: 'user', isMeta: true, message: { role: 'user', content: 'meta' } },
      { type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Đã sửa xong.' }] } },
    ];
    const tail = 'half a line}\n' + lines.map((l) => JSON.stringify(l)).join('\n');
    expect(lastMessages(tail)).toEqual({
      lastPrompt: 'Sửa giúp em lỗi ở trang Kho',
      lastReply: 'Đã sửa xong.',
    });
  });

  it('reads Codex rollouts and skips environment blocks', () => {
    const lines = [
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Làm bảng giá' }],
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }],
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Xong bảng giá' }],
        },
      },
    ];
    expect(lastMessages(lines.map((l) => JSON.stringify(l)).join('\n'))).toEqual({
      lastPrompt: 'Làm bảng giá',
      lastReply: 'Xong bảng giá',
    });
  });

  it('looks further back when the recent tail has no prompt', async () => {
    const asked: number[] = [];
    const r = await inspectSession(
      { provider: 'codex', file: '/r.jsonl', otherCwds: [] },
      io({
        tail: async (_f, bytes) => {
          asked.push(bytes);
          return bytes > 256 * 1024
            ? JSON.stringify({ type: 'user', message: { content: 'Xa hơn' } })
            : '';
        },
      }),
    );
    expect(asked).toEqual([256 * 1024, 4 * 1024 * 1024]);
    expect(r.lastPrompt).toBe('Xa hơn');
  });

  it('cuts long text', () => {
    const long = 'a'.repeat(1000);
    const got = lastMessages(JSON.stringify({ type: 'user', message: { content: long } }));
    expect(got.lastPrompt?.length).toBeLessThanOrEqual(281);
    expect(got.lastPrompt?.endsWith('…')).toBe(true);
  });
});

function io(over: Partial<InspectIO> = {}): InspectIO {
  return {
    ps: async () =>
      [
        psLine(100, 1, START, '/bin/claude'),
        psLine(110, 100, LATER, 'node'),
        psLine(111, 110, LATER, 'esbuild'),
        psLine(120, 100, LATER, 'mcp-server-supabase@latest --x'),
        psLine(130, 100, LATER, 'node'),
        psLine(400, 1, LATER, 'node'),
        psLine(401, 1, EARLY, 'python'),
        psLine(402, 1, LATER, 'node'),
        psLine(403, 1, LATER, 'uv'),
        psLine(404, 1, LATER, 'npm'),
      ].join('\n'),
    listening: async () => ['p110', 'n*:3000', 'p400', 'n127.0.0.1:5173'].join('\n'),
    established: async () => ['p130', 'n1->2'].join('\n'),
    launchdPids: async () => 'PID\tStatus\tLabel\n404\t0\tcom.x.svc\n',
    cwds: async () =>
      [
        'p400',
        'n/u/kho',
        'p401',
        'n/u/kho',
        'p402',
        'n/u/other',
        'p403',
        'n/u/kho/sub',
        'p404',
        'n/u/kho',
      ].join('\n'),
    git: async () => '# branch.head feat/x\n# branch.ab +1 -0\n? a\n',
    tail: async () => JSON.stringify({ type: 'user', message: { content: 'Hỏi cuối' } }),
    ...over,
  };
}

describe('inspectSession (Claude)', () => {
  const target = {
    provider: 'claude' as const,
    pid: 100,
    cwd: '/u/kho',
    file: '/t.jsonl',
    otherCwds: [] as string[],
  };

  it('lists the session tree (MCP servers counted, not listed) with ports', async () => {
    const r = await inspectSession(target, io());
    const tree = r.processes.filter((p) => !p.orphan);
    expect(tree.map((p) => p.pid)).toEqual([110, 111, 130]);
    expect(tree[0]).toMatchObject({ name: 'node', ports: [3000], suggest: true });
    expect(r.mcpCount).toBe(1);
  });

  it('a process with live connections is listed but not ticked', async () => {
    const r = await inspectSession(target, io());
    expect(r.processes.find((p) => p.pid === 130)).toMatchObject({ suggest: false, inbound: 1 });
  });

  it('orphans in the session folder started after it are listed; launchd ones never', async () => {
    const r = await inspectSession(target, io());
    const orphans = r.processes.filter((p) => p.orphan).map((p) => p.pid);
    // 401 started before the session, 402 elsewhere, 404 run by launchd
    expect(orphans).toEqual([400, 403]);
    expect(r.processes.find((p) => p.pid === 400)).toMatchObject({ ports: [5173], suggest: true });
  });

  it('an orphan another live session could own is not ticked', async () => {
    const r = await inspectSession({ ...target, otherCwds: ['/u/kho'] }, io());
    expect(r.processes.find((p) => p.pid === 400)?.suggest).toBe(false);
  });

  it('reports git state and the last messages', async () => {
    const r = await inspectSession(target, io());
    expect(r.git).toEqual({ branch: 'feat/x', changed: 1, unpushed: 1 });
    expect(r.lastPrompt).toBe('Hỏi cuối');
  });

  it('git errors become a reason, not a crash', async () => {
    const blocked = await inspectSession(
      target,
      io({
        git: async () => {
          throw Object.assign(new Error('x'), { stderr: 'Operation not permitted' });
        },
      }),
    );
    expect(blocked.git).toBeUndefined();
    expect(blocked.gitError).toBe('blocked');
    const notRepo = await inspectSession(
      target,
      io({
        git: async () => {
          throw Object.assign(new Error('x'), { stderr: 'fatal: not a git repository' });
        },
      }),
    );
    expect(notRepo.gitError).toBe('not_repo');
  });
});

describe('inspectSession (Codex)', () => {
  it('has no processes of its own (one shared app)', async () => {
    const r = await inspectSession(
      { provider: 'codex', cwd: '/u/kho', file: '/r.jsonl', otherCwds: [] },
      io(),
    );
    expect(r.processes).toEqual([]);
    expect(r.git?.branch).toBe('feat/x');
  });
});

describe('verifyStopTargets', () => {
  const rows = parsePsRows(
    [
      psLine(100, 1, START, 'claude'),
      psLine(110, 100, LATER, 'node'),
      psLine(400, 1, LATER, 'node'),
      psLine(404, 1, LATER, 'npm'),
      psLine(500, 1, LATER, 'claude'),
      psLine(600, 77, LATER, 'node'),
    ].join('\n'),
  );
  const launchd = new Set([404]);

  it('keeps a pid still in the tree or still an orphan, with the same start time', () => {
    const ok = verifyStopTargets(
      [
        { pid: 110, start: LATER },
        { pid: 400, start: LATER },
      ],
      { sessionPid: 100, rows, launchd },
    );
    expect(ok).toEqual([110, 400]);
  });

  it('drops a reused pid, a launchd process, another claude, an unrelated process, the session itself', () => {
    const ok = verifyStopTargets(
      [
        { pid: 110, start: EARLY },
        { pid: 404, start: LATER },
        { pid: 500, start: LATER },
        { pid: 600, start: LATER },
        { pid: 100, start: START },
        { pid: 999, start: LATER },
      ],
      { sessionPid: 100, rows, launchd },
    );
    expect(ok).toEqual([]);
  });
});
