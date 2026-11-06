/**
 * Real bundled assets for office tests: the layouts in public/assets and the
 * furniture catalog flattened from the real manifests (same as the server), so
 * a chair type that does not exist shows up as missing seats.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FurnitureAsset, ManifestGroup } from '../../../core/src/assets/manifestUtils.js';
import { flattenManifest } from '../../../core/src/assets/manifestUtils.js';
import type { LoadedAssetData } from '../../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout } from '../../src/office/types.js';

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets');

export function readLayout(name: string): OfficeLayout {
  return JSON.parse(fs.readFileSync(path.join(assetsDir, name), 'utf8')) as OfficeLayout;
}

export function loadRealCatalog(): LoadedAssetData {
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
      canPlaceOnWalls: m.canPlaceOnWalls === true,
      canPlaceOnSurfaces: m.canPlaceOnSurfaces === true,
      backgroundTiles: (m.backgroundTiles as number | undefined) ?? 0,
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
              canPlaceOnWalls: inherited.canPlaceOnWalls,
              canPlaceOnSurfaces: inherited.canPlaceOnSurfaces,
              backgroundTiles: inherited.backgroundTiles,
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
