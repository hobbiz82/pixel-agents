/**
 * mptl fork: labels shown for a Claude Code session (name, RAM, idle time).
 * Pure functions so they are testable without React.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { CLAUDE_TAG_COLOR, CODEX_TAG_COLOR } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import {
  formatIdle,
  formatRam,
  IDLE_ALERT_MS,
  isLongIdle,
  originLabel,
  providerTag,
  sessionDetail,
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

test('every session says whether Claude or Codex runs it, in words as well as colour', () => {
  assert.deepEqual(providerTag({ provider: 'claude' }), {
    label: 'Claude',
    color: CLAUDE_TAG_COLOR,
  });
  assert.deepEqual(providerTag({ provider: 'codex' }), { label: 'Codex', color: CODEX_TAG_COLOR });
  assert.notEqual(CLAUDE_TAG_COLOR, CODEX_TAG_COLOR);
  assert.equal(providerTag({}), null);
  assert.equal(providerTag(undefined), null);
});

test('session detail leaves out RAM and PID when the session has none (Codex)', () => {
  const now = 100 * HOUR;
  assert.equal(
    sessionDetail({ provider: 'codex', status: 'idle', statusSince: now - 2 * HOUR }, now, 40),
    'Rảnh 2 giờ · Context 40%',
  );
  assert.equal(
    sessionDetail(
      { provider: 'claude', pid: 12, rssBytes: 2 * GB, status: 'busy', statusSince: now },
      now,
      null,
    ),
    'Đang chạy 0 phút · RAM 2,0 GB · PID 12',
  );
});

test('origin says where anh finds the session (app, Terminal, claude.ai/code, SDK)', () => {
  assert.equal(originLabel('app'), 'Ở app Claude');
  assert.equal(originLabel('terminal'), 'Ở Terminal');
  assert.equal(originLabel('remote'), 'Ở claude.ai/code');
  assert.equal(originLabel('sdk'), 'Chạy nền (SDK)');
  assert.equal(originLabel(undefined), '');
});

test('session detail puts the origin right before the PID (mptl-kho-96 is in Terminal)', () => {
  const now = 100 * HOUR;
  assert.equal(
    sessionDetail(
      {
        provider: 'claude',
        pid: 1917,
        origin: 'terminal',
        status: 'idle',
        statusSince: now - 3 * HOUR,
      },
      now,
      null,
    ),
    'Rảnh 3 giờ · Ở Terminal · PID 1917',
  );
});
