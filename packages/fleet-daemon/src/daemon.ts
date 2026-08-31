/**
 * Headless FleetDaemon — extracts hive/pty/control control plane from Electron main.
 * Boot: RuntimeRegistry.ensureLocal → DecisionGate ready → optional hive dir.
 */
import { hostname } from 'node:os';
import type { DaemonInfo, HiveTask, PendingDecision, RuntimeRecord } from '@munder/fleet-protocol';
import { LOCAL_DEFAULT_USER } from '@munder/fleet-protocol';
import { ControlRegistry } from './control.js';
import { BusyError, DecisionGate } from './decisionGate.js';
import { HiveTaskStore } from './hiveTasks.js';
import { PtyManager, type PtyBackend, type SpawnOpts } from './ptyManager.js';
import { RuntimeRegistry, type EnsureLocalOpts } from './runtimeRegistry.js';

export interface FleetDaemonOpts {
  hiveDir?: string;
  daemonId?: string;
  deviceName?: string;
  launchedBy?: 'electron' | 'cli' | 'test';
  providers?: EnsureLocalOpts['providers'];
  ptyBackend?: PtyBackend;
  ownerUserId?: string;
}

export class FleetDaemon {
  readonly control = new ControlRegistry();
  readonly decisions = new DecisionGate();
  readonly runtimes = new RuntimeRegistry();
  readonly pty: PtyManager;
  readonly tasks: HiveTaskStore;
  private info: DaemonInfo | undefined;
  private started = false;

  constructor(private readonly opts: FleetDaemonOpts = {}) {
    this.pty = new PtyManager({ backend: opts.ptyBackend });
    this.tasks = new HiveTaskStore(opts.hiveDir);
  }

  get daemonInfo(): DaemonInfo | undefined {
    return this.info;
  }

  get isRunning(): boolean {
    return this.started;
  }

  /** Boot hook — register local runtimes (Multica ensureLocal semantics). */
  start(): { info: DaemonInfo; runtimes: RuntimeRecord[] } {
    if (this.started) {
      return { info: this.info!, runtimes: this.runtimes.list() };
    }
    const daemonId = this.opts.daemonId ?? RuntimeRegistry.newDaemonId();
    const deviceName = this.opts.deviceName ?? hostname();
    const launchedBy = this.opts.launchedBy ?? 'cli';
    const runtimes = this.runtimes.ensureLocal({
      daemonId,
      deviceName,
      launchedBy,
      providers: this.opts.providers,
      ownerUserId: this.opts.ownerUserId ?? LOCAL_DEFAULT_USER.id
    });
    this.info = {
      daemonId,
      deviceName,
      launchedBy,
      startedAt: Date.now()
    };
    this.started = true;
    return { info: this.info, runtimes };
  }

  stop(): void {
    for (const p of this.pty.list()) {
      if (p.alive) this.pty.kill(p.id);
    }
    this.runtimes.deregisterAll();
    this.decisions.cancelAll();
    this.started = false;
  }

  spawnPty(opts: SpawnOpts) {
    this.ensureStarted();
    return this.pty.spawn(opts);
  }

  registerDecision(
    input: Omit<PendingDecision, 'id' | 'createdAt'> & { id?: string }
  ): PendingDecision {
    this.ensureStarted();
    this.decisions.setBaseState('running');
    return this.decisions.register(input);
  }

  confirmDecision(conversationId: string, callId: string): PendingDecision {
    const d = this.decisions.confirm(conversationId, callId);
    if (this.decisions.pendingCount(conversationId) === 0) {
      this.decisions.setBaseState('running');
    }
    return d;
  }

  /** Send path hard gate. */
  sendMessage(conversationId: string, _text: string): { ok: true } {
    this.ensureStarted();
    try {
      this.decisions.assertClear(conversationId);
    } catch (e) {
      if (e instanceof BusyError) throw e;
      throw e;
    }
    return { ok: true };
  }

  addTask(task: HiveTask): HiveTask {
    this.ensureStarted();
    return this.tasks.addTask(task);
  }

  patchTask(id: string, patch: Partial<HiveTask>): HiveTask | undefined {
    this.ensureStarted();
    return this.tasks.patchTask(id, patch);
  }

  listTasks(): HiveTask[] {
    return this.tasks.list();
  }

  private ensureStarted(): void {
    if (!this.started) this.start();
  }
}
