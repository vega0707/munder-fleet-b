/**
 * Headless FleetDaemon — hive/pty/hooks/control + TeamWake + claim/blocker.
 */
import { hostname } from 'node:os';
import type { DaemonInfo, HiveTask, PendingDecision, RuntimeRecord } from '@munder/fleet-protocol';
import { LOCAL_DEFAULT_USER } from '@munder/fleet-protocol';
import { AutoClaimLoop } from './autoClaim.js';
import { BlockerService } from './blockerService.js';
import { ClaimService, type ClaimRecord } from './claimService.js';
import { ControlRegistry } from './control.js';
import { BusyError, DecisionGate } from './decisionGate.js';
import { HiveMailRouter } from './hiveMail.js';
import { HiveRoot } from './hiveRoot.js';
import { HiveTaskStore } from './hiveTasks.js';
import { HookServer } from './hookServer.js';
import { FleetMetrics } from './metrics.js';
import { tryCreateNodePtyBackend } from './nodePtyBackend.js';
import { PtyManager, type PtyBackend, type SpawnOpts } from './ptyManager.js';
import { RuntimeRegistry, type EnsureLocalOpts } from './runtimeRegistry.js';
import { TeamWakeScheduler } from './teamWake.js';

export interface FleetDaemonOpts {
  hiveHome?: string;
  hiveDir?: string;
  projectId?: string;
  daemonId?: string;
  deviceName?: string;
  launchedBy?: 'electron' | 'cli' | 'test';
  providers?: EnsureLocalOpts['providers'];
  ptyBackend?: PtyBackend;
  ownerUserId?: string;
  enableHooks?: boolean;
  preferNodePty?: boolean;
}

export class FleetDaemon {
  readonly control = new ControlRegistry();
  readonly decisions = new DecisionGate();
  readonly runtimes = new RuntimeRegistry();
  readonly claims: ClaimService;
  readonly blockers = new BlockerService();
  readonly team = new TeamWakeScheduler();
  readonly metrics = new FleetMetrics();
  readonly hive: HiveRoot;
  readonly mail: HiveMailRouter;
  readonly pty: PtyManager;
  readonly tasks: HiveTaskStore;
  readonly autoClaim: AutoClaimLoop;
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
    this.mail = new HiveMailRouter(this.hive);
    this.autoClaim = new AutoClaimLoop({
      claims: this.claims,
      blockers: this.blockers,
      listTasks: () => this.tasks.list()
    });
  }

  get daemonInfo(): DaemonInfo | undefined {
    return this.info;
  }

  get isRunning(): boolean {
    return this.started;
  }

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
    const ownerUserId = this.opts.ownerUserId ?? LOCAL_DEFAULT_USER.id;
    const runtimes = this.runtimes.ensureLocal({
      daemonId,
      deviceName,
      launchedBy,
      providers: this.opts.providers,
      ownerUserId
    });
    // Default team: Michael (lead) + local worker slot
    this.team.upsertAgent({
      slotId: 'michael',
      name: 'Michael',
      role: 'lead',
      status: 'idle'
    });
    this.info = {
      daemonId,
      deviceName,
      launchedBy,
      startedAt: Date.now()
    };
    this.started = true;
    this.metrics.event('daemon.start', { daemonId, runtimes: runtimes.length });
    return { info: this.info, runtimes };
  }

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
    this.metrics.event('daemon.stop');
  }

  /** Teammate completion → Michael mailbox + optional lead wake id. */
  completeToMichael(slotId: string, summary?: string): { leadToWake: string | null } {
    this.ensureStarted();
    const leadToWake = this.team.markIdle(slotId, summary);
    this.metrics.event('team.complete', { slotId, leadToWake: leadToWake ?? undefined });
    if (leadToWake) {
      this.team.tryWake(leadToWake);
    }
    return { leadToWake };
  }

  spawnPty(opts: SpawnOpts) {
    this.ensureStarted();
    return this.pty.spawn(opts);
  }

  claimTask(taskId: string, runtimeId: string): ClaimRecord {
    this.ensureStarted();
    if (this.blockers.blocksAutoClaim(taskId)) {
      throw new Error('task blocked — owner must resolve before claim');
    }
    const c = this.claims.claim(taskId, runtimeId);
    this.metrics.event('claim', { taskId, runtimeId });
    return c;
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

export { BusyError };
