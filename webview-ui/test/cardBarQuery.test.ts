/**
 * mptl fork (Đ2.1): search, filter and sort in the right-hand card bar, and
 * the right-click menu of a character.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import {
  CARD_SORTS,
  cardQueryActive,
  characterMenuActions,
  loadCardQuery,
  saveCardQuery,
  visibleCardIds,
} from '../src/office/cardBarQuery.js';
import type { SessionRow } from '../src/office/sessionRows.js';
import { DEFAULT_QUERY } from '../src/office/sessionTable.js';
import type { StorageLike } from '../src/office/sessionTableStore.js';

function row(p: Partial<SessionRow> & { id: number }): SessionRow {
  return {
    name: `S${p.id}`,
    folder: '',
    project: '',
    provider: null,
    providerId: 'claude',
    status: 'idle',
    statusText: '',
    idleMs: null,
    rssBytes: null,
    ramText: '',
    whereText: '',
    longIdle: false,
    archiveBlock: null,
    ...p,
  };
}

const rows = new Map<number, SessionRow>([
  [1, row({ id: 1, name: 'Kho nhập hàng', project: 'mptl-kho', rssBytes: 500 })],
  [
    2,
    row({ id: 2, name: 'Speakr', project: 'local-ai-system', providerId: 'codex', rssBytes: 900 }),
  ],
  [3, row({ id: 3, name: 'Đặt phòng', project: 'local-ai-system', status: 'busy', rssBytes: 100 })],
]);
const rowFor = (id: number) => rows.get(id);
const ids = [1, 2, 3];

describe('visibleCardIds', () => {
  test('no filter keeps the bar order', () => {
    assert.deepEqual(visibleCardIds(ids, rowFor, DEFAULT_QUERY, null), [1, 2, 3]);
  });

  test('search ignores marks and case, over name and project', () => {
    assert.deepEqual(
      visibleCardIds(ids, rowFor, { ...DEFAULT_QUERY, search: 'dat PHONG' }, null),
      [3],
    );
    assert.deepEqual(visibleCardIds(ids, rowFor, { ...DEFAULT_QUERY, search: 'kho' }, null), [1]);
  });

  test('filters by tool and status', () => {
    assert.deepEqual(
      visibleCardIds(ids, rowFor, { ...DEFAULT_QUERY, providers: ['codex'] }, null),
      [2],
    );
    assert.deepEqual(
      visibleCardIds(ids, rowFor, { ...DEFAULT_QUERY, statuses: ['busy'] }, null),
      [3],
    );
  });

  test('sorts by RAM, most first', () => {
    assert.deepEqual(
      visibleCardIds(ids, rowFor, { ...DEFAULT_QUERY, sort: 'ram', dir: 'desc' }, null),
      [2, 1, 3],
    );
  });

  test('the right-clicked session stays visible on top even when filtered out', () => {
    assert.deepEqual(visibleCardIds(ids, rowFor, { ...DEFAULT_QUERY, search: 'kho' }, 3), [3, 1]);
    assert.deepEqual(visibleCardIds(ids, rowFor, DEFAULT_QUERY, 3), [1, 2, 3]);
  });

  test('an id with no row stays only while nothing is filtered', () => {
    assert.deepEqual(visibleCardIds([1, 9], rowFor, DEFAULT_QUERY, null), [1, 9]);
    assert.deepEqual(
      visibleCardIds([1, 9], rowFor, { ...DEFAULT_QUERY, search: 'kho' }, null),
      [1],
    );
  });
});

describe('card bar query', () => {
  test('active only when something filters or sorts', () => {
    assert.equal(cardQueryActive(DEFAULT_QUERY), false);
    assert.equal(cardQueryActive({ ...DEFAULT_QUERY, search: '  ' }), false);
    assert.equal(cardQueryActive({ ...DEFAULT_QUERY, search: 'x' }), true);
    assert.equal(cardQueryActive({ ...DEFAULT_QUERY, sort: 'name' }), true);
  });

  test('sort choices are distinct and include the default', () => {
    const v = CARD_SORTS.map((s) => s.value);
    assert.equal(new Set(v).size, v.length);
    assert.ok(v.includes('default'));
  });

  test('remembers the query per browser; bad or blocked storage falls back', () => {
    const mem = new Map<string, string>();
    const s: StorageLike = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
    };
    saveCardQuery(s, { ...DEFAULT_QUERY, search: 'kho', sort: 'ram', dir: 'desc' });
    assert.equal(loadCardQuery(s).search, 'kho');
    assert.equal(loadCardQuery(s).sort, 'ram');
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    assert.deepEqual(loadCardQuery(broken), DEFAULT_QUERY);
    saveCardQuery(broken, DEFAULT_QUERY);
  });
});

describe('characterMenuActions', () => {
  test('an idle session can be archived', () => {
    assert.deepEqual(characterMenuActions(row({ id: 1 }), false).archive, {
      enabled: true,
      reason: null,
    });
  });

  test('a busy or waiting session says why it cannot', () => {
    const a = characterMenuActions(row({ id: 1, archiveBlock: 'Đang chạy' }), false).archive;
    assert.equal(a.enabled, false);
    assert.equal(a.reason, 'Đang chạy');
  });

  test('a view-only page cannot archive', () => {
    const a = characterMenuActions(row({ id: 1 }), true).archive;
    assert.equal(a.enabled, false);
    assert.match(a.reason ?? '', /chỉ xem/i);
  });

  test('Trash is never offered for a live session, with the way to get there', () => {
    const t = characterMenuActions(row({ id: 1 }), false).trash;
    assert.equal(t.enabled, false);
    assert.match(t.reason ?? '', /lưu trữ/i);
  });
});
