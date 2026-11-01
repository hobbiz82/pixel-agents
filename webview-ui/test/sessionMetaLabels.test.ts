/**
 * mptl fork: labels shown for a Claude Code session (name, RAM, idle time).
 * Pure functions so they are testable without React.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { OfficeState } from '../src/office/engine/officeState.js';
import {
  formatIdle,
  formatRam,
  IDLE_ALERT_MS,
  isLongIdle,
  statusLabel,
} from '../src/office/sessionMetaLabels.js';

const HOUR = 3_600_000;
const GB = 1024 ** 3;
const MB = 1024 ** 2;

test('RAM uses vi-VN decimals: GB with one decimal, MB rounded', () => {
  assert.equal(formatRam(1.25 * GB), '1,3 GB');
  assert.equal(formatRam(2 * GB), '2,0 GB');
  assert.equal(formatRam(512 * MB), '512 MB');
  assert.equal(formatRam(0.4 * MB), '0 MB');
});

test('idle time reads in minutes under an hour, hours under two days, then days', () => {
  assert.equal(formatIdle(5 * 60_000), '5 phút');
  assert.equal(formatIdle(30_000), '0 phút');
  assert.equal(formatIdle(26 * HOUR + 59 * 60_000), '26 giờ');
  assert.equal(formatIdle(50 * HOUR), '2 ngày');
});

test('a session counts as long-idle only when idle for 24 hours or more', () => {
  const now = 1_000 * HOUR;
  assert.equal(IDLE_ALERT_MS, 24 * HOUR);
  assert.equal(isLongIdle({ status: 'idle', statusSince: now - 24 * HOUR }, now), true);
  assert.equal(isLongIdle({ status: 'idle', statusSince: now - 23 * HOUR }, now), false);
  assert.equal(isLongIdle({ status: 'busy', statusSince: now - 48 * HOUR }, now), false);
  assert.equal(isLongIdle({ status: 'idle' }, now), false);
  assert.equal(isLongIdle(undefined, now), false);
});

test('status label in Vietnamese, with how long it has been in that state', () => {
  const now = 100 * HOUR;
  assert.equal(statusLabel({ status: 'idle', statusSince: now - 3 * HOUR }, now), 'Rảnh 3 giờ');
  assert.equal(
    statusLabel({ status: 'busy', statusSince: now - 2 * 60_000 }, now),
    'Đang chạy 2 phút',
  );
  assert.equal(statusLabel({ status: 'waiting', statusSince: now }, now), 'Chờ anh 0 phút');
  assert.equal(statusLabel({ status: 'weird' }, now), 'weird');
  assert.equal(statusLabel({}, now), '');
});

test('session meta that arrives before its character is kept and applied on spawn', () => {
  const os = new OfficeState();
  const meta = { pid: 10, name: 'Kho', rssBytes: GB, status: 'idle', statusSince: 1 };
  os.setAgentSessionMeta(7, meta);
  os.addAgent(7);
  assert.deepEqual(os.characters.get(7)?.sessionMeta, meta);

  const newer = { ...meta, status: 'busy' };
  os.setAgentSessionMeta(7, newer);
  assert.deepEqual(os.characters.get(7)?.sessionMeta, newer);
});
