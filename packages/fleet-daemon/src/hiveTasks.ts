/**
 * In-memory + optional FS hive task store.
 * Preserves assignee across status patches (Munder invariant).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HiveTask, TaskStatus } from '@munder/fleet-protocol';
import { mergeTaskLedger, patchTaskInLedger } from './taskLedger.js';

function normalizeTask(raw: Record<string, unknown>): HiveTask {
  const status = raw.status;
  const ok: TaskStatus =
    status === 'todo' || status === 'doing' || status === 'blocked' || status === 'done'
      ? status
      : 'todo';
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    description: typeof raw.description === 'string' ? raw.description : undefined,
    assignee: typeof raw.assignee === 'string' ? raw.assignee : undefined,
    status: ok,
    dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn.map(String) : [],
    priority: typeof raw.priority === 'number' ? raw.priority : 0,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    result: typeof raw.result === 'string' ? raw.result : undefined
  };
}

export class HiveTaskStore {
  private tasks: unknown[] = [];
  private readonly filePath: string | undefined;

  constructor(hiveDir?: string) {
    if (hiveDir) {
      mkdirSync(hiveDir, { recursive: true });
      this.filePath = join(hiveDir, 'tasks.json');
      if (existsSync(this.filePath)) {
        try {
          const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
          this.tasks = Array.isArray(raw) ? raw : Array.isArray((raw as { tasks?: unknown }).tasks)
            ? ((raw as { tasks: unknown[] }).tasks)
            : [];
        } catch {
          this.tasks = [];
        }
      }
    }
  }

  list(): HiveTask[] {
    return this.tasks
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
      .map((t) => normalizeTask(t));
  }

  addTask(task: HiveTask): HiveTask {
    this.tasks = mergeTaskLedger(this.tasks, [...this.tasks, task]);
    this.persist();
    return task;
  }

  /** Partial patch — missing keys mean "unchanged", including assignee. */
  patchTask(id: string, patch: Partial<HiveTask>): HiveTask | undefined {
    // Never implicitly clear assignee on status-only updates
    const cleaned = { ...patch };
    if (!('assignee' in patch)) delete cleaned.assignee;
    this.tasks = patchTaskInLedger(this.tasks, id, cleaned as Record<string, unknown>);
    this.persist();
    return this.list().find((t) => t.id === id);
  }

  writeTasks(incoming: unknown[]): HiveTask[] {
    this.tasks = mergeTaskLedger(this.tasks, incoming);
    this.persist();
    return this.list();
  }

  private persist(): void {
    if (!this.filePath) return;
    writeFileSync(this.filePath, JSON.stringify(this.tasks, null, 2), 'utf8');
  }
}
