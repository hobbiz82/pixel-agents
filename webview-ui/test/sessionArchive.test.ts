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
  parseArchivedSessions,
  restoreHint,
  restoreResultText,
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
