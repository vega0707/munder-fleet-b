/**
 * Scans PTY / hook output for rate-limit signals and applies per-plan cooldown + auto-tune.
 */
import type { RuntimeQuotaSnapshot } from '@munder/fleet-protocol';
import { parseRateLimitSignal } from './rateLimitParser.js';
import type { QuotaLedger } from './quotaLedger.js';
import type { PlanLimitTuner } from './planLimitTuner.js';

export interface RateLimitWatcherOpts {
  quota: QuotaLedger;
  tuner?: PlanLimitTuner;
  /** Min ms between duplicate applies for same runtime */
  debounceMs?: number;
  now?: () => number;
  onDetected?: (runtimeId: string, snapshot: RuntimeQuotaSnapshot, appliedCooldownMs: number) => void;
}

export class RateLimitWatcher {
  private readonly buffers = new Map<string, string>();
  private readonly lastAppliedAt = new Map<string, number>();
  private readonly debounceMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: RateLimitWatcherOpts) {
    this.debounceMs = opts.debounceMs ?? 5_000;
    this.now = opts.now ?? (() => Date.now());
  }

  ingest(runtimeId: string, chunk: string): RuntimeQuotaSnapshot | null {
    if (!runtimeId || !chunk) return null;
    const buf = (this.buffers.get(runtimeId) ?? '') + chunk;
    const lines = buf.split(/\r?\n/);
    this.buffers.set(runtimeId, lines.pop() ?? '');
    let last: RuntimeQuotaSnapshot | null = null;
    for (const line of lines) {
      const hit = this.tryLine(runtimeId, line);
      if (hit) last = hit;
    }
    const tail = this.buffers.get(runtimeId) ?? '';
    if (tail) {
      const hit = this.tryLine(runtimeId, tail);
      if (hit) {
        last = hit;
        this.buffers.set(runtimeId, '');
      }
    }
    return last;
  }

  private tryLine(runtimeId: string, line: string): RuntimeQuotaSnapshot | null {
    const parsed = parseRateLimitSignal(line);
    if (!parsed) return null;
    const now = this.now();
    const lastAt = this.lastAppliedAt.get(runtimeId) ?? 0;
    if (now - lastAt < this.debounceMs) return null;

    const before = this.opts.quota.snapshot(runtimeId, now);
    const tasksBefore = before.consecutiveTasks || before.tasksInWindow || 1;
    const snap = this.opts.quota.applyRateLimitSignal(runtimeId, line, now);
    if (!snap) return null;

    const appliedMs =
      snap.cooldownUntil !== null ? Math.max(0, snap.cooldownUntil - now) : parsed.cooldownMs;
    this.lastAppliedAt.set(runtimeId, now);

    this.opts.tuner?.observe({
      planId: snap.planId,
      tasksBeforeLimit: tasksBefore,
      cooldownMs: appliedMs,
      signalDetail: parsed.detail
    });

    this.opts.onDetected?.(runtimeId, snap, appliedMs);
    return snap;
  }
}
