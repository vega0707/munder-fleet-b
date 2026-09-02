/**
 * Plan registry — per-plan budget config (hive/plans.json). No fleet-wide defaults.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlanBudgetConfig } from '@munder/fleet-protocol';

export class PlanRegistry {
  private readonly filePath: string;
  private plans: PlanBudgetConfig[] = [];

  constructor(hiveDir: string) {
    mkdirSync(hiveDir, { recursive: true });
    this.filePath = join(hiveDir, 'plans.json');
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.plans = [];
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
      this.plans = Array.isArray(raw) ? (raw as PlanBudgetConfig[]) : [];
    } catch {
      this.plans = [];
    }
  }

  list(): PlanBudgetConfig[] {
    return this.plans.map((p) => ({ ...p, limits: p.limits ? { ...p.limits } : undefined }));
  }

  get(planId: string): PlanBudgetConfig | undefined {
    const p = this.plans.find((x) => x.planId === planId);
    return p ? { ...p, limits: p.limits ? { ...p.limits } : undefined } : undefined;
  }

  byProvider(provider: string): PlanBudgetConfig | undefined {
    const p = this.plans.find((x) => x.provider === provider);
    return p ? { ...p, limits: p.limits ? { ...p.limits } : undefined } : undefined;
  }

  upsert(plan: PlanBudgetConfig): PlanBudgetConfig {
    const idx = this.plans.findIndex((x) => x.planId === plan.planId);
    const next = { ...plan, limits: plan.limits ? { ...plan.limits } : undefined };
    if (idx >= 0) this.plans[idx] = next;
    else this.plans.push(next);
    this.persist();
    return next;
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.plans, null, 2), 'utf8');
  }
}
