/**
 * Session store — SQLite-backed access tokens (Aion session generation analogue).
 * Uses Node 22 node:sqlite.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FleetUser } from '@munder/fleet-protocol';

const SCRYPT_KEYLEN = 64;

export interface SessionRecord {
  token: string;
  userId: string;
  username: string;
  sessionGeneration: number;
  createdAt: number;
  expiresAt: number;
}

export class SessionStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string = ':memory:') {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        session_generation INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_generation INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS api_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        label TEXT,
        created_at INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  userCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    return Number(row.c);
  }

  createUser(username: string, password: string): FleetUser {
    const id = `user_${createHash('sha256').update(username).digest('hex').slice(0, 12)}`;
    const passwordHash = hashPassword(password);
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO users (id, username, password_hash, session_generation, created_at) VALUES (?, ?, ?, 1, ?)'
      )
      .run(id, username, passwordHash, now);
    return { id, username };
  }

  verifyPassword(username: string, password: string): FleetUser | null {
    const row = this.db
      .prepare('SELECT id, username, password_hash, session_generation FROM users WHERE username = ?')
      .get(username) as
      | { id: string; username: string; password_hash: string; session_generation: number }
      | undefined;
    // Dummy verify for timing when user missing
    const hash = row?.password_hash ?? hashPassword('dummy-timing-pad');
    const ok = verifyPassword(password, hash);
    if (!row || !ok) return null;
    return { id: row.id, username: row.username };
  }

  /** Password login → opaque access token (30d). */
  createSession(user: FleetUser, ttlMs = 30 * 24 * 60 * 60 * 1000): string {
    const gen = this.sessionGeneration(user.id);
    const token = `flt_${randomBytes(32).toString('base64url')}`;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, session_generation, created_at, expires_at, revoked)
         VALUES (?, ?, ?, ?, ?, 0)`
      )
      .run(hashToken(token), user.id, gen, now, now + ttlMs);
    return token;
  }

  /** Long-lived API token (PAT-style). */
  createApiToken(user: FleetUser, label = 'default'): string {
    const token = `pat_${randomBytes(24).toString('base64url')}`;
    this.db
      .prepare(
        `INSERT INTO api_tokens (token_hash, user_id, label, created_at, revoked) VALUES (?, ?, ?, ?, 0)`
      )
      .run(hashToken(token), user.id, label, Date.now());
    return token;
  }

  resolveToken(token: string): FleetUser | null {
    if (!token) return null;
    const th = hashToken(token);
    if (token.startsWith('pat_')) {
      const row = this.db
        .prepare(
          `SELECT u.id, u.username FROM api_tokens t
           JOIN users u ON u.id = t.user_id
           WHERE t.token_hash = ? AND t.revoked = 0`
        )
        .get(th) as { id: string; username: string } | undefined;
      return row ? { id: row.id, username: row.username } : null;
    }
    const row = this.db
      .prepare(
        `SELECT s.user_id, s.session_generation, s.expires_at, s.revoked, u.username, u.session_generation AS user_gen
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`
      )
      .get(th) as
      | {
          user_id: string;
          session_generation: number;
          expires_at: number;
          revoked: number;
          username: string;
          user_gen: number;
        }
      | undefined;
    if (!row || row.revoked || row.expires_at < Date.now()) return null;
    if (row.session_generation !== row.user_gen) return null;
    return { id: row.user_id, username: row.username };
  }

  revokeToken(token: string): void {
    const th = hashToken(token);
    this.db.prepare('UPDATE sessions SET revoked = 1 WHERE token_hash = ?').run(th);
    this.db.prepare('UPDATE api_tokens SET revoked = 1 WHERE token_hash = ?').run(th);
  }

  bumpSessionGeneration(userId: string): void {
    this.db
      .prepare('UPDATE users SET session_generation = session_generation + 1 WHERE id = ?')
      .run(userId);
  }

  private sessionGeneration(userId: string): number {
    const row = this.db
      .prepare('SELECT session_generation FROM users WHERE id = ?')
      .get(userId) as { session_generation: number } | undefined;
    return row?.session_generation ?? 1;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'base64url');
  const expected = Buffer.from(parts[2]!, 'base64url');
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
