import { useEffect, useState } from 'react';

import type { OfficeState } from '../office/engine/officeState.js';
import { migrateLayoutColors } from '../office/layout/layoutSerializer.js';
import { buildProjectOffice, mergeRoomOrder, pickRooms } from '../office/projectOffice.js';
import { liveProjects, loadRoomOrder, saveRoomOrder } from '../office/projectOfficeStore.js';
import type { StorageLike } from '../office/sessionTableStore.js';
import type { OfficeLayout } from '../office/types.js';

/** How often the live projects are re-read (in-memory only, no server call). */
const TICK_MS = 2000;

/** window.localStorage, or undefined when even reading the property throws. */
export function browserStorage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * mptl fork (Đ2): while `enabled`, show the office as one room per project
 * with live sessions plus a shared room, rebuilt whenever the projects or the
 * room titles change. The generated office is shown only — never saved. When
 * switched off, the saved layout (`getSavedLayout`) comes back.
 *
 * The base room is the upstream room shipped with the app
 * (assets/default-layout-1.json). If it cannot be loaded, nothing changes.
 */
export function useProjectOffice(opts: {
  getOfficeState: () => OfficeState;
  enabled: boolean;
  ready: boolean;
  titles: Record<string, string>;
  getSavedLayout: () => OfficeLayout | null;
}): void {
  const { getOfficeState, enabled, ready, titles, getSavedLayout } = opts;
  const [base, setBase] = useState<OfficeLayout | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}assets/default-layout-1.json`)
      .then((r) => (r.ok ? (r.json() as Promise<OfficeLayout>) : null))
      .then((l) => {
        if (alive && l && l.version === 1 && Array.isArray(l.tiles)) {
          setBase(migrateLayoutColors(l));
        }
      })
      .catch(() => {
        // no base room: keep showing the saved office
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const os = getOfficeState();
    if (!enabled || !base) {
      if (os.getLayout().generated) {
        const saved = getSavedLayout();
        if (saved) os.rebuildFromLayout(structuredClone(saved));
      }
      return;
    }
    let lastKey = '';
    const tick = () => {
      const projects = liveProjects(os.characters.values());
      const storage = browserStorage();
      const saved = loadRoomOrder(storage);
      const order = mergeRoomOrder(saved, projects);
      if (order.length !== saved.length) saveRoomOrder(storage, order);
      const rooms = pickRooms(projects, order);
      const key = JSON.stringify(rooms);
      if (os.getLayout().generated === 'projects' && key === lastKey) return;
      lastKey = key;
      os.rebuildFromLayout(buildProjectOffice(base, rooms, titles));
    };
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [getOfficeState, enabled, ready, base, titles, getSavedLayout]);
}
