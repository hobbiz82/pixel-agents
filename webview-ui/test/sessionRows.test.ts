/**
 * mptl fork: one row per session for the card bar (P1) and the "Phiên" table (P2).
 *
 * Run with: npm test
 */
import { describe, expect, it } from 'vitest';

import { buildSessionRows } from '../src/office/sessionRows.js';

const NOW = Date.UTC(2026, 10, 2, 5, 0, 0);
const H = 3_600_000;

describe('buildSessionRows', () => {
  it('names a row after the session, with folder, tool, status and RAM', () => {
    const [row] = buildSessionRows(
      [
        {
          id: 7,
          folder: 'mptl-kho',
          meta: {
            provider: 'claude',
            name: 'KHO · Người gác pipeline',
            status: 'idle',
            statusSince: NOW - 72 * H,
            rssBytes: 512 * 1024 ** 2,
          },
        },
      ],
      NOW,
    );
    expect(row).toMatchObject({
      id: 7,
      name: 'KHO · Người gác pipeline',
      folder: 'mptl-kho',
      provider: { label: 'Claude' },
      statusText: 'Rảnh 3 ngày',
      idleMs: 72 * H,
      ramText: '512 MB',
      longIdle: true,
    });
  });

  it('falls back to the folder, then to "Agent N", when the session has no name', () => {
    const rows = buildSessionRows(
      [
        { id: 1, folder: 'skills', meta: { status: 'busy', statusSince: NOW } },
        { id: 2, meta: { status: 'busy', statusSince: NOW } },
      ],
      NOW,
    );
    expect(rows.map((r) => r.name)).toEqual(['skills', 'Agent 2']);
    expect(rows[1].folder).toBe('');
    expect(rows[1].ramText).toBe('');
  });

  it('puts sessions waiting on anh first, then running, then idle (longest idle first)', () => {
    const rows = buildSessionRows(
      [
        { id: 1, meta: { status: 'idle', statusSince: NOW - 2 * H } },
        { id: 2, meta: { status: 'busy', statusSince: NOW - H } },
        { id: 3, meta: { status: 'idle', statusSince: NOW - 50 * H } },
        { id: 4, attention: true, meta: { status: 'busy', statusSince: NOW } },
        { id: 5 },
        { id: 6, meta: { status: 'waiting', statusSince: NOW - H } },
      ],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual([4, 6, 2, 3, 1, 5]);
  });

  it('says "Chờ anh" for a session the office flags as needing attention', () => {
    const [row] = buildSessionRows(
      [{ id: 4, attention: true, meta: { status: 'busy', statusSince: NOW } }],
      NOW,
    );
    expect(row.statusText).toBe('Chờ anh');
    expect(row.idleMs).toBeNull();
  });

  it('a busy session is never "long idle", however long it has been running', () => {
    const [row] = buildSessionRows(
      [{ id: 2, meta: { status: 'busy', statusSince: NOW - 30 * H } }],
      NOW,
    );
    expect(row.longIdle).toBe(false);
    expect(row.idleMs).toBeNull();
  });
});
