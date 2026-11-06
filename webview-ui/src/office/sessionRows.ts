/**
 * mptl fork: one row per session, shared by the card bar (name + tool + idle
 * beside each mug shot) and the "Phiên" table. Pure: callers pass `now`.
 */
import { archiveBlock } from './sessionArchive.js';
import type { SessionFacts } from './sessionMetaLabels.js';
import { formatRam, isLongIdle, providerTag, statusLabel } from './sessionMetaLabels.js';

export interface SessionInput {
  id: number;
  /** Folder the session runs in (the character's directoryName). */
  folder?: string;
  meta?: SessionFacts & { name?: string; project?: string };
  /** The office flags this agent as waiting for permission or input. */
  attention?: boolean;
}

export interface SessionRow {
  id: number;
  name: string;
  folder: string;
  provider: { label: string; color: string } | null;
  providerId: 'claude' | 'codex' | undefined;
  /** Repo the session works in; the folder when the server sent none. */
  project: string;
  status: RowStatus;
  statusText: string;
  /** How long it has been idle; null unless the session is idle. */
  idleMs: number | null;
  rssBytes: number | null;
  ramText: string;
  longIdle: boolean;
  /** Why Lưu trữ is not offered (busy, waiting, unknown tool); null = offered. */
  archiveBlock: string | null;
}

export type RowStatus = 'waiting' | 'busy' | 'idle' | 'unknown';

const RANK: Record<RowStatus, number> = { waiting: 0, busy: 1, idle: 2, unknown: 3 };

function rowStatus(input: SessionInput): RowStatus {
  if (input.attention || input.meta?.status === 'waiting') return 'waiting';
  if (input.meta?.status === 'busy') return 'busy';
  if (input.meta?.status === 'idle') return 'idle';
  return 'unknown';
}

/** 0 waiting on anh · 1 running · 2 idle · 3 unknown. */
function rank(input: SessionInput): number {
  return RANK[rowStatus(input)];
}

function toRow(input: SessionInput, now: number): SessionRow {
  const meta = input.meta ?? {};
  const idle = meta.status === 'idle' && meta.statusSince !== undefined && !input.attention;
  return {
    id: input.id,
    name: meta.name || input.folder || `Agent ${input.id}`,
    folder: input.folder ?? '',
    provider: providerTag(meta),
    providerId: meta.provider,
    project: meta.project || input.folder || '',
    status: rowStatus(input),
    statusText: input.attention ? 'Chờ anh' : statusLabel(meta, now),
    idleMs: idle ? now - (meta.statusSince as number) : null,
    rssBytes: meta.rssBytes ?? null,
    ramText: meta.rssBytes !== undefined ? formatRam(meta.rssBytes) : '',
    longIdle: !input.attention && isLongIdle(meta, now),
    archiveBlock: archiveBlock(input),
  };
}

/** Rows sorted: waiting on anh, running, idle (longest idle first), unknown. */
export function buildSessionRows(inputs: SessionInput[], now: number): SessionRow[] {
  return inputs
    .map((input) => ({ r: rank(input), row: toRow(input, now) }))
    .sort((a, b) => a.r - b.r || (b.row.idleMs ?? 0) - (a.row.idleMs ?? 0) || a.row.id - b.row.id)
    .map(({ row }) => row);
}
