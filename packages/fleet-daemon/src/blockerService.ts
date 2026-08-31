/**
 * BlockerService — Multica/Aion: agent blocked → accountable owner; no silent retry.
 */
export type BlockerStatus = 'open' | 'resolved' | 'cancelled';
export type BlockerReasonCode = 'agent_blocked' | 'dependency' | 'external';

export interface Blocker {
  id: string;
  taskOrIssueId: string;
  raisedBySlotId: string;
  ownerUserId: string;
  reason: string;
  reasonCode: BlockerReasonCode;
  status: BlockerStatus;
  createdAt: number;
  /** Task ids this task is blocked by (Aion board deps). */
  blockedBy: string[];
}

export interface BlockerRaiseInput {
  taskOrIssueId: string;
  raisedBySlotId: string;
  reason: string;
  reasonCode?: BlockerReasonCode;
  ownerUserId: string;
  blockedBy?: string[];
}

export class BlockerService {
  private readonly blockers = new Map<string, Blocker>();
  private seq = 0;
  /** taskId → dependency ids still blocking it */
  private readonly deps = new Map<string, Set<string>>();

  raise(input: BlockerRaiseInput): Blocker {
    const id = `blk_${++this.seq}`;
    const blocker: Blocker = {
      id,
      taskOrIssueId: input.taskOrIssueId,
      raisedBySlotId: input.raisedBySlotId,
      ownerUserId: input.ownerUserId,
      reason: input.reason,
      reasonCode: input.reasonCode ?? 'agent_blocked',
      status: 'open',
      createdAt: Date.now(),
      blockedBy: input.blockedBy ?? []
    };
    this.blockers.set(id, blocker);
    if (blocker.blockedBy.length) {
      this.deps.set(input.taskOrIssueId, new Set(blocker.blockedBy));
    }
    return { ...blocker };
  }

  resolve(blockerId: string, byUserId: string): Blocker {
    const b = this.blockers.get(blockerId);
    if (!b) throw new Error(`blocker not found: ${blockerId}`);
    if (b.ownerUserId !== byUserId) {
      throw new Error('only owner can resolve blocker');
    }
    b.status = 'resolved';
    return { ...b };
  }

  /**
   * Dependency completed: strip from blocked_by sets.
   * Returns task ids that became fully unblocked.
   */
  onDependencyCompleted(completedId: string): { unblockedIds: string[] } {
    const unblockedIds: string[] = [];
    for (const [taskId, set] of this.deps) {
      if (!set.has(completedId)) continue;
      set.delete(completedId);
      if (set.size === 0) {
        this.deps.delete(taskId);
        unblockedIds.push(taskId);
        for (const b of this.blockers.values()) {
          if (b.taskOrIssueId === taskId && b.status === 'open' && b.reasonCode === 'dependency') {
            b.status = 'resolved';
            b.blockedBy = [];
          }
        }
      }
    }
    return { unblockedIds };
  }

  listOpen(ownerUserId?: string): Blocker[] {
    return [...this.blockers.values()]
      .filter((b) => b.status === 'open')
      .filter((b) => (ownerUserId ? b.ownerUserId === ownerUserId : true))
      .map((b) => ({ ...b }));
  }

  /** Open agent_blocked items must not auto-reclaim. */
  blocksAutoClaim(taskOrIssueId: string): boolean {
    return [...this.blockers.values()].some(
      (b) =>
        b.taskOrIssueId === taskOrIssueId &&
        b.status === 'open' &&
        b.reasonCode === 'agent_blocked'
    );
  }
}
