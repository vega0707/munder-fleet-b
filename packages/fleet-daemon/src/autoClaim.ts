/**
 * AutoClaimLoop — Multica-style poll: fresh runtimes claim unclaimed tasks.
 * Skips tasks with open agent_blocked blockers; skips human assignees.
 */
import type { ClaimRecord, ClaimService } from './claimService.js';
import type { BlockerService } from './blockerService.js';
import type { HiveTask } from '@munder/fleet-protocol';

export interface AutoClaimOpts {
  claims: ClaimService;
  blockers: BlockerService;
  listTasks: () => HiveTask[];
  /** Treat assignee starting with human: as human (skip auto wake/claim). */
  isHumanAssignee?: (assignee: string | undefined) => boolean;
  now?: () => number;
}

export interface AutoClaimResult {
  claimed: ClaimRecord[];
  skippedBlocked: string[];
  skippedHuman: string[];
  skippedNoRuntime: string[];
}

export class AutoClaimLoop {
  constructor(private readonly opts: AutoClaimOpts) {}

  tick(): AutoClaimResult {
    const now = this.opts.now?.() ?? Date.now();
    const isHuman =
      this.opts.isHumanAssignee ??
      ((a?: string) => !!a && (a.startsWith('human:') || a === 'michael' || a === 'owner'));
    const runtimes = this.opts.claims.claimableRuntimes(now);
    const claimed: ClaimRecord[] = [];
    const skippedBlocked: string[] = [];
    const skippedHuman: string[] = [];
    const skippedNoRuntime: string[] = [];

    for (const task of this.opts.listTasks()) {
      if (task.status === 'done') continue;
      if (this.opts.claims.get(task.id)) continue;
      if (this.opts.blockers.blocksAutoClaim(task.id)) {
        skippedBlocked.push(task.id);
        continue;
      }
      if (isHuman(task.assignee)) {
        skippedHuman.push(task.id);
        continue;
      }
      const runtime = runtimes[0];
      if (!runtime) {
        skippedNoRuntime.push(task.id);
        continue;
      }
      try {
        claimed.push(this.opts.claims.claim(task.id, runtime.id, now));
      } catch {
        skippedNoRuntime.push(task.id);
      }
    }
    return { claimed, skippedBlocked, skippedHuman, skippedNoRuntime };
  }
}
