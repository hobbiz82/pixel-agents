/**
 * mptl fork: Claude sessions archived on the page stay out of the office.
 *
 * Archiving a Claude session stops its process, but the Claude desktop app resumes
 * it right away (06/11: SessionStart source=resume 9–37 s later, new pid), and the
 * transcript scans would bring the character back. Codex archives for real, so only
 * Claude entries are kept. A session leaves this list when anh uses it again (a turn
 * after the archive time, or a busy/waiting status) or restores it from the
 * archived tab; archiving it again hides it again.
 */
export interface ArchivedRef {
  sessionId: string;
  provider: string;
  archivedAt: number;
}

export class ArchiveHide {
  /** Claude session id → archive time. */
  private archived = new Map<string, number>();
  /** Session id → the archive time it was used again after. */
  private revived = new Map<string, number>();

  setArchived(entries: ArchivedRef[]): void {
    const next = new Map<string, number>();
    for (const e of entries) {
      if (e.provider === 'claude' && typeof e.archivedAt === 'number') {
        next.set(e.sessionId, e.archivedAt);
      }
    }
    this.archived = next;
    for (const [id, at] of this.revived) {
      if (next.get(id) !== at) this.revived.delete(id);
    }
  }

  /** `at` = last user/assistant line of the session's transcript. */
  noteActivity(sessionId: string, at: number | undefined, status: string | undefined): void {
    const archivedAt = this.archived.get(sessionId);
    if (archivedAt === undefined) return;
    const working = status === 'busy' || status === 'waiting';
    if (working || (at !== undefined && at > archivedAt)) this.revived.set(sessionId, archivedAt);
  }

  isHidden(sessionId: string): boolean {
    const at = this.archived.get(sessionId);
    return at !== undefined && this.revived.get(sessionId) !== at;
  }
}
