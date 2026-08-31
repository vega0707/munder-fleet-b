/**
 * Minimal hive root layout (subset of munder HiveManager FS contract).
 * Provides hooks.sock path + agents/tasks dirs without full mail router.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

export interface HiveRootOpts {
  home?: string;
  projectId?: string;
}

export class HiveRoot {
  readonly home: string;
  readonly projectId: string;

  constructor(opts: HiveRootOpts = {}) {
    this.home = opts.home ?? join(tmpdir(), `fleet-hive-${randomUUID().slice(0, 8)}`);
    this.projectId = opts.projectId ?? 'default';
  }

  hiveDir(): string {
    return join(this.home, 'hive');
  }

  sockPath(): string {
    if (process.platform === 'win32') {
      return `\\\\.\\pipe\\fleet-hooks-${this.projectId}`;
    }
    return join(this.hiveDir(), 'hooks.sock');
  }

  ensure(): void {
    const hive = this.hiveDir();
    mkdirSync(join(hive, 'agents'), { recursive: true });
    mkdirSync(join(hive, 'bin', 'runtime'), { recursive: true });
    const tasks = join(hive, 'tasks.json');
    if (!existsSync(tasks)) writeFileSync(tasks, '[]\n', 'utf8');
    const registry = join(hive, 'registry.json');
    if (!existsSync(registry)) writeFileSync(registry, '{}\n', 'utf8');
  }

  agentDir(agentId: string): string {
    return join(this.hiveDir(), 'agents', agentId);
  }

  ensureAgent(agentId: string): void {
    this.ensure();
    mkdirSync(join(this.agentDir(agentId), 'inbox'), { recursive: true });
    mkdirSync(join(this.agentDir(agentId), 'outbox'), { recursive: true });
  }
}
