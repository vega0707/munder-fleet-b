/**
 * Headless FleetDaemon — hive/pty/hooks/control control plane (no Electron).
 * Boot: HiveRoot.ensure → HookServer → RuntimeRegistry.ensureLocal → ClaimService.
 */
import { hostname } from 'node:os';
import type { DaemonInfo, HiveTask, PendingDecision, RuntimeRecord } from '@munder/fleet-protocol';
import { LOCAL_DEFAULT_USER } from '@munder/fleet-protocol';
import { ClaimService, type ClaimRecord } from './claimService.js';
import { ControlRegistry } from './control.js';
import { BusyError, DecisionGate } from './decisionGate.js';
import { HiveRoot } from './hiveRoot.js';
import { HiveTaskStore } from './hiveTasks.js';
import { HookServer } from './hookServer.js';
import { tryCreateNodePtyBackend } from './nodePtyBackend.js';
import { PtyManager, type PtyBackend, type SpawnOpts } from './ptyManager.js';
import { RuntimeRegistry, type EnsureLocalOpts } from './runtimeRegistry.js';

export interface FleetDaemonOpts {
  /** Hive home directory (contains hive/). */
  hiveHome?: string;
  /** @deprecated prefer hiveHome; still accepted as hive/tasks.json parent. */
  hiveDir?: string;
  projectId?: string;
  daemonId?: string;
  deviceName?: string;
  launchedBy?: 'electron' | 'cli' | 'test';
  providers?: EnsureLocalOpts['providers'];
  ptyBackend?: PtyBackend;
  ownerUserId?: string;
  /** Start HookServer UDS listener (default true when started via start()). */
  enableHooks?: boolean;
  /** Prefer real node-pty when available (async startAsync). */
  preferNodePty?: boolean;
}

export class FleetDaemon {
  readonly control = new ControlRegistry();
  readonly decisions = new DecisionGate();
  readonly runtimes = new RuntimeRegistry();
  readonly claims: ClaimService;
  readonly hive: HiveRoot;
  readonly pty: PtyManager;
  readonly tasks: HiveTaskStore;
  hooks: HookServer | undefined;
  private info: DaemonInfo | undefined;
  private started = false;

  constructor(private readonly opts: FleetDaemonOpts = {}) {
    this.hive = new HiveRoot({
      home: opts.hiveHome,
      projectId: opts.projectId
    });
    const taskDir = opts.hiveDir ?? (opts.hiveHome ? this.hive.hiveDir() : undefined);
    this.pty = new PtyManager({ backend: opts.ptyBackend });
    this.tasks = new HiveTaskStore(taskDir);
    this.claims = new ClaimService(this.runtimes);
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
    this.hive.ensure();
    if (this.opts.enableHooks !== false) {
      this.hooks = new HookServer({
        sockPath: this.hive.sockPath(),
        projectId: this.hive.projectId,
        conversationId: this.hive.projectId,
        control: this.control,
        decisions: this.decisions
      });
      this.hooks.start();
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

  /** Like start(), but optionally attaches real node-pty. */
  async startAsync(): Promise<{ info: DaemonInfo; runtimes: RuntimeRecord[] }> {
    if (this.opts.preferNodePty && !this.opts.ptyBackend) {
      const backend = await tryCreateNodePtyBackend();
      if (backend) this.pty.setBackend(backend);
    }
    return this.start();
  }

  stop(): void {
    this.hooks?.stop();
    this.hooks = undefined;
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

  claimTask(taskId: string, runtimeId: string): ClaimRecord {
    this.ensureStarted();
    return this.claims.claim(taskId, runtimeId);
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

  sendMessage(conversationId: string, _text: string): { ok: true } {
    this.ensureStarted();
    this.decisions.assertClear(conversationId);
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

// re-export BusyError for callers
export { BusyError };
