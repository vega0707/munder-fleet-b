/**
 * Headless FleetDaemon — hive/pty/hooks/control + TeamWake + claim/blocker.
 */
import { hostname } from 'node:os';
import type { DaemonInfo } from '@munder/fleet-protocol';
import { LOCAL_DEFAULT_USER } from '@munder/fleet-protocol';
import { AutoClaimLoop } from './autoClaim.js';
import { BlockerService } from './blockerService.js';
import { ClaimService, type ClaimRecord } from './claimService.js';
import { ControlRegistry } from './control.js';
import { BusyError, DecisionGate } from './decisionGate.js';
import { ExpertRegistry } from './expertRegistry.js';
import { ArtifactStore } from './artifactStore.js';
import { HiveMailRouter } from './hiveMail.js';
import { HiveRoot } from './hiveRoot.js';
import { HiveTaskStore } from './hiveTasks.js';
import { HookServer } from './hookServer.js';
import { MemoryStore } from './memoryStore.js';
import { FleetMetrics } from './metrics.js';
import { Orchestrator, type SubtaskSpec } from './orchestrator.js';
import { tryCreateNodePtyBackend } from './nodePtyBackend.js';
import { PtyManager, type PtyBackend, type SpawnOpts } from './ptyManager.js';
import { injectProjectContext, ProjectConfigStore } from './projectConfigStore.js';
import { RuntimeRegistry, type EnsureLocalOpts } from './runtimeRegistry.js';
import { SkillLoader } from './skillLoader.js';
import { TeamWakeScheduler } from './teamWake.js';
import type {
  ArtifactRef,
  ExpertProfile,
  HiveTask,
  MemoryEntry,
  PendingDecision,
  ProjectConfig,
  RuntimeRecord,
  SkillPackage
} from '@munder/fleet-protocol';

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
  readonly experts: ExpertRegistry;
  readonly skills: SkillLoader;
  readonly project: ProjectConfigStore;
  readonly orchestrator = new Orchestrator();
  readonly artifacts: ArtifactStore;
  readonly memory: MemoryStore;
  hooks: HookServer | undefined;
  private info: DaemonInfo | undefined;
  private started = false;
  private readonly ownerUserId: string;

  constructor(private readonly opts: FleetDaemonOpts = {}) {
    this.ownerUserId = opts.ownerUserId ?? LOCAL_DEFAULT_USER.id;
    this.hive = new HiveRoot({
      home: opts.hiveHome,
      projectId: opts.projectId
    });
    const taskDir = opts.hiveDir ?? (opts.hiveHome ? this.hive.hiveDir() : undefined);
    const hiveDir = taskDir ?? this.hive.hiveDir();
    this.pty = new PtyManager({ backend: opts.ptyBackend });
    this.tasks = new HiveTaskStore(taskDir);
    this.claims = new ClaimService(this.runtimes);
    this.mail = new HiveMailRouter(this.hive);
    this.autoClaim = new AutoClaimLoop({
      claims: this.claims,
      blockers: this.blockers,
      listTasks: () => this.tasks.list()
    });
    this.experts = new ExpertRegistry(hiveDir);
    this.skills = new SkillLoader(hiveDir);
    this.project = new ProjectConfigStore(hiveDir, this.hive.projectId);
    this.artifacts = new ArtifactStore(hiveDir);
    this.memory = new MemoryStore(hiveDir);
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
    const ownerUserId = this.ownerUserId;
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
    this.skills.reload();
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

  addTask(task: HiveTask, opts?: { userId?: string }): HiveTask {
    this.ensureStarted();
    const userId = opts?.userId ?? this.ownerUserId;
    const memoryLines = this.memory.linesForUser(userId);
    const enriched = injectProjectContext(task, this.project.get(), memoryLines);
    const expert = enriched.expertId ? this.experts.get(enriched.expertId) : undefined;
    if (expert) {
      const skillIds = [...new Set([...(enriched.skillIds ?? []), ...expert.defaultSkills])];
      const connectorIds = [
        ...new Set([...(enriched.connectorIds ?? []), ...expert.defaultConnectors])
      ];
      enriched.skillIds = skillIds.length ? skillIds : undefined;
      enriched.connectorIds = connectorIds.length ? connectorIds : undefined;
      if (!enriched.assignee && expert.slotId) enriched.assignee = expert.slotId;
    }
    return this.tasks.addTask(enriched);
  }

  patchTask(id: string, patch: Partial<HiveTask>): HiveTask | undefined {
    this.ensureStarted();
    const updated = this.tasks.patchTask(id, patch);
    if (!updated) return undefined;
    const parentId = updated.parentTaskId;
    if (parentId && updated.status === 'done') {
      const parent = this.tasks.list().find((t) => t.id === parentId);
      if (parent) {
        const aggregated = this.orchestrator.aggregateIfReady(parent, this.tasks.list());
        if (aggregated) {
          this.tasks.patchTask(parentId, { status: aggregated.status, result: aggregated.result });
        }
      }
    }
    return this.tasks.list().find((t) => t.id === id);
  }

  splitTask(parentId: string, subtasks: SubtaskSpec[]): { parent: HiveTask; children: HiveTask[] } {
    this.ensureStarted();
    const parent = this.tasks.list().find((t) => t.id === parentId);
    if (!parent) throw new Error(`parent task not found: ${parentId}`);
    const { parent: parentPatch, children } = this.orchestrator.splitParent(parent, subtasks);
    this.tasks.patchTask(parentId, { status: parentPatch.status });
    for (const child of children) {
      this.tasks.addTask(child);
    }
    this.metrics.event('orchestrate.split', { parentId, count: children.length });
    return { parent: this.tasks.list().find((t) => t.id === parentId)!, children };
  }

  getProjectConfig(): ProjectConfig {
    return this.project.get();
  }

  updateProjectConfig(patch: Partial<ProjectConfig>): ProjectConfig {
    this.ensureStarted();
    return this.project.update(patch);
  }

  listExperts(): ExpertProfile[] {
    return this.experts.list();
  }

  upsertExpert(profile: ExpertProfile): ExpertProfile {
    this.ensureStarted();
    return this.experts.upsert(profile);
  }

  listSkills(): SkillPackage[] {
    this.ensureStarted();
    return this.skills.list();
  }

  reloadSkills(): SkillPackage[] {
    this.ensureStarted();
    return this.skills.reload();
  }

  writeArtifact(
    taskId: string,
    input: { filename: string; content: string; mimeType?: string }
  ): ArtifactRef {
    this.ensureStarted();
    const ref = this.artifacts.write({ taskId, ...input });
    const task = this.tasks.list().find((t) => t.id === taskId);
    if (task) {
      const artifactIds = [...new Set([...(task.artifactIds ?? []), ref.id])];
      this.tasks.patchTask(taskId, { artifactIds });
    }
    this.metrics.event('artifact.write', { taskId, filename: input.filename, version: ref.version });
    return ref;
  }

  listArtifacts(taskId: string): ArtifactRef[] {
    return this.artifacts.list(taskId);
  }

  getMemory(userId: string, key: string): MemoryEntry | undefined {
    return this.memory.get(userId, key);
  }

  setMemory(userId: string, key: string, value: string): MemoryEntry {
    this.ensureStarted();
    return this.memory.set(userId, key, value);
  }

  listMemory(userId?: string): MemoryEntry[] {
    return this.memory.list(userId);
  }

  listTasks(): HiveTask[] {
    return this.tasks.list();
  }

  private ensureStarted(): void {
    if (!this.started) this.start();
  }
}

export { BusyError };
