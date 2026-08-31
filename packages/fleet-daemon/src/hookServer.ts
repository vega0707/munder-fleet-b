/**
 * Headless HookServer — munder hooks.ts behavior without Electron.
 * PreToolUse ↔ ControlRegistry; permission/HITL ↔ DecisionGate hard gate.
 */
import { createServer, type Server } from 'node:net';
import { existsSync, rmSync } from 'node:fs';
import type { ControlRegistry } from './control.js';
import type { DecisionGate } from './decisionGate.js';
import { validateHookEvent, type HookEvent } from './hookEvents.js';

export interface HookPayload {
  hook_event_name?: string;
  agent_id?: string | null;
  session_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  stop_hook_active?: boolean;
  notification_type?: string;
  message?: string;
  /** When true, PreToolUse registers a PendingDecision instead of auto-allow. */
  require_decision?: boolean;
  call_id?: string;
}

export type HookEmit = (event: HookEvent) => void;

export interface HookServerOpts {
  sockPath: string;
  projectId?: string;
  control?: ControlRegistry;
  decisions?: DecisionGate;
  /** conversation id used for DecisionGate (defaults to projectId / 'default'). */
  conversationId?: string;
  emit?: HookEmit;
  onEvent?: (agentId: string | undefined, event: string, message: string | undefined) => void;
}

export class HookServer {
  private server: Server | null = null;
  private readonly sockPath: string;
  private readonly projectId: string;
  private readonly conversationId: string;
  private readonly control?: ControlRegistry;
  private readonly decisions?: DecisionGate;
  private readonly emitFn: HookEmit;
  private readonly onEvent?: HookServerOpts['onEvent'];

  constructor(opts: HookServerOpts) {
    this.sockPath = opts.sockPath;
    this.projectId = opts.projectId ?? 'default';
    this.conversationId = opts.conversationId ?? this.projectId;
    this.control = opts.control;
    this.decisions = opts.decisions;
    this.emitFn = opts.emit ?? (() => {});
    this.onEvent = opts.onEvent;
  }

  start(): void {
    if (this.server) return;
    if (process.platform !== 'win32') {
      try {
        if (existsSync(this.sockPath)) rmSync(this.sockPath);
      } catch {
        /* noop */
      }
    }
    this.server = createServer((conn) => {
      let buf = '';
      conn.on('data', (d) => {
        buf += d.toString();
        const nl = buf.indexOf('\n');
        if (nl === -1) return;
        let payload: HookPayload = {};
        try {
          payload = JSON.parse(buf.slice(0, nl)) as HookPayload;
        } catch {
          /* ignore */
        }
        let res: unknown = {};
        try {
          res = this.handle(payload);
        } catch {
          res = {};
        }
        conn.end(JSON.stringify(res ?? {}));
      });
      conn.on('error', () => {});
    });
    this.server.on('error', (e) => console.error('[fleet] hook server error:', e));
    this.server.listen(this.sockPath);
  }

  stop(): void {
    try {
      this.server?.close();
    } catch {
      /* noop */
    }
    this.server = null;
    if (process.platform !== 'win32') {
      try {
        if (existsSync(this.sockPath)) rmSync(this.sockPath);
      } catch {
        /* noop */
      }
    }
  }

  /** Pure handler — unit-testable without listening. */
  handle(p: HookPayload): unknown {
    const agentId = p.agent_id ?? undefined;
    const event = p.hook_event_name ?? 'Unknown';
    this.onEvent?.(agentId, event, p.message);

    if (agentId && this.control?.shouldHalt(agentId)) {
      this.emit(agentId, event, p);
      return { continue: false, stopReason: 'Halted by the operator from the floor.' };
    }

    if ((event === 'Stop' || event === 'SubagentStop') && agentId) {
      if (p.stop_hook_active) {
        this.emit(agentId, event, p);
        return {};
      }
      this.emit(agentId, event, p);
      return {};
    }

    if (event === 'PreToolUse' && agentId && this.control) {
      const d = this.control.toolDecision(agentId, p.tool_name ?? '');
      if (d.deny) {
        this.emit(agentId, event, p, true);
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: d.reason ?? 'Denied by operator.'
          }
        };
      }
    }

    // DecisionGate: tools that require human confirmation block + register pending
    if (event === 'PreToolUse' && agentId && p.require_decision && this.decisions) {
      const callId = p.call_id ?? `tool_${p.tool_name ?? 'unknown'}_${Date.now()}`;
      this.decisions.setBaseState('running');
      this.decisions.register({
        callId,
        conversationId: this.conversationId,
        description: `Allow ${p.tool_name ?? 'tool'}?`,
        action: p.tool_name,
        options: [
          { label: 'Allow', value: 'allow' },
          { label: 'Deny', value: 'deny' }
        ]
      });
      this.emit(agentId, event, p, true);
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'Awaiting PendingDecision confirmation.'
        }
      };
    }

    let steer: string | null = null;
    if ((event === 'UserPromptSubmit' || event === 'PostToolUse') && agentId && this.control) {
      steer = this.control.takeSteer(agentId) ?? null;
    }
    if (steer) {
      this.emit(agentId, event, p);
      return {
        hookSpecificOutput: {
          hookEventName: event,
          additionalContext: steer
        }
      };
    }

    this.emit(agentId, event, p);
    return {};
  }

  private emit(
    agentId: string | undefined,
    event: string,
    p: HookPayload,
    blocked = false
  ): void {
    const payload: HookEvent = {
      agentId,
      event,
      tool: p.tool_name,
      notificationType: p.notification_type,
      message: p.message,
      blocked,
      projectId: this.projectId
    };
    if (!validateHookEvent(payload)) {
      console.warn('[fleet] rejected invalid hook event:', event);
      return;
    }
    this.emitFn(payload);
  }
}
