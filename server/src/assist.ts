/**
 * mptl fork (Đ3): answer Claude permission prompts from the page, and notify
 * when a session waits.
 *
 * Claude Code runs the PermissionRequest hook BEFORE it shows its own prompt;
 * a hook that prints `{hookSpecificOutput:{decision:{behavior}}}` answers it,
 * one that prints nothing lets the prompt appear as usual. Our hook script asks
 * this hub through the hook endpoint and waits. The hub holds the request only
 * when anh turned "approve from the page" on AND a tokened page is open and
 * visible; otherwise it answers "no decision" at once, so the app never waits
 * for a page nobody is looking at. A held request times out to "no decision".
 *
 * Held requests carry tool input (a command, a path), so they go to tokened
 * clients only. Nothing here runs a tool or writes outside the settings store.
 */
import { randomUUID } from 'node:crypto';

export const HOLD_SECONDS_DEFAULT = 30;
/** The installed PermissionRequest hook gets HOOK_TIMEOUT_SECONDS; holds stay under it. */
export const HOLD_SECONDS_MAX = 50;
export const MAX_HELD = 20;
const SUMMARY_MAX = 300;
const NOTIFY_EVERY_MS = 60_000;

const KEY_APPROVE = 'mptl.assist.approveFromPage';
const KEY_NOTIFY_MAC = 'mptl.assist.notifyMac';

export type Decision = 'allow' | 'deny';

export interface AssistClient {
  send: (message: Record<string, unknown>) => void;
  privileged: boolean;
}

export interface HeldRequest {
  requestId: string;
  sessionId: string;
  agentId?: number;
  toolName: string;
  summary: string;
  cwd?: string;
  createdAt: number;
  expiresAt: number;
}

export interface AssistSettingsValue {
  approveFromPage: boolean;
  notifyMac: boolean;
  holdSeconds: number;
}

export interface AssistDeps {
  getSetting: <T>(key: string, defaultValue: T) => T;
  setSetting: <T>(key: string, value: T) => void;
  /** macOS notification (title, body); absent = no notifications. */
  notify?: (title: string, body: string) => void;
  now?: () => number;
  newId?: () => string;
}

interface Held extends HeldRequest {
  resolve: (d: Decision | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

function oneLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, ' ⏎ ').slice(0, SUMMARY_MAX);
}

/** A short, single-line description of what the tool is about to do. */
export function summarizeToolInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const i = input as Record<string, unknown>;
  for (const key of ['command', 'file_path', 'notebook_path', 'path', 'url', 'pattern', 'query']) {
    if (typeof i[key] === 'string' && i[key]) return oneLine(i[key] as string);
  }
  void toolName;
  let json: string;
  try {
    json = JSON.stringify(input);
  } catch {
    return '';
  }
  return oneLine(json);
}

export class AssistHub {
  private readonly clients = new Set<AssistClient>();
  private readonly visible = new Set<AssistClient>();
  private readonly held = new Map<string, Held>();
  private readonly lastNotified = new Map<string, number>();
  private quota: Record<string, unknown> | null = null;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: AssistDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.newId ?? (() => randomUUID());
  }

  settings(): AssistSettingsValue {
    return {
      // A stored non-boolean (hand-edited config) falls back to the safe default.
      approveFromPage: this.deps.getSetting<unknown>(KEY_APPROVE, false) === true,
      notifyMac: this.deps.getSetting<unknown>(KEY_NOTIFY_MAC, true) !== false,
      holdSeconds: HOLD_SECONDS_DEFAULT,
    };
  }

  private settingsMessage(): Record<string, unknown> {
    return { type: 'assistSettings', ...this.settings() };
  }

  private requestsMessage(): Record<string, unknown> {
    return { type: 'permissionRequests', requests: this.list() };
  }

  addClient(c: AssistClient): void {
    this.clients.add(c);
  }

  removeClient(c: AssistClient): void {
    this.clients.delete(c);
    this.setVisible(c, false);
  }

  /** A page reports document.visibilityState. */
  setVisible(c: AssistClient, visible: boolean): void {
    if (visible && this.clients.has(c)) this.visible.add(c);
    else this.visible.delete(c);
    if (!this.hasWatcher()) this.releaseAll();
  }

  private hasWatcher(): boolean {
    for (const c of this.visible) if (c.privileged) return true;
    return false;
  }

  /** What a newly connected client needs: settings, quota, held prompts (tokened only). */
  welcome(c: AssistClient): void {
    c.send(this.settingsMessage());
    if (this.quota) c.send(this.quota);
    if (c.privileged) c.send(this.requestsMessage());
  }

  setQuota(message: Record<string, unknown>): void {
    this.quota = message;
    for (const c of this.clients) c.send(message);
  }

  setSettings(patch: Partial<Pick<AssistSettingsValue, 'approveFromPage' | 'notifyMac'>>): void {
    if (typeof patch.approveFromPage === 'boolean') {
      this.deps.setSetting(KEY_APPROVE, patch.approveFromPage);
      if (!patch.approveFromPage) this.releaseAll();
    }
    if (typeof patch.notifyMac === 'boolean') this.deps.setSetting(KEY_NOTIFY_MAC, patch.notifyMac);
    const msg = this.settingsMessage();
    for (const c of this.clients) c.send(msg);
  }

  list(): HeldRequest[] {
    return [...this.held.values()].map(({ resolve: _r, timer: _t, ...entry }) => entry);
  }

  private publish(): void {
    const msg = this.requestsMessage();
    for (const c of this.clients) if (c.privileged) c.send(msg);
  }

  /** The hook asks: hold for the page, or answer null (= let the app ask) at once. */
  hold(event: Record<string, unknown>, agentId?: number): Promise<Decision | null> {
    const sessionId = event.session_id;
    const toolName = event.tool_name;
    if (typeof sessionId !== 'string' || !sessionId) return Promise.resolve(null);
    if (typeof toolName !== 'string' || !toolName) return Promise.resolve(null);
    if (!this.settings().approveFromPage || !this.hasWatcher()) return Promise.resolve(null);
    if (this.held.size >= MAX_HELD) return Promise.resolve(null);
    const createdAt = this.now();
    const holdMs = Math.min(this.settings().holdSeconds, HOLD_SECONDS_MAX) * 1000;
    const requestId = this.newId();
    return new Promise((resolve) => {
      const entry: Held = {
        requestId,
        sessionId,
        ...(agentId !== undefined ? { agentId } : {}),
        toolName,
        summary: summarizeToolInput(toolName, event.tool_input),
        ...(typeof event.cwd === 'string' ? { cwd: event.cwd } : {}),
        createdAt,
        expiresAt: createdAt + holdMs,
        resolve,
        timer: setTimeout(() => this.finish(requestId, null), holdMs),
      };
      this.held.set(requestId, entry);
      this.publish();
    });
  }

  private finish(requestId: string, decision: Decision | null): boolean {
    const entry = this.held.get(requestId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.held.delete(requestId);
    entry.resolve(decision);
    this.publish();
    return true;
  }

  private releaseAll(): void {
    for (const id of [...this.held.keys()]) this.finish(id, null);
  }

  /** A tokened page answers. 'ask' hands the prompt back to the app now. */
  decide(requestId: string, decision: Decision | 'ask', from: AssistClient): boolean {
    if (!from.privileged) return false;
    if (decision !== 'allow' && decision !== 'deny' && decision !== 'ask') return false;
    return this.finish(requestId, decision === 'ask' ? null : decision);
  }

  /** macOS notification that a session waits; once a minute per session at most. */
  notifyWaiting(sessionId: string, name?: string, toolName?: string): void {
    if (!this.deps.notify || !this.settings().notifyMac) return;
    const t = this.now();
    const last = this.lastNotified.get(sessionId);
    if (last !== undefined && t - last < NOTIFY_EVERY_MS) return;
    this.lastNotified.set(sessionId, t);
    const body = name
      ? `${name} cần anh duyệt${toolName ? `: ${toolName}` : ''}`
      : 'Một phiên đang chờ anh';
    this.deps.notify('Pixel Agents', body);
  }
}
