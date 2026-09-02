/**
 * QuotaLedger — per-plan budget state; passive rate-limit + optional proactive limits.
 */
import type {
  PlanBudgetConfig,
  QuotaCooldownReason,
  RuntimeQuotaSnapshot,
  RuntimeRecord
} from '@munder/fleet-protocol';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlanRegistry } from './planRegistry.js';
import type { RuntimeRegistry } from './runtimeRegistry.js';
import { parseRateLimitSignal } from './rateLimitParser.js';

interface QuotaStateRow {
  runtimeId: string;
  planId: string;
  tasksInWindow: number;
  consecutiveTasks: number;
  windowStartedAt: number;
  cooldownUntil: number | null;
  cooldownReason?: QuotaCooldownReason;
  cooldownDetail?: string;
}

export class PlanQuotaExhaustedError extends Error {
  readonly statusCode = 409;
  constructor(
    message: string,
    readonly snapshot: RuntimeQuotaSnapshot
  ) {
    super(message);
    this.name = 'PlanQuotaExhaustedError';
  }
}

export class QuotaLedger {
  private readonly filePath: string;
  private rows = new Map<string, QuotaStateRow>();

  constructor(
    hiveDir: string,
    private readonly plans: PlanRegistry,
    private readonly runtimes: RuntimeRegistry
  ) {
    mkdirSync(hiveDir, { recursive: true });
    this.filePath = join(hiveDir, 'quota-state.json');
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as QuotaStateRow[];
      if (!Array.isArray(raw)) return;
      for (const row of raw) this.rows.set(row.runtimeId, { ...row });
    } catch {
      /* empty */
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify([...this.rows.values()], null, 2), 'utf8');
  }

  resolvePlan(runtime: RuntimeRecord): PlanBudgetConfig | undefined {
    if (runtime.planId) return this.plans.get(runtime.planId);
    return this.plans.byProvider(runtime.provider);
  }

  private rowFor(runtime: RuntimeRecord, now: number): QuotaStateRow {
    const plan = this.resolvePlan(runtime);
    const planId = plan?.planId ?? `provider:${runtime.provider}`;
    let row = this.rows.get(runtime.id);
    if (!row) {
      row = {
        runtimeId: runtime.id,
        planId,
        tasksInWindow: 0,
        consecutiveTasks: 0,
        windowStartedAt: now,
        cooldownUntil: null
      };
      this.rows.set(runtime.id, row);
    }
    if (row.planId !== planId) row.planId = planId;
    return row;
  }

  private maybeResetWindow(row: QuotaStateRow, plan: PlanBudgetConfig | undefined, now: number): void {
    const windowMs = plan?.limits?.windowMs;
    if (!windowMs) return;
    if (now - row.windowStartedAt >= windowMs) {
      row.tasksInWindow = 0;
      row.windowStartedAt = now;
    }
  }

  isAvailable(runtimeId: string, now = Date.now()): boolean {
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) return false;
    const plan = this.resolvePlan(runtime);
    const row = this.rowFor(runtime, now);
    this.maybeResetWindow(row, plan, now);
    if (row.cooldownUntil !== null && now < row.cooldownUntil) return false;
    if (row.cooldownUntil !== null && now >= row.cooldownUntil) {
      row.cooldownUntil = null;
      row.cooldownReason = undefined;
      row.cooldownDetail = undefined;
      this.persist();
    }
    return true;
  }

  assertCanClaim(runtimeId: string, now = Date.now()): void {
    if (this.isAvailable(runtimeId, now)) return;
    const snap = this.snapshot(runtimeId, now);
    throw new PlanQuotaExhaustedError(
      `plan ${snap.planId} in cooldown until ${snap.cooldownUntil}`,
      snap
    );
  }

  recordClaim(runtimeId: string, now = Date.now()): RuntimeQuotaSnapshot {
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) throw new Error(`runtime not found: ${runtimeId}`);
    const plan = this.resolvePlan(runtime);
    const row = this.rowFor(runtime, now);
    this.maybeResetWindow(row, plan, now);
    row.tasksInWindow += 1;
    row.consecutiveTasks += 1;
    this.applyProactiveLimits(row, plan, now);
    this.persist();
    return this.snapshot(runtimeId, now);
  }

  private applyProactiveLimits(
    row: QuotaStateRow,
    plan: PlanBudgetConfig | undefined,
    now: number
  ): void {
    if (!plan?.limits) return;
    const lim = plan.limits;
    if (
      lim.maxConsecutiveTasks !== undefined &&
      lim.consecutiveCooldownMs !== undefined &&
      row.consecutiveTasks >= lim.maxConsecutiveTasks
    ) {
      this.enterCooldown(row, now + lim.consecutiveCooldownMs, 'consecutive_exhausted');
      row.consecutiveTasks = 0;
      return;
    }
    if (
      lim.maxTasksPerWindow !== undefined &&
      lim.windowExhaustedCooldownMs !== undefined &&
      row.tasksInWindow >= lim.maxTasksPerWindow
    ) {
      this.enterCooldown(row, now + lim.windowExhaustedCooldownMs, 'window_exhausted');
    }
  }

  private enterCooldown(
    row: QuotaStateRow,
    until: number,
    reason: QuotaCooldownReason,
    detail?: string
  ): void {
    row.cooldownUntil = until;
    row.cooldownReason = reason;
    if (detail) row.cooldownDetail = detail;
  }

  /**
   * Passive rate-limit from CLI stderr/stdout. Uses parsed retry-after when present;
   * otherwise requires plan.limits.rateLimitFallbackCooldownMs or skips proactive cooldown.
   */
  applyRateLimitSignal(
    runtimeId: string,
    signal: string,
    now = Date.now(),
    fallbackCooldownMs?: number
  ): RuntimeQuotaSnapshot | null {
    const parsed = parseRateLimitSignal(signal);
    if (!parsed) return null;
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) return null;
    const row = this.rowFor(runtime, now);
    let ms = parsed.cooldownMs;
    if (ms <= 0) {
      const plan = this.resolvePlan(runtime);
      ms = plan?.limits?.rateLimitFallbackCooldownMs ?? fallbackCooldownMs ?? 0;
      if (ms <= 0) return null;
    }
    this.enterCooldown(row, now + ms, 'rate_limit', parsed.detail);
    row.consecutiveTasks = 0;
    this.persist();
    return this.snapshot(runtimeId, now);
  }

  applyCooldown(
    runtimeId: string,
    cooldownMs: number,
    reason: QuotaCooldownReason,
    detail?: string,
    now = Date.now()
  ): RuntimeQuotaSnapshot {
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) throw new Error(`runtime not found: ${runtimeId}`);
    const row = this.rowFor(runtime, now);
    this.enterCooldown(row, now + cooldownMs, reason, detail);
    row.consecutiveTasks = 0;
    this.persist();
    return this.snapshot(runtimeId, now);
  }

  /** Clear expired cooldowns; returns runtime ids that became claimable. */
  resumeExpired(now = Date.now()): string[] {
    const resumed: string[] = [];
    for (const runtime of this.runtimes.list()) {
      const wasBlocked = this.rows.get(runtime.id)?.cooldownUntil;
      if (!wasBlocked || now < wasBlocked) continue;
      if (this.isAvailable(runtime.id, now)) resumed.push(runtime.id);
    }
    return resumed;
  }

  windowHeadroom(row: QuotaStateRow, plan: PlanBudgetConfig | undefined): number | null {
    const max = plan?.limits?.maxTasksPerWindow;
    if (max === undefined) return null;
    return Math.max(0, max - row.tasksInWindow);
  }

  snapshot(runtimeId: string, now = Date.now()): RuntimeQuotaSnapshot {
    const runtime = this.runtimes.get(runtimeId);
    if (!runtime) {
      return {
        runtimeId,
        planId: 'unknown',
        available: false,
        cooldownUntil: null,
        tasksInWindow: 0,
        consecutiveTasks: 0,
        windowStartedAt: now,
        windowHeadroom: null
      };
    }
    const plan = this.resolvePlan(runtime);
    const row = this.rowFor(runtime, now);
    this.maybeResetWindow(row, plan, now);
    const inCooldown = row.cooldownUntil !== null && now < row.cooldownUntil;
    return {
      runtimeId,
      planId: row.planId,
      available: !inCooldown,
      cooldownUntil: inCooldown ? row.cooldownUntil : null,
      cooldownReason: inCooldown ? row.cooldownReason : undefined,
      cooldownDetail: inCooldown ? row.cooldownDetail : undefined,
      tasksInWindow: row.tasksInWindow,
      consecutiveTasks: row.consecutiveTasks,
      windowStartedAt: row.windowStartedAt,
      windowHeadroom: this.windowHeadroom(row, plan)
    };
  }

  listSnapshots(now = Date.now()): RuntimeQuotaSnapshot[] {
    return this.runtimes.list().map((r) => this.snapshot(r.id, now));
  }

  /** Pick runtime with most window headroom (null headroom = unlimited, sorted last as tie-break). */
  rankRuntimes(runtimes: RuntimeRecord[], now = Date.now()): RuntimeRecord[] {
    return [...runtimes].sort((a, b) => {
      const ha = this.snapshot(a.id, now).windowHeadroom;
      const hb = this.snapshot(b.id, now).windowHeadroom;
      if (ha === null && hb === null) return 0;
      if (ha === null) return 1;
      if (hb === null) return -1;
      return hb - ha;
    });
  }
}
