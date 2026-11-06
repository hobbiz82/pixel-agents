import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { AgentStateStore } from '../src/agentStateStore.js';
import { AssistHub } from '../src/assist.js';
import { createHttpServer, type HttpServerHandle } from '../src/httpServer.js';

/** mptl fork (Đ3): the hook endpoint that waits for a decision from the page. */
const TOKEN = 'route-test-token';

function settings(initial: Record<string, unknown>) {
  const data = { ...initial };
  return {
    getSetting: <T>(k: string, d: T): T => (k in data ? (data[k] as T) : d),
    setSetting: <T>(k: string, v: T): void => {
      data[k] = v;
    },
  };
}

const EVENT = {
  session_id: 'sess-1',
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash',
  tool_input: { command: 'ls' },
};

describe('POST /api/hooks/claude/permission', () => {
  let handle: HttpServerHandle | null = null;
  afterEach(async () => {
    await handle?.app.close();
    handle = null;
  });

  async function start(assist?: AssistHub): Promise<HttpServerHandle> {
    handle = await createHttpServer({
      embedded: true,
      token: TOKEN,
      store: new AgentStateStore(),
      assist,
    });
    return handle;
  }

  it('needs the bearer token', async () => {
    const { app } = await start(new AssistHub(settings({})));
    const res = await app.inject({
      method: 'POST',
      url: '/api/hooks/claude/permission',
      payload: EVENT,
    });
    expect(res.statusCode).toBe(401);
  });

  it('answers no decision at once when nothing holds it', async () => {
    const { app } = await start(new AssistHub(settings({ 'mptl.assist.approveFromPage': true })));
    const t0 = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/api/hooks/claude/permission',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: EVENT,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ decision: null });
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('holds for a visible tokened socket and returns its decision', async () => {
    const hub = new AssistHub(settings({ 'mptl.assist.approveFromPage': true }));
    const { port, app } = await start(hub);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const got: Record<string, unknown>[] = [];
    ws.on('message', (d) => got.push(JSON.parse(String(d)) as Record<string, unknown>));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'pageVisibility', visible: true }));
    await new Promise((r) => setTimeout(r, 100));

    const pending = app.inject({
      method: 'POST',
      url: '/api/hooks/claude/permission',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: EVENT,
    });
    let held: { requestId: string } | undefined;
    for (let i = 0; i < 50 && !held; i++) {
      await new Promise((r) => setTimeout(r, 20));
      const last = got.filter((m) => m.type === 'permissionRequests').pop() as
        { requests: { requestId: string }[] } | undefined;
      held = last?.requests[0];
    }
    expect(held).toBeDefined();
    ws.send(
      JSON.stringify({ type: 'decidePermission', requestId: held!.requestId, decision: 'deny' }),
    );
    const res = await pending;
    expect(res.json()).toEqual({ decision: 'deny' });
    ws.close();
  });
});
