/**
 * Contract: Electron uses Local gateway — same gateway Web uses with userSession.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_DEFAULT_USER } from '@munder/fleet-protocol';
import { ElectronFleetClient } from '../src/client.js';

describe('ElectronFleetClient Local wiring', () => {
  it('assertLocalIdentity accepts local gateway responses', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/api/auth/status')) {
        return new Response(
          JSON.stringify({
            success: true,
            needsSetup: false,
            userCount: 0,
            isAuthenticated: true,
            identityMode: 'local'
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/me')) {
        return new Response(JSON.stringify({ user: LOCAL_DEFAULT_USER }), { status: 200 });
      }
      return new Response('no', { status: 404 });
    }) as typeof fetch;

    const client = new ElectronFleetClient({
      gatewayUrl: 'http://127.0.0.1:25808',
      fetchImpl
    });
    const user = await client.assertLocalIdentity();
    assert.equal(user.id, LOCAL_DEFAULT_USER.id);
    assert.ok(calls.some((u) => u.includes('/api/auth/status')));
    assert.ok(calls.some((u) => u.includes('/api/me')));
  });

  it('rejects userSession gateway as Electron wiring error', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          success: true,
          needsSetup: true,
          userCount: 0,
          isAuthenticated: false,
          identityMode: 'userSession'
        }),
        { status: 200 }
      )) as typeof fetch;
    const client = new ElectronFleetClient({
      gatewayUrl: 'http://127.0.0.1:25808',
      fetchImpl
    });
    await assert.rejects(() => client.assertLocalIdentity(), /identityMode=local/);
  });
});
