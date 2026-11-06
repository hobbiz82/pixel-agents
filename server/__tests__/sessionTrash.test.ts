import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { type ArchivedEntry, foldArchiveLog } from '../src/sessionArchive.js';
import {
  defaultTrashIO,
  MAX_TRASH,
  trashArchived,
  type TrashIO,
  trashPathsFor,
} from '../src/sessionTrash.js';

const HOME = '/Users/x';
const SID = '0a1b2c3d-1111-2222-3333-444455556666';
const CODEX_ID = '019a1234-aaaa-bbbb-cccc-ddddeeeeffff';
const PROJ = `${HOME}/.claude/projects/-Users-x-kho`;

const claude: ArchivedEntry = {
  sessionId: SID,
  provider: 'claude',
  name: 'Kho',
  file: `${PROJ}/${SID}.jsonl`,
  archivedAt: 1,
};
const codex: ArchivedEntry = { sessionId: CODEX_ID, provider: 'codex', archivedAt: 2 };

function fs(kinds: Record<string, 'file' | 'dir'>, dirs: Record<string, string[]> = {}) {
  return {
    kind: async (p: string) => kinds[p] ?? null,
    list: async (d: string) => dirs[d] ?? [],
  };
}

describe('trashPathsFor', () => {
  it('Claude: the transcript, its side folder and its edit history', async () => {
    const paths = await trashPathsFor(
      claude,
      HOME,
      fs({
        [`${PROJ}/${SID}.jsonl`]: 'file',
        [`${PROJ}/${SID}`]: 'dir',
        [`${HOME}/.claude/file-history/${SID}`]: 'dir',
      }),
    );
    expect(paths).toEqual([
      `${PROJ}/${SID}.jsonl`,
      `${PROJ}/${SID}`,
      `${HOME}/.claude/file-history/${SID}`,
    ]);
  });

  it('Claude: skips parts that do not exist; none at all is an empty list', async () => {
    expect(await trashPathsFor(claude, HOME, fs({ [`${PROJ}/${SID}.jsonl`]: 'file' }))).toEqual([
      `${PROJ}/${SID}.jsonl`,
    ]);
    expect(await trashPathsFor(claude, HOME, fs({}))).toEqual([]);
  });

  it('Claude: refuses a logged file outside ~/.claude/projects or not named after the session', async () => {
    for (const file of [
      `${HOME}/Desktop/${SID}.jsonl`,
      `${PROJ}/other.jsonl`,
      `${HOME}/.claude/projects/../secrets/${SID}.jsonl`,
      `${PROJ}/sub/${SID}.jsonl`,
    ]) {
      const got = await trashPathsFor({ ...claude, file }, HOME, fs({ [file]: 'file' }));
      expect(got).toEqual([]);
    }
  });

  it('refuses a non-UUID id even when the path looks right', async () => {
    const file = `${PROJ}/notes.jsonl`;
    const odd = { ...claude, sessionId: 'notes', file };
    expect(await trashPathsFor(odd, HOME, fs({ [file]: 'file' }))).toEqual([]);
  });

  it('refuses a session id that is not a plain id', async () => {
    const bad = { ...claude, sessionId: '../../x', file: `${PROJ}/../../x.jsonl` };
    expect(await trashPathsFor(bad, HOME, fs({ [bad.file]: 'file' }))).toEqual([]);
  });

  it('Codex: the archived rollout(s) named after the thread, plain or compressed', async () => {
    const dir = `${HOME}/.codex/archived_sessions`;
    const got = await trashPathsFor(
      codex,
      HOME,
      fs(
        {
          [`${dir}/rollout-2026-10-29T13-22-14-${CODEX_ID}.jsonl`]: 'file',
          [`${dir}/rollout-2026-10-30T09-00-00-${CODEX_ID}.jsonl.zst`]: 'file',
        },
        {
          [dir]: [
            `rollout-2026-10-29T13-22-14-${CODEX_ID}.jsonl`,
            `rollout-2026-10-30T09-00-00-${CODEX_ID}.jsonl.zst`,
            'rollout-2026-10-29T13-22-14-019a9999-aaaa-bbbb-cccc-ddddeeeeffff.jsonl',
            `notes-${CODEX_ID}.txt`,
          ],
        },
      ),
    );
    expect(got).toEqual([
      `${dir}/rollout-2026-10-29T13-22-14-${CODEX_ID}.jsonl`,
      `${dir}/rollout-2026-10-30T09-00-00-${CODEX_ID}.jsonl.zst`,
    ]);
  });
});

function io(over: Partial<TrashIO> = {}) {
  const calls = { trashed: [] as string[][], log: [] as unknown[] };
  const t: TrashIO = {
    ...fs({ [`${PROJ}/${SID}.jsonl`]: 'file', [`${PROJ}/${SID}`]: 'dir' }),
    isLive: async () => false,
    trash: async (paths) => {
      calls.trashed.push(paths);
    },
    appendLog: async (e) => {
      calls.log.push(e);
    },
    now: () => 9,
    ...over,
  };
  return { t, calls };
}

describe('trashArchived', () => {
  it('moves the files to the Trash and logs the delete', async () => {
    const { t, calls } = io();
    const out = await trashArchived(claude, HOME, t);
    expect(out).toEqual({ ok: true, items: 2 });
    expect(calls.trashed).toEqual([[`${PROJ}/${SID}.jsonl`, `${PROJ}/${SID}`]]);
    expect(calls.log).toEqual([{ kind: 'deleted', sessionId: SID, deletedAt: 9 }]);
  });

  it('never touches a session that is running again', async () => {
    const { t, calls } = io({ isLive: async () => true });
    expect(await trashArchived(claude, HOME, t)).toEqual({ ok: false, reason: 'live' });
    expect(calls.trashed).toEqual([]);
    expect(calls.log).toEqual([]);
  });

  it('nothing to move: says so and still drops it from the list', async () => {
    const { t, calls } = io({ kind: async () => null });
    expect(await trashArchived(claude, HOME, t)).toEqual({ ok: true, items: 0 });
    expect(calls.trashed).toEqual([]);
    expect(calls.log).toHaveLength(1);
  });

  it('a failed move is a failure and is not logged', async () => {
    const { t, calls } = io({
      trash: async () => {
        throw new Error('denied');
      },
    });
    expect(await trashArchived(claude, HOME, t)).toEqual({ ok: false, reason: 'failed' });
    expect(calls.log).toEqual([]);
  });

  it('caps one request', () => {
    expect(MAX_TRASH).toBeGreaterThan(0);
    expect(MAX_TRASH).toBeLessThanOrEqual(50);
  });
});

describe('foldArchiveLog with deletes', () => {
  it('a deleted session leaves the archived list', () => {
    const list = foldArchiveLog([
      { kind: 'archived', ...claude },
      { kind: 'archived', ...codex },
      { kind: 'deleted', sessionId: SID, deletedAt: 3 },
    ]);
    expect(list.map((e) => e.sessionId)).toEqual([CODEX_ID]);
  });
});

describe('defaultTrashIO.kind', () => {
  it('reports files and folders, and treats a symlink as missing', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pa-trash-'));
    await writeFile(path.join(dir, 'a.jsonl'), 'x');
    await mkdir(path.join(dir, 'sub'));
    await symlink(path.join(dir, 'a.jsonl'), path.join(dir, 'link.jsonl'));
    const io = defaultTrashIO(dir);
    expect(await io.kind(path.join(dir, 'a.jsonl'))).toBe('file');
    expect(await io.kind(path.join(dir, 'sub'))).toBe('dir');
    expect(await io.kind(path.join(dir, 'link.jsonl'))).toBeNull();
    expect(await io.kind(path.join(dir, 'nope'))).toBeNull();
  });
});
