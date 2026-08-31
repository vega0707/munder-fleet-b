/**
 * ControlRegistry — operator control over agents (lifted from munder-difflin,
 * Electron-free). HookServer reads this when forming permissionDecision.
 */
const MAX_PENDING_STEERS = 20;

export interface AgentControlSnapshot {
  paused: boolean;
  halted: boolean;
  autoDeliveryPaused: boolean;
  gatedTools: string[];
  pendingSteers: number;
}

interface AgentControl {
  paused: boolean;
  halted: boolean;
  autoDeliveryPaused: boolean;
  gatedTools: Set<string>;
  steerQueue: string[];
}

export class ControlRegistry {
  private readonly map = new Map<string, AgentControl>();

  private ensure(id: string): AgentControl {
    let c = this.map.get(id);
    if (!c) {
      c = {
        paused: false,
        halted: false,
        autoDeliveryPaused: false,
        gatedTools: new Set(),
        steerQueue: []
      };
      this.map.set(id, c);
    }
    return c;
  }

  pause(id: string, on: boolean): void {
    this.ensure(id).paused = on;
  }

  pauseAutoDelivery(id: string, on: boolean): void {
    this.ensure(id).autoDeliveryPaused = on;
  }

  gateTool(id: string, tool: string, on: boolean): void {
    const c = this.ensure(id);
    if (on) c.gatedTools.add(tool);
    else c.gatedTools.delete(tool);
  }

  steer(id: string, text: string): void {
    const t = text.trim();
    if (!t) return;
    const q = this.ensure(id).steerQueue;
    if (q.length >= MAX_PENDING_STEERS) q.shift();
    q.push(t.slice(0, 10000));
  }

  halt(id: string): void {
    this.ensure(id).halted = true;
  }

  clearSteers(id: string): void {
    const c = this.map.get(id);
    if (c) c.steerQueue.length = 0;
  }

  resume(id: string): void {
    const c = this.ensure(id);
    c.paused = false;
    c.halted = false;
  }

  shouldHalt(id: string): boolean {
    return this.map.get(id)?.halted ?? false;
  }

  isAutoDeliveryPaused(id: string): boolean {
    return this.map.get(id)?.autoDeliveryPaused ?? false;
  }

  toolDecision(id: string, tool: string): { deny: boolean; reason?: string } {
    const c = this.map.get(id);
    if (!c) return { deny: false };
    if (c.paused) {
      return { deny: true, reason: 'Paused by operator — resume from the floor to continue.' };
    }
    if (tool && c.gatedTools.has(tool)) {
      return { deny: true, reason: `Tool ${tool} is gated by the operator.` };
    }
    return { deny: false };
  }

  takeSteer(id: string): string | undefined {
    return this.map.get(id)?.steerQueue.shift();
  }

  snapshot(id: string): AgentControlSnapshot {
    const c = this.map.get(id);
    return {
      paused: c?.paused ?? false,
      halted: c?.halted ?? false,
      autoDeliveryPaused: c?.autoDeliveryPaused ?? false,
      gatedTools: c ? [...c.gatedTools] : [],
      pendingSteers: c?.steerQueue.length ?? 0
    };
  }
}
