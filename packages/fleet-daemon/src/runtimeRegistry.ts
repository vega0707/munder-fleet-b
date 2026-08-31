/**
 * RuntimeRegistry — Multica-aligned local runtime registration.
 * ensureLocal() on daemon boot; heartbeat freshness for claim.
 */
import {
  LOCAL_DEFAULT_USER,
  RUNTIME_CLAIM_FRESHNESS_MS,
  type RuntimeRecord
} from '@munder/fleet-protocol';
import { createHash, randomUUID } from 'node:crypto';

export interface EnsureLocalOpts {
  daemonId: string;
  deviceName: string;
  launchedBy?: 'electron' | 'cli' | 'test';
  /** Discovered CLI providers; empty → placeholder offline runtime still registered. */
  providers?: Array<{ name: string; provider: string; version?: string }>;
  ownerUserId?: string;
  now?: number;
}

function stableRuntimeId(daemonId: string, provider: string): string {
  return createHash('sha256').update(`${daemonId}:${provider}`).digest('hex').slice(0, 24);
}

export class RuntimeRegistry {
  private readonly runtimes = new Map<string, RuntimeRecord>();
  private daemonId: string | undefined;

  ensureLocal(opts: EnsureLocalOpts): RuntimeRecord[] {
    const now = opts.now ?? Date.now();
    const ownerUserId = opts.ownerUserId ?? LOCAL_DEFAULT_USER.id;
    this.daemonId = opts.daemonId;
    const providers =
      opts.providers && opts.providers.length > 0
        ? opts.providers
        : [{ name: `local-${opts.deviceName}`, provider: 'local', version: undefined }];

    const out: RuntimeRecord[] = [];
    for (const p of providers) {
      const id = stableRuntimeId(opts.daemonId, p.provider);
      const existing = this.runtimes.get(id);
      const record: RuntimeRecord = {
        id,
        daemonId: opts.daemonId,
        name: p.name,
        provider: p.provider,
        version: p.version,
        status: 'online',
        lastSeenAt: now,
        ownerUserId: existing?.ownerUserId ?? ownerUserId
      };
      this.runtimes.set(id, record);
      out.push(record);
    }
    return out;
  }

  list(): RuntimeRecord[] {
    return [...this.runtimes.values()];
  }

  get(runtimeId: string): RuntimeRecord | undefined {
    return this.runtimes.get(runtimeId);
  }

  heartbeat(
    runtimeId: string,
    now = Date.now()
  ): { status: string; runtimeGone?: boolean; lastSeenAt?: number } {
    const r = this.runtimes.get(runtimeId);
    if (!r || r.status === 'runtime_gone' || r.status === 'offline') {
      return { status: 'runtime_gone', runtimeGone: true };
    }
    r.lastSeenAt = now;
    r.status = 'online';
    return { status: 'ok', lastSeenAt: now };
  }

  /** Claim requires heartbeat freshness ≤ RUNTIME_CLAIM_FRESHNESS_MS. */
  isClaimable(runtimeId: string, now = Date.now()): boolean {
    const r = this.runtimes.get(runtimeId);
    if (!r || r.status !== 'online') return false;
    return now - r.lastSeenAt <= RUNTIME_CLAIM_FRESHNESS_MS;
  }

  markGone(runtimeId: string): void {
    const r = this.runtimes.get(runtimeId);
    if (r) {
      r.status = 'runtime_gone';
      this.runtimes.delete(runtimeId);
    }
  }

  deregisterAll(now = Date.now()): void {
    for (const r of this.runtimes.values()) {
      r.status = 'offline';
      r.lastSeenAt = now;
    }
  }

  /** Test helper — invent an id when none needed. */
  static newDaemonId(): string {
    return `daemon_${randomUUID().slice(0, 8)}`;
  }
}
