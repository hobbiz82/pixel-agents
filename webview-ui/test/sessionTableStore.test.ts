/**
 * mptl fork: the Phiên table remembers its last query and anh's saved views
 * per browser. Storage may be missing or throw (private window): never crash.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_QUERY } from '../src/office/sessionTable.js';
import {
  deleteView,
  loadLastQuery,
  loadViews,
  MAX_VIEWS,
  saveLastQuery,
  saveView,
  type StorageLike,
} from '../src/office/sessionTableStore.js';

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const broken: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('last query', () => {
  it('round-trips through storage', () => {
    const s = memory();
    saveLastQuery(s, { ...DEFAULT_QUERY, sort: 'idle', dir: 'desc' });
    expect(loadLastQuery(s)).toMatchObject({ sort: 'idle', dir: 'desc' });
  });

  it('falls back to the default when storage is empty, broken or holds junk', () => {
    expect(loadLastQuery(memory())).toEqual(DEFAULT_QUERY);
    expect(loadLastQuery(broken)).toEqual(DEFAULT_QUERY);
    expect(loadLastQuery(undefined)).toEqual(DEFAULT_QUERY);
    const s = memory();
    s.data.set('mptl.sessions.query', '{not json');
    expect(loadLastQuery(s)).toEqual(DEFAULT_QUERY);
    expect(() => saveLastQuery(broken, DEFAULT_QUERY)).not.toThrow();
  });
});

describe('saved views', () => {
  it('saves, lists and deletes a named view', () => {
    const s = memory();
    saveView(s, 'Kho rảnh', { ...DEFAULT_QUERY, projects: ['mptl-kho'] });
    expect(loadViews(s).map((v) => v.name)).toEqual(['Kho rảnh']);
    expect(loadViews(s)[0].query.projects).toEqual(['mptl-kho']);
    deleteView(s, 'Kho rảnh');
    expect(loadViews(s)).toEqual([]);
  });

  it('saving the same name again replaces it', () => {
    const s = memory();
    saveView(s, 'A', { ...DEFAULT_QUERY, search: '1' });
    saveView(s, 'A', { ...DEFAULT_QUERY, search: '2' });
    expect(loadViews(s).map((v) => v.query.search)).toEqual(['2']);
  });

  it('ignores a blank name and keeps at most MAX_VIEWS, dropping the oldest', () => {
    const s = memory();
    saveView(s, '   ', DEFAULT_QUERY);
    for (let i = 0; i < MAX_VIEWS + 2; i++) saveView(s, `v${i}`, DEFAULT_QUERY);
    const names = loadViews(s).map((v) => v.name);
    expect(names).toHaveLength(MAX_VIEWS);
    expect(names).not.toContain('v0');
    expect(names[names.length - 1]).toBe(`v${MAX_VIEWS + 1}`);
  });

  it('broken storage gives no views and does not throw', () => {
    expect(loadViews(broken)).toEqual([]);
    expect(() => saveView(broken, 'x', DEFAULT_QUERY)).not.toThrow();
  });
});
