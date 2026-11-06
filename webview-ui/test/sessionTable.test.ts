/**
 * mptl fork: filter / sort / group / saved views for the "Phiên" table.
 *
 * Run with: npm test
 */
import { describe, expect, it } from 'vitest';

import type { SessionRow } from '../src/office/sessionRows.js';
import {
  applyQuery,
  DEFAULT_QUERY,
  foldText,
  groupByProject,
  parseQuery,
  PRESETS,
  type TableQuery,
} from '../src/office/sessionTable.js';

const H = 3_600_000;
const D = 24 * H;

function row(p: Partial<SessionRow> & { id: number }): SessionRow {
  return {
    name: `S${p.id}`,
    folder: '',
    project: '',
    provider: null,
    providerId: undefined,
    status: 'idle',
    statusText: '',
    idleMs: null,
    rssBytes: null,
    ramText: '',
    longIdle: false,
    archiveBlock: null,
    ...p,
  };
}

const rows: SessionRow[] = [
  row({
    id: 1,
    name: 'Kho · Đơn hàng',
    project: 'mptl-kho',
    providerId: 'claude',
    status: 'idle',
    idleMs: 5 * D,
    rssBytes: 300,
  }),
  row({ id: 2, name: 'Hub quyền', project: 'novaceu-hub', providerId: 'codex', status: 'busy' }),
  row({
    id: 3,
    name: 'Speakr',
    project: 'local-ai-system',
    providerId: 'claude',
    status: 'waiting',
    rssBytes: 900,
  }),
  row({
    id: 4,
    name: 'Lab perf',
    project: 'lab_manager',
    providerId: 'claude',
    status: 'idle',
    idleMs: 2 * H,
    rssBytes: 100,
  }),
];

function q(over: Partial<TableQuery>): TableQuery {
  return { ...DEFAULT_QUERY, ...over };
}

const ids = (r: SessionRow[]) => r.map((x) => x.id);

describe('applyQuery filters', () => {
  it('the default query keeps every row in the given order', () => {
    expect(ids(applyQuery(rows, DEFAULT_QUERY))).toEqual([1, 2, 3, 4]);
  });

  it('filters by tool', () => {
    expect(ids(applyQuery(rows, q({ providers: ['codex'] })))).toEqual([2]);
  });

  it('filters by status', () => {
    expect(ids(applyQuery(rows, q({ statuses: ['waiting', 'busy'] })))).toEqual([2, 3]);
  });

  it('idle-at-least keeps only idle rows idle that long or longer', () => {
    expect(ids(applyQuery(rows, q({ idleAtLeastMs: 3 * D })))).toEqual([1]);
  });

  it('filters by project', () => {
    expect(ids(applyQuery(rows, q({ projects: ['lab_manager', 'mptl-kho'] })))).toEqual([1, 4]);
  });

  it('filters by picked session names', () => {
    expect(ids(applyQuery(rows, q({ names: ['Speakr', 'Hub quyền'] })))).toEqual([2, 3]);
  });

  it('search ignores case and Vietnamese marks, and matches project too', () => {
    expect(ids(applyQuery(rows, q({ search: 'don hang' })))).toEqual([1]);
    expect(ids(applyQuery(rows, q({ search: 'NOVACEU' })))).toEqual([2]);
  });
});

describe('applyQuery sort', () => {
  it('sorts by idle time, longest first, non-idle last', () => {
    expect(ids(applyQuery(rows, q({ sort: 'idle', dir: 'desc' })))).toEqual([1, 4, 2, 3]);
  });

  it('sorts by RAM ascending with unknown RAM last', () => {
    expect(ids(applyQuery(rows, q({ sort: 'ram', dir: 'asc' })))).toEqual([4, 1, 3, 2]);
  });

  it('sorts by name in Vietnamese order', () => {
    expect(ids(applyQuery(rows, q({ sort: 'name', dir: 'asc' })))).toEqual([2, 1, 4, 3]);
  });

  it('sorts by tool, then keeps the given order inside a tool', () => {
    expect(ids(applyQuery(rows, q({ sort: 'tool', dir: 'asc' })))).toEqual([1, 3, 4, 2]);
  });
});

describe('groupByProject', () => {
  it('groups rows by project in name order, rows keep their order, no project last', () => {
    const g = groupByProject([...rows, row({ id: 5, project: '' })]);
    expect(g.map((x) => x.project)).toEqual([
      'lab_manager',
      'local-ai-system',
      'mptl-kho',
      'novaceu-hub',
      '',
    ]);
    expect(g[0].rows.map((r) => r.id)).toEqual([4]);
    expect(g[4].label).toBe('Không rõ project');
  });
});

describe('foldText', () => {
  it('lower-cases and drops marks, đ → d', () => {
    expect(foldText('Đơn Hàng Ủy')).toBe('don hang uy');
  });
});

describe('presets', () => {
  it('has "Rảnh > 3 ngày" and "Chờ anh"', () => {
    const idle = PRESETS.find((p) => p.id === 'idle3d');
    const wait = PRESETS.find((p) => p.id === 'waiting');
    expect(idle?.label).toBe('Rảnh ≥ 3 ngày');
    expect(ids(applyQuery(rows, idle!.query))).toEqual([1]);
    expect(ids(applyQuery(rows, wait!.query))).toEqual([3]);
  });
});

describe('parseQuery', () => {
  it('returns the default for junk', () => {
    expect(parseQuery(null)).toEqual(DEFAULT_QUERY);
    expect(parseQuery('x')).toEqual(DEFAULT_QUERY);
  });

  it('keeps valid fields and drops invalid ones', () => {
    const got = parseQuery({
      providers: ['codex', 'evil'],
      statuses: ['idle', 3],
      idleAtLeastMs: -5,
      projects: ['a', 1],
      names: ['n'],
      search: 'x',
      sort: 'ram',
      dir: 'sideways',
      group: true,
    });
    expect(got).toEqual({
      ...DEFAULT_QUERY,
      providers: ['codex'],
      statuses: ['idle'],
      projects: ['a'],
      names: ['n'],
      search: 'x',
      sort: 'ram',
      group: true,
    });
  });
});
