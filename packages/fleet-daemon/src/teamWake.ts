/**
 * TeamWakeScheduler — Aion team wake semantics (Michael = Lead).
 * tryWake / markIdle / idle_notification → lead mailbox.
 */
export type AgentStatus =
  | 'idle'
  | 'working'
  | 'thinking'
  | 'tool_use'
  | 'completed'
  | 'error';

export type TeamRole = 'lead' | 'teammate';

export interface TeamAgent {
  slotId: string;
  name: string;
  role: TeamRole;
  status: AgentStatus;
}

export type MailboxType = 'message' | 'idle_notification' | 'shutdown_request';

export interface MailboxMessage {
  id: string;
  type: MailboxType;
  from: string;
  to: string;
  content: string;
  summary: string | null;
  read: boolean;
  createdAt: number;
}

export interface WakePayload {
  agent: TeamAgent;
  tasks: unknown[];
  unreadMessages: MailboxMessage[];
}

export function isSettled(status: AgentStatus): boolean {
  return status === 'idle' || status === 'completed' || status === 'error';
}

export class AgentNotFoundError extends Error {
  constructor(slotId: string) {
    super(`agent not found: ${slotId}`);
    this.name = 'AgentNotFoundError';
  }
}

export class TeamWakeScheduler {
  private readonly agents = new Map<string, TeamAgent>();
  private readonly mailbox: MailboxMessage[] = [];
  private readonly wakeLocks = new Set<string>();
  private tasks: unknown[] = [];
  private msgSeq = 0;

  upsertAgent(agent: TeamAgent): void {
    this.agents.set(agent.slotId, { ...agent });
  }

  listAgents(): TeamAgent[] {
    return [...this.agents.values()];
  }

  setTasks(tasks: unknown[]): void {
    this.tasks = tasks;
  }

  /** Idle → Working + unread (marked read). Non-idle → null. Missing → throw. */
  tryWake(slotId: string): WakePayload | null {
    const agent = this.agents.get(slotId);
    if (!agent) throw new AgentNotFoundError(slotId);
    if (agent.status !== 'idle') return null;
    agent.status = 'working';
    const unread = this.readUnread(slotId);
    return { agent: { ...agent }, tasks: [...this.tasks], unreadMessages: unread };
  }

  /**
   * Mark idle. Teammate → write idle_notification to lead.
   * Returns leadSlotId iff all teammates settled AND lead Idle — never self-wakes lead.
   */
  markIdle(slotId: string, summary?: string): string | null {
    const agent = this.agents.get(slotId);
    if (!agent) throw new AgentNotFoundError(slotId);
    agent.status = 'idle';

    if (agent.role === 'lead') {
      return null;
    }

    const lead = this.findLead();
    if (lead) {
      this.mailbox.push({
        id: `mail_${++this.msgSeq}`,
        type: 'idle_notification',
        from: slotId,
        to: lead.slotId,
        content: summary ?? 'idle',
        summary: summary ?? null,
        read: false,
        createdAt: Date.now()
      });
    }
    return this.maybeWakeLeaderWhenAllIdle();
  }

  maybeWakeLeaderWhenAllIdle(): string | null {
    const lead = this.findLead();
    if (!lead || lead.status !== 'idle') return null;
    const teammates = [...this.agents.values()].filter((a) => a.role === 'teammate');
    if (teammates.length === 0) return null;
    if (!teammates.every((t) => isSettled(t.status))) return null;
    return lead.slotId;
  }

  listMailbox(slotId?: string): MailboxMessage[] {
    return this.mailbox.filter((m) => (slotId ? m.to === slotId : true)).map((m) => ({ ...m }));
  }

  acquireWakeLock(slotId: string): boolean {
    if (this.wakeLocks.has(slotId)) return false;
    this.wakeLocks.add(slotId);
    return true;
  }

  releaseWakeLock(slotId: string): void {
    this.wakeLocks.delete(slotId);
  }

  private findLead(): TeamAgent | undefined {
    return [...this.agents.values()].find((a) => a.role === 'lead');
  }

  private readUnread(slotId: string): MailboxMessage[] {
    const unread = this.mailbox.filter((m) => m.to === slotId && !m.read);
    for (const m of unread) m.read = true;
    return unread.map((m) => ({ ...m }));
  }
}
