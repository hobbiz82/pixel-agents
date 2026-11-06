/**
 * mptl fork (Đ3): view logic for the quota panel and the permission cards.
 * Pure (no DOM, no React) so it runs in the node test environment.
 */

export interface QuotaWindow {
  usedPercent: number;
  resetsAt: number;
}

export interface ProviderQuota {
  fiveHour?: QuotaWindow;
  sevenDay?: QuotaWindow;
  updatedAt: number;
  /** Codex: live = asked from the server; log = this Mac's rollouts (may lag). */
  source?: 'live' | 'log';
}

export type ClaudeReader = 'none' | 'ours' | 'other';

export interface QuotaView {
  claude?: ProviderQuota;
  codex?: ProviderQuota;
  claudeReader: ClaudeReader;
}

export interface HeldPrompt {
  requestId: string;
  sessionId: string;
  agentId?: number;
  toolName: string;
  summary: string;
  cwd?: string;
  createdAt: number;
  expiresAt: number;
}

export interface AssistSettings {
  approveFromPage: boolean;
  notifyMac: boolean;
  holdSeconds: number;
}

/** Business time zone for reset times (PROJECT_CONVENTIONS default). */
const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const DAY_MS = 86_400_000;

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function parseWindow(raw: unknown): QuotaWindow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { usedPercent, resetsAt } = raw as Record<string, unknown>;
  return finite(usedPercent) && finite(resetsAt) ? { usedPercent, resetsAt } : undefined;
}

function parseProvider(raw: unknown): ProviderQuota | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const fiveHour = parseWindow(r.fiveHour);
  const sevenDay = parseWindow(r.sevenDay);
  if ((!fiveHour && !sevenDay) || !finite(r.updatedAt)) return undefined;
  return {
    ...(fiveHour ? { fiveHour } : {}),
    ...(sevenDay ? { sevenDay } : {}),
    updatedAt: r.updatedAt,
    ...(r.source === 'live' || r.source === 'log' ? { source: r.source } : {}),
  };
}

export function parseQuotaStatus(msg: Record<string, unknown>): QuotaView {
  const claude = parseProvider(msg.claude);
  const codex = parseProvider(msg.codex);
  const reader = msg.claudeReader;
  return {
    ...(claude ? { claude } : {}),
    ...(codex ? { codex } : {}),
    claudeReader: reader === 'ours' || reader === 'other' ? reader : 'none',
  };
}

/** The highest usage across every window of every tool, or null without readings. */
export function worstPercent(view: QuotaView): number | null {
  const all = [view.claude, view.codex].flatMap((q) =>
    q ? [q.fiveHour, q.sevenDay].filter((w): w is QuotaWindow => !!w) : [],
  );
  return all.length ? Math.max(...all.map((w) => w.usedPercent)) : null;
}

export function quotaLevel(pct: number): 'ok' | 'warn' | 'high' {
  if (pct >= 90) return 'high';
  if (pct >= 70) return 'warn';
  return 'ok';
}

function parts(at: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)) {
    out[p.type] = p.value;
  }
  return out;
}

/** "reset 19:30" within a day, "reset 08:00 09/11" further out (business time zone). */
export function resetLabel(resetsAt: number, now: number): string {
  if (resetsAt <= now) return 'đã reset';
  const p = parts(resetsAt);
  const time = `${p.hour}:${p.minute}`;
  return resetsAt - now < DAY_MS ? `reset ${time}` : `reset ${time} ${p.day}/${p.month}`;
}

/** When (and for Codex, from where) a quota figure was read. */
export function readingLabel(q: Pick<ProviderQuota, 'updatedAt' | 'source'>, now: number): string {
  const p = parts(q.updatedAt);
  const time = `${p.hour}:${p.minute}`;
  const when =
    now - q.updatedAt < DAY_MS ? `đọc lúc ${time}` : `đọc lúc ${time} ${p.day}/${p.month}`;
  if (q.source === 'live') return `${when} · máy chủ Codex`;
  if (q.source === 'log') return `${when} · nhật ký trên máy, có thể cũ`;
  return when;
}

/** What is left of a window, as the Codex and Claude apps show it. */
export function remainingPercent(usedPercent: number): number {
  return Math.max(0, Math.round(100 - usedPercent));
}

export function parsePermissionRequests(raw: unknown): HeldPrompt[] {
  if (!Array.isArray(raw)) return [];
  const out: HeldPrompt[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const e = r as Record<string, unknown>;
    if (
      typeof e.requestId !== 'string' ||
      typeof e.sessionId !== 'string' ||
      typeof e.toolName !== 'string' ||
      typeof e.summary !== 'string' ||
      !finite(e.createdAt) ||
      !finite(e.expiresAt)
    ) {
      continue;
    }
    out.push({
      requestId: e.requestId,
      sessionId: e.sessionId,
      ...(finite(e.agentId) ? { agentId: e.agentId } : {}),
      toolName: e.toolName,
      summary: e.summary,
      ...(typeof e.cwd === 'string' ? { cwd: e.cwd } : {}),
      createdAt: e.createdAt,
      expiresAt: e.expiresAt,
    });
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export function secondsLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export function parseAssistSettings(msg: Record<string, unknown>): AssistSettings {
  return {
    approveFromPage: msg.approveFromPage === true,
    notifyMac: msg.notifyMac !== false,
    holdSeconds: finite(msg.holdSeconds) ? msg.holdSeconds : 30,
  };
}
