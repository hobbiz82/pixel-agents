/**
 * mptl fork: what the Lưu trữ confirm says about a session (git, processes)
 * and the Thùng rác wording.
 *
 * Run with: npm test
 */
import { describe, expect, it } from 'vitest';

import {
  defaultStops,
  deleteConfirmOk,
  deleteResultText,
  gitLine,
  parseInspection,
  processLabel,
} from '../src/office/sessionInspection.js';

describe('parseInspection', () => {
  it('keeps valid fields and drops junk processes', () => {
    const got = parseInspection({
      type: 'sessionInspection',
      id: 3,
      ok: true,
      processes: [
        {
          pid: 10,
          start: 'S',
          name: 'node',
          ports: [3000],
          inbound: 0,
          orphan: false,
          suggest: true,
        },
        { pid: 'x' },
      ],
      mcpCount: 2,
      git: { branch: 'main', changed: 1, unpushed: null },
      lastPrompt: 'Hỏi',
    });
    expect(got).toMatchObject({ id: 3, ok: true, mcpCount: 2, lastPrompt: 'Hỏi' });
    expect(got?.processes).toHaveLength(1);
    expect(got?.git).toEqual({ branch: 'main', changed: 1, unpushed: null });
  });

  it('null for a message that is not an inspection', () => {
    expect(parseInspection({ type: 'x' })).toBeNull();
    expect(parseInspection({ type: 'sessionInspection' })).toBeNull();
  });
});

describe('gitLine', () => {
  it('clean branch', () => {
    expect(gitLine({ branch: 'main', changed: 0, unpushed: 0 })).toEqual({
      text: 'Nhánh main · đã lưu hết',
      warn: false,
    });
  });

  it('warns about uncommitted and unpushed work', () => {
    expect(gitLine({ branch: 'feat/x', changed: 3, unpushed: 2 })).toEqual({
      text: 'Nhánh feat/x · 3 file chưa commit · 2 commit chưa push',
      warn: true,
    });
  });

  it('no upstream means the branch was never pushed', () => {
    expect(gitLine({ branch: 'feat/x', changed: 0, unpushed: null })).toEqual({
      text: 'Nhánh feat/x · chưa từng push',
      warn: true,
    });
  });

  it('says why git could not be read', () => {
    expect(gitLine(undefined, 'blocked')?.text).toMatch(/macOS chặn/);
    expect(gitLine(undefined, 'not_repo')).toEqual({
      text: 'Thư mục không phải repo git',
      warn: false,
    });
    expect(gitLine(undefined, undefined)).toBeNull();
  });
});

describe('processLabel and defaultStops', () => {
  const p = (over: object) => ({
    pid: 1,
    start: 'S',
    name: 'node',
    ports: [] as number[],
    inbound: 0,
    orphan: false,
    suggest: true,
    ...over,
  });

  it('names the process with its ports and whether it was left behind', () => {
    expect(processLabel(p({ ports: [3000, 3001] }))).toBe('node · cổng 3000, 3001');
    expect(processLabel(p({ orphan: true }))).toBe('node · bị bỏ lại');
    expect(processLabel(p({ note: 'Đang có kết nối' }))).toBe('node · Đang có kết nối');
  });

  it('ticks what the server suggests', () => {
    expect(
      defaultStops([p({ pid: 1 }), p({ pid: 2, suggest: false }), p({ pid: 3 })]).sort(),
    ).toEqual([1, 3]);
  });
});

describe('delete wording', () => {
  it('the typed count must match exactly', () => {
    expect(deleteConfirmOk('3', 3)).toBe(true);
    expect(deleteConfirmOk(' 3 ', 3)).toBe(true);
    expect(deleteConfirmOk('03', 3)).toBe(false);
    expect(deleteConfirmOk('', 3)).toBe(false);
    expect(deleteConfirmOk('2', 3)).toBe(false);
  });

  it('tells the result', () => {
    expect(deleteResultText({ total: 2, ok: 2, items: 5, refused: {} })).toBe(
      'Đã bỏ 2 phiên vào Thùng rác (5 mục). Mở Thùng rác để lấy lại nếu cần.',
    );
    expect(deleteResultText({ total: 3, ok: 1, items: 2, refused: { live: 2 } })).toBe(
      'Đã bỏ 1/3 phiên vào Thùng rác (2 mục). 2 phiên đang chạy lại nên không xóa.',
    );
    expect(deleteResultText({ total: 1, ok: 0, items: 0, refused: { failed: 1 } })).toBe(
      'Không xóa được 1 phiên, anh thử lại sau.',
    );
  });
});
