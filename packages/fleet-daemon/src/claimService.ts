/**
 * ClaimService — Multica-aligned claim with heartbeat freshness gate.
 */
import { RUNTIME_CLAIM_FRESHNESS_MS, type RuntimeRecord } from '@munder/fleet-protocol';
import type { RuntimeRegistry } from './runtimeRegistry.js';
import type { QuotaLedger } from './quotaLedger.js';
import { PlanQuotaExhaustedError } from './quotaLedger.js';

export { PlanQuotaExhaustedError };

export class ClaimConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'ClaimConflictError';
  }
}

export class ClaimStaleError extends Error {
  readonly statusCode = 409;
  constructor(message = 'runtime heartbeat stale — not claimable') {
    super(message);
    this.name = 'ClaimStaleError';
  }
}

export interface ClaimRecord {
  runtimeId: string;
  taskId: string;
  claimedAt: number;
  ownerUserId: string;
}

export class ClaimService {
  private readonly claims = new Map<string, ClaimRecord>(); // taskId → claim

  constructor(
    private readonly runtimes: RuntimeRegistry,
    private readonly quota?: QuotaLedger
  ) {}

  /**
   * Claim a task onto a runtime. Requires online + fresh heartbeat (≤150s).
   * One task → one claim; re-claim same runtime is idempotent.
   */
  claim(taskId: string, runtimeId: string, now = Date.now()): ClaimRecord {
    if (!this.runtimes.isClaimable(runtimeId, now)) {
      throw new ClaimStaleError();
    }
    this.quota?.assertCanClaim(runtimeId, now);
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) throw new ClaimStaleError('runtime not found');

    const existing = this.claims.get(taskId);
    if (existing && existing.runtimeId !== runtimeId) {
      throw new ClaimConflictError(`task ${taskId} already claimed by ${existing.runtimeId}`);
    }
    if (existing && existing.runtimeId === runtimeId) return existing;

    const record: ClaimRecord = {
      runtimeId,
      taskId,
      claimedAt: now,
      ownerUserId: runtime.ownerUserId
    };
    this.claims.set(taskId, record);
    this.quota?.recordClaim(runtimeId, now);
    return record;
  }

  get(taskId: string): ClaimRecord | undefined {
    return this.claims.get(taskId);
  }

  release(taskId: string): boolean {
    return this.claims.delete(taskId);
  }

  list(): ClaimRecord[] {
    return [...this.claims.values()];
  }

  /** Expose freshness constant for contract tests. */
  static get freshnessMs(): number {
    return RUNTIME_CLAIM_FRESHNESS_MS;
  }

  claimableRuntimes(now = Date.now()): RuntimeRecord[] {
    const base = this.runtimes.list().filter((r) => this.runtimes.isClaimable(r.id, now));
    const available = base.filter((r) => !this.quota || this.quota.isAvailable(r.id, now));
    return this.quota ? this.quota.rankRuntimes(available, now) : available;
  }
}
