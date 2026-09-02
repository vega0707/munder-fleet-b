/**
 * Expert profiles — Role extended with positioning, methodology, defaults.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExpertProfile } from '@munder/fleet-protocol';

const DEFAULT_EXPERTS: ExpertProfile[] = [
  {
    id: 'michael',
    name: 'Michael',
    positioning: '团队编排者 / Lead',
    methodology: '拆解复杂任务、协调专家并行、汇总交付',
    defaultSkills: [],
    defaultConnectors: [],
    slotId: 'michael'
  }
];

export class ExpertRegistry {
  private readonly filePath: string;
  private experts: ExpertProfile[] = [];

  constructor(hiveDir: string) {
    mkdirSync(hiveDir, { recursive: true });
    this.filePath = join(hiveDir, 'experts.json');
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.experts = DEFAULT_EXPERTS.map((e) => ({ ...e }));
      this.persist();
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
      this.experts = Array.isArray(raw) ? (raw as ExpertProfile[]) : DEFAULT_EXPERTS;
    } catch {
      this.experts = DEFAULT_EXPERTS.map((e) => ({ ...e }));
    }
  }

  list(): ExpertProfile[] {
    return this.experts.map((e) => ({ ...e }));
  }

  get(id: string): ExpertProfile | undefined {
    return this.experts.find((e) => e.id === id);
  }

  upsert(profile: ExpertProfile): ExpertProfile {
    const idx = this.experts.findIndex((e) => e.id === profile.id);
    const next = { ...profile };
    if (idx >= 0) this.experts[idx] = next;
    else this.experts.push(next);
    this.persist();
    return next;
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.experts, null, 2), 'utf8');
  }
}
