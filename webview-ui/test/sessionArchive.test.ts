/**
 * mptl fork: archive / restore wording and the rule for when Lưu trữ is offered.
 *
 * Run with: npm test
 */
import { describe, expect, it } from 'vitest';

import {
  archiveBlock,
  archiveConfirmText,
  archiveResultText,
  BULK_MAX,
  bulkTallyText,
  inTally,
  newTally,
  parseArchivedSessions,
  planBulkArchive,
  restoreHint,
  restoreResultText,
  tallyAdd,
  tallyDone,
} from '../src/office/sessionArchive.js';
import { buildSessionRows } from '../src/office/sessionRows.js';

const NOW = Date.UTC(2026, 10, 2, 5, 0, 0);

describe('archiveBlock', () => {
  it('allows an idle Claude or Codex session', () => {
    expect(archiveBlock({ meta: { provider: 'claude', pid: 1, status: 'idle' } })).toBeNull();
    expect(archiveBlock({ meta: { provider: 'codex', status: 'idle' } })).toBeNull();
  });

  it.each([
    [{ meta: { provider: 'claude' as const, pid: 1, status: 'busy' } }, 'Đang chạy'],
    [{ meta: { provider: 'claude' as const, pid: 1, status: 'waiting' } }, 'Đang chờ anh'],
    [{ meta: { provider: 'codex' as const, status: 'idle' }, attention: true }, 'Đang chờ anh'],
    [{ meta: { status: 'idle' } }, 'Chưa rõ'],
    [{ meta: { provider: 'claude' as const, status: 'idle' } }, 'Chưa rõ'],
    [{}, 'Chưa rõ'],
  ])('blocks %j', (input, start) => {
    expect(archiveBlock(input)).toMatch(new RegExp(`^${start}`));
  });

  it('rides on each Phiên row', () => {
    const rows = buildSessionRows(
      [
        { id: 1, meta: { provider: 'codex', status: 'idle', statusSince: NOW - 1 } },
        { id: 2, meta: { provider: 'codex', status: 'busy', statusSince: NOW - 1 } },
      ],
      NOW,
    );
    expect(rows.find((r) => r.id === 1)?.archiveBlock).toBeNull();
    expect(rows.find((r) => r.id === 2)?.archiveBlock).toMatch(/^Đang chạy/);
  });
});

describe('archiveConfirmText', () => {
  it('Claude: says the session is stopped, nothing is deleted, how to reopen', () => {
    const t = archiveConfirmText('claude');
    expect(t).toMatch(/dừng/);
    expect(t).toMatch(/không xóa/);
    expect(t).toMatch(/app Claude/);
  });

  it('Claude: does not promise to hide it from the Claude app, which may even restart it (06/11)', () => {
    const t = archiveConfirmText('claude');
    expect(t).toMatch(/vẫn còn trong danh sách của app Claude/);
    expect(t).toMatch(/tự chạy lại/);
    expect(t).toMatch(/Archive trong app Claude/);
    expect(archiveResultText({ ok: true, provider: 'claude' })).toMatch(/vẫn còn trong app Claude/);
    expect(archiveResultText({ ok: true, provider: 'codex' })).toBe('Đã lưu trữ phiên.');
  });

  it('Codex: says it moves to Codex archive and can be restored', () => {
    const t = archiveConfirmText('codex');
    expect(t).toMatch(/lưu trữ của Codex/);
    expect(t).toMatch(/Khôi phục/);
  });
});

describe('result texts', () => {
  it('names each refusal in plain words', () => {
    expect(archiveResultText({ ok: false, reason: 'busy' })).toMatch(/đang chạy/);
    expect(archiveResultText({ ok: false, reason: 'waiting' })).toMatch(/chờ anh/);
    expect(archiveResultText({ ok: false, reason: 'process_changed' })).toMatch(/đã đổi/);
    expect(archiveResultText({ ok: false, reason: 'failed' })).toMatch(/Không lưu trữ được/);
    expect(archiveResultText({ ok: false, reason: 'whatever' })).toMatch(/Không lưu trữ được/);
    expect(archiveResultText({ ok: true, provider: 'codex' })).toMatch(/Đã lưu trữ/);
  });

  it('restore', () => {
    expect(restoreResultText({ ok: true })).toMatch(/Đã khôi phục/);
    expect(restoreResultText({ ok: false, reason: 'failed' })).toMatch(/Không khôi phục được/);
  });
});

describe('restoreHint', () => {
  it('Claude: the resume command for this session', () => {
    expect(restoreHint({ sessionId: 'abc-1', provider: 'claude', archivedAt: 1 })).toEqual({
      text: 'Mở lại trong app Claude, hoặc chạy lệnh:',
      command: 'claude --resume abc-1',
    });
  });

  it('Codex: no command, Khôi phục does it', () => {
    expect(restoreHint({ sessionId: 'c', provider: 'codex', archivedAt: 1 }).command).toBeNull();
  });
});

describe('parseArchivedSessions', () => {
  it('keeps well-formed entries only', () => {
    expect(
      parseArchivedSessions([
        { sessionId: 'a', provider: 'claude', archivedAt: 2, name: 'N', folder: 'f' },
        { sessionId: '', provider: 'claude', archivedAt: 1 },
        { sessionId: 'b', provider: 'other', archivedAt: 1 },
        null,
        'x',
      ]),
    ).toEqual([{ sessionId: 'a', provider: 'claude', archivedAt: 2, name: 'N', folder: 'f' }]);
    expect(parseArchivedSessions(undefined)).toEqual([]);
  });
});

describe('bulk archive', () => {
  const base = {
    folder: 'f',
    project: 'p',
    provider: null,
    status: 'idle' as const,
    statusText: '',
    idleMs: null,
    rssBytes: null,
    ramText: '',
    whereText: '',
    longIdle: false,
  };
  const ok = (id: number, providerId: 'claude' | 'codex' = 'claude') => ({
    ...base,
    id,
    name: `S${id}`,
    providerId,
    archiveBlock: null,
  });

  it('splits picked rows into targets and skipped-with-reason', () => {
    const plan = planBulkArchive([
      ok(1),
      { ...ok(2), archiveBlock: 'Đang chạy — chờ phiên rảnh rồi mới lưu trữ được' },
      { ...ok(3), providerId: undefined },
      ok(4, 'codex'),
    ]);
    expect(plan.targets.map((t) => [t.id, t.provider])).toEqual([
      [1, 'claude'],
      [4, 'codex'],
    ]);
    expect(plan.skipped.map((s) => s.id)).toEqual([2, 3]);
    expect(plan.skipped[0].reason).toMatch(/Đang chạy/);
    expect(plan.over).toBe(0);
  });

  it(`takes at most ${BULK_MAX} sessions per action and counts the rest`, () => {
    const plan = planBulkArchive(Array.from({ length: BULK_MAX + 3 }, (_, i) => ok(i + 1)));
    expect(plan.targets).toHaveLength(BULK_MAX);
    expect(plan.over).toBe(3);
  });

  it('tells progress, then the final count with refusal reasons', () => {
    expect(bulkTallyText({ total: 5, ok: 2, refused: {} })).toBe('Đang lưu trữ… 2/5');
    expect(bulkTallyText({ total: 3, ok: 2, refused: { busy: 1 } })).toBe(
      'Đã lưu trữ 2/3 phiên. 1 phiên không lưu trữ: phiên đang chạy.',
    );
    expect(bulkTallyText({ total: 2, ok: 2, refused: {} })).toBe('Đã lưu trữ 2/2 phiên.');
    expect(bulkTallyText({ total: 4, ok: 1, refused: { busy: 1, unknown: 2 } })).toBe(
      'Đã lưu trữ 1/4 phiên. 3 phiên không lưu trữ: 1 phiên đang chạy, 2 không tìm thấy phiên.',
    );
  });
});

describe('bulk tally', () => {
  it('counts results of the batch only, once per session', () => {
    let t = newTally([1, 2, 3]);
    t = tallyAdd(t, { id: 1, ok: true });
    t = tallyAdd(t, { id: 1, ok: true });
    t = tallyAdd(t, { id: 9, ok: true });
    t = tallyAdd(t, { id: 2, ok: false, reason: 'busy' });
    expect(t).toMatchObject({ total: 3, ok: 1, refused: { busy: 1 } });
    expect(tallyDone(t)).toBe(false);
    t = tallyAdd(t, { id: 3, ok: false });
    expect(t.refused).toEqual({ busy: 1, failed: 1 });
    expect(tallyDone(t)).toBe(true);
  });

  it('tells whether a result belongs to the batch', () => {
    expect(inTally(newTally([4]), 4)).toBe(true);
    expect(inTally(newTally([4]), 5)).toBe(false);
    expect(inTally(null, 4)).toBe(false);
  });
});

describe('archive result with stopped processes', () => {
  it('says how many processes were stopped with the session', () => {
    expect(archiveResultText({ ok: true, stopped: { done: 2, skipped: 0 } })).toBe(
      'Đã lưu trữ phiên, tắt 2 tiến trình.',
    );
    expect(archiveResultText({ ok: true, stopped: { done: 1, skipped: 1 } })).toBe(
      'Đã lưu trữ phiên, tắt 1 tiến trình (1 tiến trình đã đổi nên không tắt).',
    );
    expect(archiveResultText({ ok: true })).toBe('Đã lưu trữ phiên.');
  });
});
