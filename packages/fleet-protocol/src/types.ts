/** Shared Fleet wire types — Strategy B (Aion/Multica behavioral alignment). */

export type AuthIdentityMode = 'local' | 'userSession';

export interface FleetUser {
  id: string;
  username: string;
}

/** Electron / trusted local process — fixed system user (Aion IdentityMode::Local). */
export const LOCAL_DEFAULT_USER: FleetUser = {
  id: 'system_default_user',
  username: 'system_default_user'
};

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: true;
  user: FleetUser;
  /** Access token (also set as HttpOnly session cookie for browsers). */
  token: string;
  /** Refresh token — path-scoped; cannot call ordinary APIs. */
  refreshToken?: string;
  csrf?: string;
}

export interface AuthStatus {
  success: true;
  needsSetup: boolean;
  userCount: number;
  isAuthenticated: boolean;
  identityMode: AuthIdentityMode;
}

export type RuntimeStatus = 'online' | 'offline' | 'runtime_gone';

export interface RuntimeRecord {
  id: string;
  daemonId: string;
  workspaceId?: string;
  name: string;
  provider: string;
  version?: string;
  status: RuntimeStatus;
  lastSeenAt: number;
  ownerUserId: string;
  /** Links runtime to a plan budget config (hive/plans.json) */
  planId?: string;
}

/**
 * Per-plan proactive limits — all optional; omit `limits` to rely on passive rate-limit only.
 * No fleet-wide defaults; each plan defines its own rules in hive/plans.json.
 */
export interface PlanLimits {
  maxTasksPerWindow?: number;
  windowMs?: number;
  windowExhaustedCooldownMs?: number;
  maxConsecutiveTasks?: number;
  consecutiveCooldownMs?: number;
  /** Used when CLI signals rate-limit without parseable retry-after */
  rateLimitFallbackCooldownMs?: number;
}

export interface PlanBudgetConfig {
  planId: string;
  name?: string;
  provider: string;
  limits?: PlanLimits;
  /** Learn limits from observed CLI rate-limits (per-plan opt-in). */
  autoTune?: {
    enabled?: boolean;
    /** EMA blend for cooldown ms (0–1, default 0.35). */
    learningRate?: number;
  };
}

export interface PlanTuneObservation {
  planId: string;
  tasksBeforeLimit: number;
  cooldownMs: number;
  observedAt: string;
  signalDetail: string;
}

export type QuotaCooldownReason = 'window_exhausted' | 'consecutive_exhausted' | 'rate_limit';

export interface RuntimeQuotaSnapshot {
  runtimeId: string;
  planId: string;
  available: boolean;
  cooldownUntil: number | null;
  cooldownReason?: QuotaCooldownReason;
  cooldownDetail?: string;
  tasksInWindow: number;
  consecutiveTasks: number;
  windowStartedAt: number;
  /** Remaining headroom in current window; null = unlimited */
  windowHeadroom: number | null;
}

/** Multica claim freshness analogue (seconds). */
export const RUNTIME_CLAIM_FRESHNESS_MS = 150_000;

export type RuntimeState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'cancelling'
  | 'restarting'
  | 'waiting_confirmation';

export interface PendingDecision {
  id: string;
  callId: string;
  conversationId: string;
  title?: string;
  action?: string;
  description: string;
  commandType?: string;
  options: Array<{ label: string; value: unknown; params?: Record<string, string> }>;
  createdAt: number;
}

export interface RuntimeSummary {
  state: RuntimeState;
  canSendMessage: boolean;
  isProcessing: boolean;
  pendingConfirmations: number;
  turnId?: string;
  supportsMidturnDelivery: boolean;
}

export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done';

/** WorkBuddy-style expert — extends Role with methodology + defaults. */
export interface ExpertProfile {
  id: string;
  name: string;
  /** 角色定位 */
  positioning: string;
  /** 方法论 / system prompt 摘要 */
  methodology: string;
  defaultSkills: string[];
  defaultConnectors: string[];
  /** Optional team slot binding */
  slotId?: string;
}

export interface SkillRef {
  id: string;
  name: string;
}

/** Loaded skill package — SKILL.md + scripts + tool whitelist. */
export interface SkillPackage extends SkillRef {
  description: string;
  /** SKILL.md body (after frontmatter) */
  content: string;
  scripts: string[];
  toolWhitelist: string[];
  dir: string;
}

export type ConnectorKind = 'mcp' | 'email' | 'im' | 'docs' | 'other';

export interface ConnectorRef {
  id: string;
  name: string;
  kind: ConnectorKind;
  enabled: boolean;
  config?: Record<string, string>;
}

/** Project-level defaults injected into new tasks. */
export interface ProjectConfig {
  projectId: string;
  globalInstructions: string;
  defaultExperts: string[];
  defaultSkills: string[];
  defaultConnectors: string[];
  updatedAt: string;
}

export interface ArtifactRef {
  id: string;
  taskId: string;
  filename: string;
  version: number;
  mimeType?: string;
  createdAt: string;
  sizeBytes: number;
}

/** Per-user preference — separate from project team standards. */
export interface MemoryEntry {
  userId: string;
  key: string;
  value: string;
  updatedAt: string;
}

/** Munder hive task — assignee must survive status patches. */
export interface HiveTask {
  id: string;
  title: string;
  description?: string;
  assignee?: string;
  status: TaskStatus;
  dependsOn: string[];
  priority: number;
  createdAt: string;
  result?: string;
  /** P4 — expert / skill / connector context */
  expertId?: string;
  skillIds?: string[];
  connectorIds?: string[];
  parentTaskId?: string;
  /** Project global instructions + memory prefs merged at create time */
  injectedInstructions?: string;
  artifactIds?: string[];
}

export interface DaemonInfo {
  daemonId: string;
  deviceName: string;
  launchedBy: 'electron' | 'cli' | 'test';
  startedAt: number;
}
