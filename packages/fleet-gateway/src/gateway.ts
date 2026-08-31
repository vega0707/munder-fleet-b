/**
 * FleetGateway — Aion-aligned Local vs userSession identity.
 * Local mode (Electron): fixed system user, no JWT/CSRF.
 * userSession: password/token + double-submit CSRF on mutating routes.
 * NOT "any 127.0.0.1 is anonymous".
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  LOCAL_DEFAULT_USER,
  type AuthIdentityMode,
  type AuthStatus,
  type FleetUser,
  type LoginResponse
} from '@munder/fleet-protocol';
import { SessionStore } from './sessionStore.js';

export const SESSION_COOKIE = 'fleet-session';
export const CSRF_COOKIE = 'fleet-csrf-token';
export const CSRF_HEADER = 'x-csrf-token';

const CSRF_EXEMPT = new Set(['/login', '/logout', '/api/auth/status', '/health']);

export interface GatewayOpts {
  identityMode: AuthIdentityMode;
  store?: SessionStore;
  port?: number;
  host?: string;
  daemonUrl?: string;
}

export class FleetGateway {
  readonly store: SessionStore;
  readonly identityMode: AuthIdentityMode;
  private server: Server | undefined;
  private readonly daemonUrl: string | undefined;
  private readonly host: string;
  private readonly port: number;

  constructor(opts: GatewayOpts) {
    this.identityMode = opts.identityMode;
    this.store = opts.store ?? new SessionStore();
    this.daemonUrl = opts.daemonUrl;
    this.host = opts.host ?? '127.0.0.1';
    this.port = opts.port ?? 25808;
  }

  resolveUser(req: IncomingMessage): FleetUser | null {
    if (this.identityMode === 'local') {
      return LOCAL_DEFAULT_USER;
    }
    const token = extractToken(req);
    if (!token) return null;
    return this.store.resolveToken(token);
  }

  authStatus(user: FleetUser | null): AuthStatus {
    return {
      success: true,
      needsSetup: this.store.userCount() === 0,
      userCount: this.store.userCount(),
      isAuthenticated: !!user,
      identityMode: this.identityMode
    };
  }

  login(username: string, password: string): LoginResponse | { error: string; status: number } {
    if (username.length > 32 || password.length > 128) {
      return { error: 'invalid credentials length', status: 400 };
    }
    if (this.store.userCount() === 0) {
      this.store.createUser(username, password);
    }
    const user = this.store.verifyPassword(username, password);
    if (!user) return { error: 'Invalid username or password', status: 401 };
    const token = this.store.createSession(user);
    return { success: true, user, token };
  }

  /** CSRF check — Local mode always passes; GET/HEAD/OPTIONS pass; exempt paths pass. */
  csrfOk(req: IncomingMessage, path: string): boolean {
    if (this.identityMode === 'local') return true;
    const method = (req.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
    if (CSRF_EXEMPT.has(path)) return true;
    // Bearer / PAT API clients skip cookie CSRF (native clients)
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) return true;
    const cookieToken = parseCookie(req.headers.cookie)[CSRF_COOKIE] ?? '';
    const headerToken = String(req.headers[CSRF_HEADER] ?? '');
    return csrfTokensEqual(cookieToken, headerToken);
  }

  async listen(): Promise<{ host: string; port: number }> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, this.host, () => resolve());
    });
    return { host: this.host, port: this.port };
  }

  async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => (err ? reject(err) : resolve()));
    });
    this.server = undefined;
  }

  async handleForTest(
    method: string,
    path: string,
    opts: {
      headers?: Record<string, string>;
      body?: unknown;
      cookies?: Record<string, string>;
    } = {}
  ): Promise<{ status: number; body: unknown; headers: Record<string, string | string[] | undefined> }> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.cookies && Object.keys(opts.cookies).length) {
      headers.cookie = Object.entries(opts.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    }
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : '';
    if (bodyStr) headers['content-type'] = 'application/json';

    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let statusCode = 200;
      const outHeaders: Record<string, string | string[] | undefined> = {};
      const res = {
        writeHead(status: number, h?: Record<string, string | number>) {
          statusCode = status;
          if (h) {
            for (const [k, v] of Object.entries(h)) outHeaders[k.toLowerCase()] = String(v);
          }
          return res;
        },
        setHeader(k: string, v: string | string[]) {
          const key = k.toLowerCase();
          if (key === 'set-cookie') {
            const prev = outHeaders[key];
            const next = Array.isArray(v) ? v : [v];
            outHeaders[key] = prev
              ? [...(Array.isArray(prev) ? prev : [prev]), ...next]
              : next.length === 1
                ? next[0]
                : next;
            return;
          }
          outHeaders[key] = v;
        },
        end(payload?: string | Buffer) {
          if (payload) chunks.push(Buffer.isBuffer(payload) ? payload : Buffer.from(payload));
          const raw = Buffer.concat(chunks).toString('utf8');
          let body: unknown = raw;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch {
            /* keep string */
          }
          resolve({ status: statusCode, body, headers: outHeaders });
        }
      } as unknown as ServerResponse;

      const req = {
        method,
        url: path,
        headers,
        on(event: string, cb: (...args: unknown[]) => void) {
          if (event === 'data' && bodyStr) cb(Buffer.from(bodyStr));
          if (event === 'end') cb();
          return req;
        }
      } as unknown as IncomingMessage;

      void this.handle(req, res);
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${this.host}:${this.port}`);
    const path = url.pathname;

    try {
      if (!this.csrfOk(req, path)) {
        return sendJson(res, 403, { error: 'CSRF_INVALID' });
      }

      if (req.method === 'GET' && path === '/health') {
        return sendJson(res, 200, { ok: true, identityMode: this.identityMode });
      }

      if (req.method === 'GET' && path === '/api/auth/status') {
        const user = this.resolveUser(req);
        return sendJson(res, 200, this.authStatus(user));
      }

      if (req.method === 'POST' && path === '/login') {
        if (this.identityMode === 'local') {
          return sendJson(res, 200, {
            success: true,
            user: LOCAL_DEFAULT_USER,
            token: 'local-mode-no-token'
          } satisfies LoginResponse);
        }
        const body = JSON.parse(await readBody(req)) as { username?: string; password?: string };
        const result = this.login(body.username ?? '', body.password ?? '');
        if ('error' in result) return sendJson(res, result.status, { error: result.error });
        const csrf = randomBytes(24).toString('base64url');
        setAuthCookies(res, result.token, csrf);
        return sendJson(res, 200, { ...result, csrf });
      }

      if (req.method === 'POST' && path === '/logout') {
        const token = extractToken(req);
        if (token) this.store.revokeToken(token);
        clearAuthCookies(res);
        return sendJson(res, 200, { success: true });
      }

      if (req.method === 'POST' && path === '/api/auth/tokens') {
        const user = this.requireUser(req, res);
        if (!user) return;
        const body = JSON.parse(await readBody(req)) as { label?: string };
        const token = this.store.createApiToken(user, body.label);
        return sendJson(res, 200, { token });
      }

      if (req.method === 'GET' && path === '/api/me') {
        const user = this.requireUser(req, res);
        if (!user) return;
        return sendJson(res, 200, { user });
      }

      if (this.daemonUrl && path.startsWith('/api/daemon/')) {
        const user = this.requireUser(req, res);
        if (!user) return;
        const upstream = `${this.daemonUrl}${path.slice('/api/daemon'.length)}`;
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
        const upstreamRes = await fetch(upstream, {
          method: req.method,
          headers: { 'content-type': 'application/json', 'x-fleet-user': user.id },
          body
        });
        const text = await upstreamRes.text();
        res.writeHead(upstreamRes.status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(text);
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      sendJson(res, 500, { error: e instanceof Error ? e.message : 'internal' });
    }
  }

  private requireUser(req: IncomingMessage, res: ServerResponse): FleetUser | null {
    const user = this.resolveUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'unauthorized' });
      return null;
    }
    return user;
  }
}

export function extractToken(req: IncomingMessage): string {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const cookies = parseCookie(req.headers.cookie);
  return cookies[SESSION_COOKIE] ?? '';
}

function parseCookie(header: string | string[] | undefined): Record<string, string> {
  const raw = Array.isArray(header) ? header.join(';') : (header ?? '');
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('='));
  }
  return out;
}

function csrfTokensEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function setAuthCookies(res: ServerResponse, token: string, csrf: string): void {
  res.setHeader('set-cookie', [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`,
    `${CSRF_COOKIE}=${encodeURIComponent(csrf)}; Path=/; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
  ]);
}

function clearAuthCookies(res: ServerResponse): void {
  res.setHeader('set-cookie', [
    `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`,
    `${CSRF_COOKIE}=; Path=/; Max-Age=0`
  ]);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c) => {
      size += (c as Buffer).length;
      if (size > 1_000_000) {
        reject(new Error('body too large'));
        return;
      }
      chunks.push(c as Buffer);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8') || '{}'));
    req.on('error', reject);
  });
}
