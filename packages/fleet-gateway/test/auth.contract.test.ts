/**
 * Contract: Gateway session auth + Local identity (Aion WebUi / Local).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_DEFAULT_USER } from '@munder/fleet-protocol';
import { FleetGateway, SESSION_COOKIE, CSRF_COOKIE, CSRF_HEADER } from '../src/gateway.js';
import { SessionStore } from '../src/sessionStore.js';

describe('Gateway userSession auth', () => {
  let gw: FleetGateway;

  beforeEach(() => {
    gw = new FleetGateway({ identityMode: 'userSession', store: new SessionStore() });
  });

  it('password login returns token and authenticates Bearer', async () => {
    const login = await gw.handleForTest('POST', '/login', {
      body: { username: 'alice', password: 'secret-pass' }
    });
    assert.equal(login.status, 200);
    const body = login.body as { success: boolean; token: string; user: { username: string } };
    assert.equal(body.success, true);
    assert.ok(body.token.startsWith('flt_'));
    assert.equal(body.user.username, 'alice');
    assert.ok(String(login.headers['set-cookie'] ?? '').includes(SESSION_COOKIE));

    const me = await gw.handleForTest('GET', '/api/me', {
      headers: { authorization: `Bearer ${body.token}` }
    });
    assert.equal(me.status, 200);
    assert.equal((me.body as { user: { username: string } }).user.username, 'alice');
  });

  it('session cookie authenticates without Bearer', async () => {
    const login = await gw.handleForTest('POST', '/login', {
      body: { username: 'bob', password: 'pw-bob-ok' }
    });
    const token = (login.body as { token: string }).token;
    const me = await gw.handleForTest('GET', '/api/me', {
      cookies: { [SESSION_COOKIE]: token }
    });
    assert.equal(me.status, 200);
  });

  it('wrong password → 401', async () => {
    await gw.handleForTest('POST', '/login', {
      body: { username: 'alice', password: 'correct-horse' }
    });
    const bad = await gw.handleForTest('POST', '/login', {
      body: { username: 'alice', password: 'wrong' }
    });
    assert.equal(bad.status, 401);
  });

  it('unauthenticated protected route → 401', async () => {
    const me = await gw.handleForTest('GET', '/api/me');
    assert.equal(me.status, 401);
  });

  it('logout revokes token', async () => {
    const login = await gw.handleForTest('POST', '/login', {
      body: { username: 'carol', password: 'pw-carol' }
    });
    const token = (login.body as { token: string }).token;
    await gw.handleForTest('POST', '/logout', {
      headers: { authorization: `Bearer ${token}` }
    });
    const me = await gw.handleForTest('GET', '/api/me', {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(me.status, 401);
  });

  it('cookie-only mutating request without CSRF → 403', async () => {
    const login = await gw.handleForTest('POST', '/login', {
      body: { username: 'erin', password: 'pw-erin-ok' }
    });
    const token = (login.body as { token: string }).token;
    const csrf = (login.body as { csrf: string }).csrf;
    assert.ok(csrf);
    const denied = await gw.handleForTest('POST', '/api/auth/tokens', {
      cookies: { [SESSION_COOKIE]: token, [CSRF_COOKIE]: csrf }
      // missing x-csrf-token header
    });
    assert.equal(denied.status, 403);
    const ok = await gw.handleForTest('POST', '/api/auth/tokens', {
      cookies: { [SESSION_COOKIE]: token, [CSRF_COOKIE]: csrf },
      headers: { [CSRF_HEADER]: csrf },
      body: { label: 'web' }
    });
    assert.equal(ok.status, 200);
  });

  it('API token (PAT) authenticates', async () => {
    const login = await gw.handleForTest('POST', '/login', {
      body: { username: 'dave', password: 'pw-dave' }
    });
    const session = (login.body as { token: string }).token;
    const minted = await gw.handleForTest('POST', '/api/auth/tokens', {
      headers: { authorization: `Bearer ${session}` },
      body: { label: 'ci' }
    });
    const pat = (minted.body as { token: string }).token;
    assert.ok(pat.startsWith('pat_'));
    const me = await gw.handleForTest('GET', '/api/me', {
      headers: { authorization: `Bearer ${pat}` }
    });
    assert.equal(me.status, 200);
  });

  it('auth status reports needsSetup before first user', async () => {
    const status = await gw.handleForTest('GET', '/api/auth/status');
    assert.equal(status.status, 200);
    const body = status.body as { needsSetup: boolean; identityMode: string };
    assert.equal(body.needsSetup, true);
    assert.equal(body.identityMode, 'userSession');
  });
});

describe('Gateway local identity (Electron)', () => {
  it('local mode injects system_default_user without credentials', async () => {
    const gw = new FleetGateway({ identityMode: 'local' });
    const me = await gw.handleForTest('GET', '/api/me');
    assert.equal(me.status, 200);
    assert.deepEqual((me.body as { user: unknown }).user, LOCAL_DEFAULT_USER);
  });

  it('local mode is NOT IP loopback bypass — identityMode flag only', async () => {
    // Same process, userSession still requires auth even on 127.0.0.1 binding.
    const gw = new FleetGateway({ identityMode: 'userSession', host: '127.0.0.1' });
    const me = await gw.handleForTest('GET', '/api/me');
    assert.equal(me.status, 401);
  });

  it('auth status exposes identityMode=local', async () => {
    const gw = new FleetGateway({ identityMode: 'local' });
    const status = await gw.handleForTest('GET', '/api/auth/status');
    const body = status.body as { identityMode: string; isAuthenticated: boolean };
    assert.equal(body.identityMode, 'local');
    assert.equal(body.isAuthenticated, true);
  });
});
