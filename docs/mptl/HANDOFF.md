# mptl fork — handoff

> **Tóm tắt cho anh:** đây là bản fork pixel-agents chạy trên Mac mini (dịch vụ `com.mptl.pixel-agents`, cổng 3300). File này để giao cho ChatGPT/Codex làm tiếp: fork đã làm gì, chạy kiểm thế nào, luật an toàn, và việc đồ họa đang mở (mục 5).

Branch history: `mptl` was fast-forwarded into `main` on 2026-11-02; work on a feature branch off `main` and open a PR.

## 1. What this fork adds (on top of upstream v1.5.0)

| Area                                | Files                                                                                                                           | What                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Every live session gets a character | `server/src/sessionMeta.ts`, `server/src/fileWatcher.ts` (`adoptLiveSessions`)                                                  | Reads `~/.claude/sessions/<pid>.json` + `ps` every 15 s; a running Claude session is shown however long it has been idle. |
| Codex sessions                      | `server/src/codexSessions.ts`, `server/src/providers/hook/codex/`                                                               | Rollouts in `~/.codex/sessions` written in the last 24 h become characters; Guardian/sub-agent threads are hidden.        |
| Labels                              | `webview-ui/src/office/sessionMetaLabels.ts`, `sessionRows.ts`                                                                  | Session name, Claude/Codex tag, idle time ("Rảnh N giờ", amber at ≥ 24 h), RAM.                                           |
| Card bar + "Phiên" table            | `webview-ui/src/components/AgentCardBar.tsx`, `SessionsModal.tsx`                                                               | Names beside mug shots; one table of all sessions sorted waiting → running → idle.                                        |
| 6-room office                       | `webview-ui/public/assets/default-layout-2.json`, `scripts/mptl-build-office-layout.ts`                                         | 3×2 copies of the original room; rooms named after project folders.                                                       |
| Archive / restore                   | `server/src/sessionArchive.ts`, `clientMessageHandler.ts`, `webview-ui/src/office/sessionArchive.ts`, `ArchiveConfirmModal.tsx` | See §3.                                                                                                                   |

UI text is Vietnamese (the user is addressed as "anh"). Keep that.

## 2. Checks before every commit

```bash
npm run check-types
(cd webview-ui && npx tsc -b)
npm run lint            # 0 errors; 1 old warning in App.tsx is known
npm run format:check
(cd webview-ui && npx vitest run)
(cd server && npx vitest run)
npm run test:package-contract
```

- `core/src/messages.ts` is **generated** from `core/asyncapi.yaml` (`npm run asyncapi:generate`, also run by `npm pack`). Never edit it by hand: add messages to the yaml and regenerate.
- Write the failing test first; never weaken a test to make it pass.

## 3. Safety rules (do not relax)

- Archive is the only feature that acts on the machine. Claude: `SIGTERM` to the session's own pid only after re-reading its session record (same `sessionId`, idle, start time equal to `ps -o lstart` **in UTC**, binary is `claude`). Never `SIGKILL`, never a process group. Codex: `codex archive|unarchive <id>` via `execFile` (no shell).
- Refuse while a session is `busy` or `waiting` (the owner confirmed: keep this lock). One session per action, always after a confirm dialog. No hard delete.
- A client without the server token is read-only: every message except `webviewReady` is refused in `handleClientMessage`. New message types are privileged by default; keep it that way.
- Never print or commit the page token, `~/.config/local-ai/*.env`, or process command lines.

## 4. Assets today

- 16 px tiles (`TILE_SIZE` in `webview-ui/src/constants.ts`), top-down, drawn on a canvas by `webview-ui/src/office/engine/renderer.ts`.
- Furniture: one folder per item with `manifest.json` (format in `docs/external-assets.md`). External packs load via Settings → Add Asset Directory.
- Characters: 112×96 PNG sheets (7 columns × 16 px, 3 rows × 32 px) in `webview-ui/public/assets/characters/`.
- Licences: only CC0 or self-made art goes into this public repo. Paid packs (Donarg, LimeZu) stay outside the repo and load as an external directory.

## 5. Open work: nicer graphics (owner has not chosen yet)

The owner likes an isometric, softly lit "Agent Office" look (reference image: https://i.redd.it/z8dkyb86tgvh1.png): a rendered room per floor, cute character figures with name pills, a Day / Night switch, and a room list beside the scene. It is painted / 3D-rendered art, not pixel art, so it cannot be reached by swapping tiles in the current renderer.

| #                      | Approach                                                                                                                                                                                                                                                                                                                                                                                        | Size    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| P1 (recommended first) | New **scene mode**: per room one background image (isometric, Day + Night versions) plus a JSON of seat anchor points; each agent is a static figure image placed on a free anchor, with its name pill and status dot. Moving between rooms = fade, no walking. Images can be made with an image model (transparent PNG figures, same prompt style). Keep the pixel office as the default mode. | Medium  |
| P2                     | Isometric tile engine: iso floor/wall tiles, iso furniture sprites, depth sorting, 4-direction walking sheets, iso layout editor.                                                                                                                                                                                                                                                               | Large   |
| P3                     | Real 3D (three.js, GLB models, camera, lights).                                                                                                                                                                                                                                                                                                                                                 | Largest |

For P1 the asset contract to agree first: background size per room, anchor JSON format (`{id, x, y, facing}` in background pixels), figure size and pivot (feet point), where the files live (outside the repo unless CC0/self-made), and how a room maps to a project folder (reuse the 6-room folder mapping).

## 6. Run on the Mac mini

`bash /Users/seb/local-ai-system/mac-node/pixel-agents/install.sh` packs the fork (`npm pack`, which runs the checks and the build) and restarts the launchd service. The installed sha is in `$(npm root -g)/pixel-agents/.mptl-sha`. Check UI changes read-only: open the page, never confirm an archive on real sessions.
