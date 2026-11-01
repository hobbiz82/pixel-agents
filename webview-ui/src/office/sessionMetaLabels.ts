/** mptl fork: Vietnamese labels for a Claude Code session's RAM and idle time. */

export interface SessionStatus {
  status?: string;
  statusSince?: number;
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
