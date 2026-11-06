/**
 * mptl fork (Đ2): the office builds itself from the live sessions — one room
 * per project (worktrees already folded by the server) plus a shared room —
 * from copies of the upstream room, so nobody has to edit a layout by hand.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';

import { beforeAll, describe, test } from 'vitest';

import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog, getCatalogEntry } from '../src/office/layout/furnitureCatalog.js';
import { layoutToSeats } from '../src/office/layout/layoutSerializer.js';
import {
  buildProjectOffice,
  MAX_PROJECT_ROOMS,
  mergeRoomOrder,
  pickRooms,
  roomTitle,
  SHARED_ROOM,
  SHARED_ROOM_TITLE,
} from '../src/office/projectOffice.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';
import { loadRealCatalog, readLayout } from './helpers/realAssets.js';

let base: OfficeLayout;
let baseSeats: number;

beforeAll(() => {
  assert.ok(buildDynamicCatalog(loadRealCatalog()));
  base = readLayout('default-layout-1.json');
  baseSeats = layoutToSeats(base.furniture).size;
});

describe('room order', () => {
  test('keeps the saved order and appends new projects by name', () => {
    assert.deepEqual(mergeRoomOrder(['zeta', 'alpha'], ['beta', 'alpha', 'gamma']), [
      'zeta',
      'alpha',
      'beta',
      'gamma',
    ]);
  });

  test('ignores empty names and duplicates', () => {
    assert.deepEqual(mergeRoomOrder(['a', 'a'], ['', 'b', 'b']), ['a', 'b']);
  });

  test('rooms follow the order, only for live projects, at most 14', () => {
    const live = Array.from({ length: 20 }, (_, i) => `p${String(i).padStart(2, '0')}`);
    const order = mergeRoomOrder(['p19', 'gone'], live);
    const rooms = pickRooms(live, order);
    assert.equal(rooms.length, MAX_PROJECT_ROOMS);
    assert.equal(rooms[0], 'p19');
    assert.ok(!rooms.includes('gone'));
  });

  test('the title is the renamed one, else the project name', () => {
    assert.equal(roomTitle('mptl-kho', { 'mptl-kho': 'Kho' }), 'Kho');
    assert.equal(roomTitle('skills', { 'mptl-kho': 'Kho' }), 'skills');
    assert.equal(roomTitle(SHARED_ROOM, {}), SHARED_ROOM_TITLE);
  });
});

/** Room key in a seat uid: `<furniture uid>@<key>`, plus `:<n>` for multi-seat furniture. */
function roomKeyOfSeat(uid: string): string {
  return uid.slice(uid.indexOf('@') + 1).replace(/:\d+$/, '');
}

/** Seat uids of the room for `key`. */
function seatsOf(layout: OfficeLayout, key: string): string[] {
  return [...layoutToSeats(layout.furniture).keys()].filter((uid) => roomKeyOfSeat(uid) === key);
}

describe('buildProjectOffice', () => {
  test('one room per project plus the shared room, marked as generated', () => {
    const office = buildProjectOffice(base, ['mptl-kho', 'skills'], { 'mptl-kho': 'Kho' });
    assert.equal(office.generated, 'projects');
    assert.deepEqual(
      office.areas?.map((a) => a.label),
      ['mptl-kho', 'skills', SHARED_ROOM],
    );
    assert.deepEqual(
      office.areas?.map((a) => a.title),
      ['Kho', 'skills', SHARED_ROOM_TITLE],
    );
  });

  test('every room has all the seats of the upstream room', () => {
    const office = buildProjectOffice(base, ['a', 'b', 'c', 'd'], {});
    for (const key of ['a', 'b', 'c', 'd', SHARED_ROOM]) {
      assert.equal(seatsOf(office, key).length, baseSeats, key);
    }
  });

  test('seat ids stay the same when other rooms come and go', () => {
    const before = buildProjectOffice(base, ['a', 'b'], {});
    const after = buildProjectOffice(base, ['c', 'b', 'a'], {});
    assert.deepEqual(seatsOf(after, 'a').sort(), seatsOf(before, 'a').sort());
  });

  test('each seat sits on a floor tile inside its own room', () => {
    const office = buildProjectOffice(base, ['a', 'b', 'c'], {});
    for (const s of layoutToSeats(office.furniture).values()) {
      const idx = s.seatRow * office.cols + s.seatCol;
      const t = office.tiles[idx];
      assert.ok(t !== TileType.WALL && t !== TileType.VOID, `seat ${s.uid} on tile ${t}`);
      assert.equal(office.areaTiles?.[idx], roomKeyOfSeat(s.uid), s.uid);
    }
  });

  test('14 projects fit the 64×64 editor limit; more are cut', () => {
    const many = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const office = buildProjectOffice(base, many, {});
    assert.ok(office.cols <= 64 && office.rows <= 64, `${office.cols}×${office.rows}`);
    assert.equal(office.areas?.length, MAX_PROJECT_ROOMS + 1);
    const n = office.cols * office.rows;
    assert.equal(office.tiles.length, n);
    assert.equal(office.tileColors?.length, n);
    assert.equal(office.areaTiles?.length, n);
  });

  test('furniture uses known types with unique uids inside the grid', () => {
    const office = buildProjectOffice(base, ['a', 'b', 'c', 'd', 'e'], {});
    const uids = new Set<string>();
    for (const f of office.furniture) {
      const entry = getCatalogEntry(f.type);
      assert.ok(entry, `unknown type ${f.type}`);
      assert.ok(!uids.has(f.uid), `duplicate uid ${f.uid}`);
      uids.add(f.uid);
      assert.ok(f.col >= 0 && f.col + entry.footprintW <= office.cols, `${f.uid} col`);
      assert.ok(f.row >= 0 && f.row + entry.footprintH <= office.rows, `${f.uid} row`);
    }
  });

  test('with no live project there is only the shared room', () => {
    const office = buildProjectOffice(base, [], {});
    assert.deepEqual(
      office.areas?.map((a) => a.label),
      [SHARED_ROOM],
    );
  });
});

describe('sessions sit in their project room', () => {
  const meta = (project: string) => ({ provider: 'claude' as const, project });

  test('a session of a project with a room sits in that room', () => {
    const os = new OfficeState(buildProjectOffice(base, ['mptl-kho', 'skills'], {}));
    os.setAgentSessionMeta(1, meta('skills'));
    os.addAgent(1, undefined, undefined, undefined, true, 'skills-worktree');
    assert.equal(os.seatZone(os.characters.get(1)!.seatId!), 'skills');
  });

  test('a session whose project has no room sits in the shared room', () => {
    const os = new OfficeState(buildProjectOffice(base, ['mptl-kho'], {}));
    os.setAgentSessionMeta(2, meta('other'));
    os.addAgent(2, undefined, undefined, undefined, true, 'other');
    assert.equal(os.seatZone(os.characters.get(2)!.seatId!), SHARED_ROOM);
  });

  test('a session seated before its project is known moves once it is', () => {
    const os = new OfficeState(buildProjectOffice(base, ['mptl-kho'], {}));
    os.addAgent(3, undefined, undefined, undefined, true, 'wt-123');
    assert.equal(os.seatZone(os.characters.get(3)!.seatId!), SHARED_ROOM);
    os.setAgentSessionMeta(3, meta('mptl-kho'));
    assert.equal(os.seatZone(os.characters.get(3)!.seatId!), 'mptl-kho');
  });

  test('a saved Area mapping does not pull a session out of its project room', () => {
    const os = new OfficeState(buildProjectOffice(base, ['a', 'b'], {}));
    os.setAreaMappings({ a: ['b'] });
    os.setAgentSessionMeta(4, meta('a'));
    os.addAgent(4, undefined, undefined, undefined, true, 'a');
    assert.equal(os.seatZone(os.characters.get(4)!.seatId!), 'a');
  });

  test('a new room appearing keeps everyone in their own room', () => {
    const os = new OfficeState(buildProjectOffice(base, ['a'], {}));
    os.setAgentSessionMeta(5, meta('a'));
    os.addAgent(5, undefined, undefined, undefined, true, 'a');
    os.setAgentSessionMeta(6, meta('b'));
    os.addAgent(6, undefined, undefined, undefined, true, 'b');
    assert.equal(os.seatZone(os.characters.get(6)!.seatId!), SHARED_ROOM);
    os.rebuildFromLayout(buildProjectOffice(base, ['b', 'a'], {}));
    assert.equal(os.seatZone(os.characters.get(5)!.seatId!), 'a');
    assert.equal(os.seatZone(os.characters.get(6)!.seatId!), 'b');
  });

  test('a hand-made layout still uses the saved mapping (unchanged behaviour)', () => {
    const os = new OfficeState(readLayout('default-layout-2.json'));
    os.setAreaMappings({ 'mptl-kho': ['local-ai-system'] });
    os.setAgentSessionMeta(7, meta('mptl-kho'));
    os.addAgent(7, undefined, undefined, undefined, true, 'mptl-kho');
    assert.equal(os.seatZone(os.characters.get(7)!.seatId!), 'local-ai-system');
  });
});
