/** mptl fork: Vietnamese labels for a Claude Code / Codex session's RAM and idle time. */

import { CLAUDE_TAG_COLOR, CODEX_TAG_COLOR } from '../constants.js';

export interface SessionStatus {
  status?: string;
  statusSince?: number;
}

export interface SessionFacts extends SessionStatus {
  provider?: 'claude' | 'codex';
  pid?: number;
  rssBytes?: number;
  origin?: SessionOrigin;
}

/** Where anh finds a Claude session: the Claude app, a Terminal window, claude.ai/code, or an SDK program. */
export type SessionOrigin = 'app' | 'terminal' | 'remote' | 'sdk';

const ORIGIN_VI: Record<SessionOrigin, string> = {
  app: 'Ở app Claude',
  terminal: 'Ở Terminal',
  remote: 'Ở claude.ai/code',
  sdk: 'Chạy nền (SDK)',
};

export function originLabel(origin: SessionOrigin | undefined): string {
  return origin ? ORIGIN_VI[origin] : '';
}

/** Idle this long or more → the character gets an amber "Rảnh N giờ" badge. */
export const IDLE_ALERT_MS = 24 * 3_600_000;

const MB = 1024 ** 2;
const GB = 1024 ** 3;

const STATUS_VI: Record<string, string> = {
  idle: 'Rảnh',
  busy: 'Đang chạy',
  waiting: 'Chờ anh',
};

export function formatRam(bytes: number): string {
  if (bytes >= GB) {
    return `${(bytes / GB).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;
  }
  return `${Math.round(bytes / MB).toLocaleString('vi-VN')} MB`;
}

export function formatIdle(ms: number): string {
  const minutes = Math.floor(Math.max(ms, 0) / 60_000);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} giờ`;
  return `${Math.floor(hours / 24)} ngày`;
}

export function isLongIdle(meta: SessionStatus | undefined, now: number): boolean {
  if (!meta || meta.status !== 'idle' || meta.statusSince === undefined) return false;
  return now - meta.statusSince >= IDLE_ALERT_MS;
}

export function statusLabel(meta: SessionStatus, now: number): string {
  if (!meta.status) return '';
  const word = STATUS_VI[meta.status];
  if (!word) return meta.status;
  if (meta.statusSince === undefined) return word;
  return `${word} ${formatIdle(now - meta.statusSince)}`;
}

const PROVIDER_TAGS = {
  claude: { label: 'Claude', color: CLAUDE_TAG_COLOR },
  codex: { label: 'Codex', color: CODEX_TAG_COLOR },
} as const;

/** Which tool runs the session; null when the server has not said. */
export function providerTag(
  meta: Pick<SessionFacts, 'provider'> | undefined,
): { label: string; color: string } | null {
  const tag = meta?.provider ? PROVIDER_TAGS[meta.provider] : undefined;
  return tag ? { label: tag.label, color: tag.color } : null;
}

/** Status · RAM · Context · Origin · PID, skipping what the session does not have. */
export function sessionDetail(meta: SessionFacts, now: number, contextPct: number | null): string {
  return [
    statusLabel(meta, now),
    meta.rssBytes !== undefined ? `RAM ${formatRam(meta.rssBytes)}` : null,
    contextPct !== null ? `Context ${contextPct}%` : null,
    originLabel(meta.origin) || null,
    meta.pid !== undefined ? `PID ${meta.pid}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
