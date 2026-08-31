/**
 * DecisionGate — PendingDecision hard gate (Aion Confirmation §4.6 semantics).
 * While pending > 0: waiting_confirmation, canSendMessage=false, send → 409.
 */
import type { PendingDecision, RuntimeSummary, RuntimeState } from '@munder/fleet-protocol';

export class BusyError extends Error {
  readonly statusCode = 409;
  constructor(message = 'conversation busy — pending confirmation') {
    super(message);
    this.name = 'BusyError';
  }
}

export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export interface DecisionGateOptions {
  supportsMidturnDelivery?: boolean;
}

export class DecisionGate {
  private readonly byConversation = new Map<string, Map<string, PendingDecision>>();
  private turnId: string | undefined;
  private baseState: Exclude<RuntimeState, 'waiting_confirmation'> = 'idle';
  private readonly supportsMidturnDelivery: boolean;

  constructor(opts: DecisionGateOptions = {}) {
    this.supportsMidturnDelivery = opts.supportsMidturnDelivery ?? true;
  }

  setBaseState(state: Exclude<RuntimeState, 'waiting_confirmation'>): void {
    this.baseState = state;
  }

  setTurnId(turnId: string | undefined): void {
    this.turnId = turnId;
  }

  list(conversationId: string): PendingDecision[] {
    const map = this.byConversation.get(conversationId);
    return map ? [...map.values()] : [];
  }

  register(decision: Omit<PendingDecision, 'id' | 'createdAt'> & { id?: string }): PendingDecision {
    let map = this.byConversation.get(decision.conversationId);
    if (!map) {
      map = new Map();
      this.byConversation.set(decision.conversationId, map);
    }
    // Duplicate callId replaces previous (Aion permission_router)
    map.delete(decision.callId);
    const full: PendingDecision = {
      id: decision.id ?? `pd_${decision.callId}`,
      callId: decision.callId,
      conversationId: decision.conversationId,
      title: decision.title,
      action: decision.action,
      description: decision.description,
      commandType: decision.commandType,
      options: decision.options,
      createdAt: Date.now()
    };
    map.set(decision.callId, full);
    return full;
  }

  confirm(conversationId: string, callId: string): PendingDecision {
    const map = this.byConversation.get(conversationId);
    const pending = map?.get(callId);
    if (!pending) throw new NotFoundError(`pending decision not found: ${callId}`);
    map!.delete(callId);
    if (map!.size === 0) this.byConversation.delete(conversationId);
    return pending;
  }

  cancelAll(conversationId?: string): number {
    if (conversationId) {
      const map = this.byConversation.get(conversationId);
      const n = map?.size ?? 0;
      this.byConversation.delete(conversationId);
      return n;
    }
    let n = 0;
    for (const map of this.byConversation.values()) n += map.size;
    this.byConversation.clear();
    return n;
  }

  pendingCount(conversationId?: string): number {
    if (conversationId) return this.list(conversationId).length;
    let n = 0;
    for (const map of this.byConversation.values()) n += map.size;
    return n;
  }

  /** Before send/midturn: if pending → BusyError (HTTP 409). */
  assertClear(conversationId: string): void {
    if (this.pendingCount(conversationId) > 0) {
      throw new BusyError();
    }
  }

  summary(conversationId: string): RuntimeSummary {
    const pending = this.pendingCount(conversationId);
    const waiting = pending > 0;
    const state: RuntimeState = waiting ? 'waiting_confirmation' : this.baseState;
    const isProcessing =
      waiting ||
      this.baseState === 'running' ||
      this.baseState === 'starting' ||
      this.baseState === 'cancelling' ||
      this.baseState === 'restarting';
    return {
      state,
      canSendMessage: !isProcessing,
      isProcessing,
      pendingConfirmations: pending,
      turnId: this.turnId,
      supportsMidturnDelivery: this.supportsMidturnDelivery
    };
  }
}
