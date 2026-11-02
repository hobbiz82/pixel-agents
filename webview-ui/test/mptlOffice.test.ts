/**
 * mptl fork: the bundled office is a 3×2 grid of rooms (default-layout-2.json),
 * one room per busy project folder plus shared rooms, so 20+ sessions no longer
 * pile into the 14 seats of the upstream single room.
 *
 * Seats are counted with the real furniture manifests (same flattening as the
 * server), so a chair type that does not exist would show up as missing seats.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, test } from 'vitest';

import type { FurnitureAsset, ManifestGroup } from '../../core/src/assets/manifestUtils.js';
import { flattenManifest } from '../../core/src/assets/manifestUtils.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { LoadedAssetData } from '../src/office/layout/furnitureCatalog.js';
import { buildDynamicCatalog, getCatalogEntry } from '../src/office/layout/furnitureCatalog.js';
import { layoutToSeats } from '../src/office/layout/layoutSerializer.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');

function readLayout(name: string): OfficeLayout {
  return JSON.parse(fs.readFileSync(path.join(assetsDir, name), 'utf8')) as OfficeLayout;
}

function loadRealCatalog(): LoadedAssetData {
  const furnitureDir = path.join(assetsDir, 'furniture');
  const catalog: LoadedAssetData['catalog'] = [];
  for (const dir of fs.readdirSync(furnitureDir)) {
    const manifestPath = path.join(furnitureDir, dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    const inherited = {
      groupId: m.id as string,
      name: m.name as string,
      category: m.category as string,
      canPlaceOnWalls: m.canPlaceOnWalls as boolean | undefined,
      canPlaceOnSurfaces: m.canPlaceOnSurfaces as boolean | undefined,
      backgroundTiles: m.backgroundTiles as number | undefined,
      ...(m.rotationScheme ? { rotationScheme: m.rotationScheme as string } : {}),
    };
    const assets: FurnitureAsset[] =
      m.type === 'asset'
        ? [
            {
              id: m.id as string,
              name: m.name as string,
              label: m.name as string,
              category: m.category as string,
              file: `${m.id as string}.png`,
              width: m.width as number,
              height: m.height as number,
              footprintW: m.footprintW as number,
              footprintH: m.footprintH as number,
              isDesk: m.category === 'desks',
              backgroundTiles: m.backgroundTiles as number | undefined,
              groupId: m.id as string,
            },
          ]
        : flattenManifest(
            {
              type: 'group',
              groupType: m.groupType,
              rotationScheme: m.rotationScheme,
              members: m.members,
            } as ManifestGroup,
            inherited,
          );
    for (const a of assets) catalog.push({ ...a, label: a.label ?? a.id });
  }
  const sprites = Object.fromEntries(catalog.map((a) => [a.id, [['']]]));
  return { catalog, sprites };
}

let office: OfficeLayout;

beforeAll(() => {
  assert.ok(buildDynamicCatalog(loadRealCatalog()));
  office = readLayout('default-layout-2.json');
});

/** Room index (0..5) of a tile in the 3×2 grid of 21×12 rooms. */
function roomOf(layout: OfficeLayout, col: number, row: number): number {
  const roomW = layout.cols / 3;
  const roomH = layout.rows / 2;
  return Math.floor(row / roomH) * 3 + Math.floor(col / roomW);
}

describe('mptl office layout (default-layout-2.json)', () => {
  test('is a newer revision than the upstream room, so existing installs pick it up', () => {
    const upstream = readLayout('default-layout-1.json');
    assert.equal(office.version, 1);
    assert.ok((office.layoutRevision ?? 0) > (upstream.layoutRevision ?? 0));
  });

  test('stays within the editor limits and every per-tile array matches the grid', () => {
    assert.ok(office.cols <= 64 && office.rows <= 64, `${office.cols}×${office.rows}`);
    const n = office.cols * office.rows;
    assert.equal(office.tiles.length, n);
    assert.equal(office.tileColors?.length, n);
    assert.equal(office.areaTiles?.length, n);
  });

  test('furniture uses only known types, unique uids, inside the grid', () => {
    const uids = new Set<string>();
    for (const f of office.furniture) {
      const entry = getCatalogEntry(f.type);
      assert.ok(entry, `unknown furniture type ${f.type}`);
      assert.ok(!uids.has(f.uid), `duplicate uid ${f.uid}`);
      uids.add(f.uid);
      assert.ok(f.col >= 0 && f.col + entry.footprintW <= office.cols, `${f.uid} col`);
      assert.ok(f.row >= 0 && f.row + entry.footprintH <= office.rows, `${f.uid} row`);
    }
  });

  test('has six rooms with at least 12 seats each (≥ 72 in total)', () => {
    const seats = [...layoutToSeats(office.furniture).values()];
    assert.ok(seats.length >= 72, `only ${seats.length} seats`);
    const perRoom = new Array<number>(6).fill(0);
    for (const s of seats) perRoom[roomOf(office, s.seatCol, s.seatRow)]++;
    for (const [i, count] of perRoom.entries()) assert.ok(count >= 12, `room ${i}: ${count}`);
  });

  test('every seat sits on a floor tile', () => {
    for (const s of layoutToSeats(office.furniture).values()) {
      const t = office.tiles[s.seatRow * office.cols + s.seatCol];
      assert.ok(t !== TileType.WALL && t !== TileType.VOID, `seat ${s.uid} on tile ${t}`);
    }
  });

  test('project rooms are labelled areas on floor tiles only; two rooms stay shared', () => {
    const labels = (office.areas ?? []).map((a) => a.label);
    assert.equal(new Set(labels).size, labels.length, 'area labels must be distinct');
    assert.ok(labels.includes('mptl-kho') && labels.includes('local-ai-system'));
    const zonedRooms = new Set<number>();
    office.areaTiles!.forEach((label, idx) => {
      if (label === null) return;
      assert.ok(labels.includes(label), `unknown area label ${label}`);
      const t = office.tiles[idx];
      assert.ok(t !== TileType.WALL && t !== TileType.VOID, `area on non-floor tile ${idx}`);
      zonedRooms.add(roomOf(office, idx % office.cols, Math.floor(idx / office.cols)));
    });
    assert.equal(zonedRooms.size, labels.length, 'one room per area');
    assert.equal(6 - zonedRooms.size, 2, 'two shared rooms');
  });
});

describe('new agents sit in the room named after their folder', () => {
  test('without any saved mapping, a mptl-kho session lands in the mptl-kho room', () => {
    const os = new OfficeState(office);
    os.addAgent(1, undefined, undefined, undefined, true, 'mptl-kho');
    const seatId = os.characters.get(1)?.seatId;
    assert.ok(seatId);
    assert.equal(os.seatZone(seatId), 'mptl-kho');
  });

  test('a folder with no room of its own goes to a shared room first', () => {
    const os = new OfficeState(office);
    os.addAgent(2, undefined, undefined, undefined, true, 'some-other-project');
    const seatId = os.characters.get(2)?.seatId;
    assert.ok(seatId);
    assert.equal(os.seatZone(seatId), null);
  });

  test('a saved mapping still wins over the folder-name room', () => {
    const os = new OfficeState(office);
    os.setAreaMappings({ 'mptl-kho': ['local-ai-system'] });
    os.addAgent(3, undefined, undefined, undefined, true, 'mptl-kho');
    assert.equal(os.seatZone(os.characters.get(3)!.seatId!), 'local-ai-system');
  });
});
