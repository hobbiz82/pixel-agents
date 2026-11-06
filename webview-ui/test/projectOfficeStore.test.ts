/**
 * mptl fork (Đ2): per-browser memory for the project office — on/off, room
 * order and renamed titles — plus which projects have live sessions.
 * Storage can be missing or throw; every read falls back to the default.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import {
  liveProjects,
  loadAutoRooms,
  loadRoomOrder,
  loadRoomTitles,
  MAX_TITLE_LENGTH,
  renameRoom,
  saveAutoRooms,
  saveRoomOrder,
} from '../src/office/projectOfficeStore.js';
import type { StorageLike } from '../src/office/sessionTableStore.js';

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

describe('project office settings', () => {
  test('rooms per project are on by default and the choice is remembered', () => {
    const s = memory();
    assert.equal(loadAutoRooms(s), true);
    saveAutoRooms(s, false);
    assert.equal(loadAutoRooms(s), false);
  });

  test('blocked or missing storage falls back to the defaults', () => {
    assert.equal(loadAutoRooms(broken), true);
    assert.equal(loadAutoRooms(undefined), true);
    assert.deepEqual(loadRoomOrder(broken), []);
    assert.deepEqual(loadRoomTitles(broken), {});
    saveRoomOrder(broken, ['a']);
    saveAutoRooms(broken, false);
  });

  test('room order round-trips and drops anything that is not a name', () => {
    const s = memory();
    saveRoomOrder(s, ['b', 'a']);
    assert.deepEqual(loadRoomOrder(s), ['b', 'a']);
    s.setItem('mptl.office.roomOrder', JSON.stringify(['ok', 3, '', null]));
    assert.deepEqual(loadRoomOrder(s), ['ok']);
  });

  test('renaming keeps the other titles; an empty title goes back to the project name', () => {
    const s = memory();
    let titles = renameRoom(s, {}, 'mptl-kho', '  Kho  ');
    titles = renameRoom(s, titles, 'skills', 'Kỹ năng');
    assert.deepEqual(loadRoomTitles(s), { 'mptl-kho': 'Kho', skills: 'Kỹ năng' });
    titles = renameRoom(s, titles, 'mptl-kho', '   ');
    assert.deepEqual(titles, { skills: 'Kỹ năng' });
    assert.deepEqual(loadRoomTitles(s), { skills: 'Kỹ năng' });
  });

  test('a title is cut to fit on the room', () => {
    const titles = renameRoom(memory(), {}, 'a', 'x'.repeat(100));
    assert.equal(titles.a.length, MAX_TITLE_LENGTH);
  });
});

describe('liveProjects', () => {
  test('one entry per project of the sessions, worktrees already folded', () => {
    const chars = [
      { directoryName: 'wt-1', sessionMeta: { project: 'mptl-kho' } },
      { directoryName: 'mptl-kho', sessionMeta: { project: 'mptl-kho' } },
      { directoryName: 'skills', sessionMeta: {} },
      { directoryName: 'sub-agent-folder' },
    ];
    assert.deepEqual(liveProjects(chars), ['mptl-kho', 'skills']);
  });
});
