/**
 * Per-plan limit learner — adjusts limits from observed CLI rate-limits (opt-in per plan).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlanBudgetConfig, PlanTuneObservation } from '@munder/fleet-protocol';
import type { PlanRegistry } from './planRegistry.js';

const MAX_OBSERVATIONS = 50;

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function ema(prev: number | undefined, next: number, rate: number): number {
  if (prev === undefined) return next;
  return Math.round(prev * (1 - rate) + next * rate);
}

export class PlanLimitTuner {
  private readonly filePath: string;
  private observations: PlanTuneObservation[] = [];

  constructor(
    hiveDir: string,
    private readonly plans: PlanRegistry
  ) {
    mkdirSync(hiveDir, { recursive: true });
    this.filePath = join(hiveDir, 'plan-tune-observations.json');
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
      this.observations = Array.isArray(raw) ? (raw as PlanTuneObservation[]) : [];
    } catch {
      this.observations = [];
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.observations.slice(-MAX_OBSERVATIONS), null, 2), 'utf8');
  }

  list(planId?: string): PlanTuneObservation[] {
    const all = this.observations.map((o) => ({ ...o }));
    return planId ? all.filter((o) => o.planId === planId) : all;
  }

  /**
   * Record observation and optionally rewrite plan limits when autoTune.enabled.
   * Returns updated plan when tuned.
   */
  observe(input: Omit<PlanTuneObservation, 'observedAt'>): PlanBudgetConfig | null {
    const obs: PlanTuneObservation = { ...input, observedAt: new Date().toISOString() };
    this.observations.push(obs);
    if (this.observations.length > MAX_OBSERVATIONS) {
      this.observations = this.observations.slice(-MAX_OBSERVATIONS);
    }
    this.persist();

    const plan = this.plans.get(input.planId);
    if (!plan?.autoTune?.enabled) return null;

    const recent = this.observations
      .filter((o) => o.planId === input.planId)
      .slice(-10);
    if (recent.length < 2) return null;

    const rate = plan.autoTune.learningRate ?? 0.35;
    const tasksSamples = recent.map((o) => o.tasksBeforeLimit).filter((n) => n > 0);
    const cooldownSamples = recent.map((o) => o.cooldownMs).filter((n) => n > 0);
    if (tasksSamples.length === 0 && cooldownSamples.length === 0) return null;

    const limits = { ...(plan.limits ?? {}) };
    if (tasksSamples.length > 0) {
      const target = Math.max(1, Math.floor(median(tasksSamples) * 0.9));
      limits.maxConsecutiveTasks = target;
      if (!limits.consecutiveCooldownMs && cooldownSamples.length > 0) {
        limits.consecutiveCooldownMs = median(cooldownSamples);
      }
    }
    if (cooldownSamples.length > 0) {
      const med = median(cooldownSamples);
      limits.rateLimitFallbackCooldownMs = ema(limits.rateLimitFallbackCooldownMs, med, rate);
      limits.consecutiveCooldownMs = ema(limits.consecutiveCooldownMs, med, rate);
    }

    return this.plans.upsert({ ...plan, limits });
  }
}
