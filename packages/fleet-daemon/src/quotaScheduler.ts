/**
 * QuotaScheduler — resume expired cooldowns and auto-claim queued tasks.
 */
import type { AutoClaimLoop, AutoClaimResult } from './autoClaim.js';
import type { QuotaLedger } from './quotaLedger.js';

export interface QuotaSchedulerOpts {
  quota: QuotaLedger;
  autoClaim: AutoClaimLoop;
  tickMs?: number;
  now?: () => number;
  onResume?: (resumed: string[], result: AutoClaimResult) => void;
}

export class QuotaScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly opts: QuotaSchedulerOpts) {}

  start(): void {
    const ms = this.opts.tickMs ?? 30_000;
    if (ms <= 0) return;
    this.timer = setInterval(() => this.tick(), ms);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  tick(): { resumed: string[]; claim: AutoClaimResult } {
    const now = this.opts.now?.() ?? Date.now();
    const resumed = this.opts.quota.resumeExpired(now);
    const claim = this.opts.autoClaim.tick();
    if (resumed.length > 0) this.opts.onResume?.(resumed, claim);
    return { resumed, claim };
  }
}
