/**
 * Hive mail router — subset of munder HiveManager outbox→inbox delivery.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HiveRoot } from './hiveRoot.js';

export interface HiveMessage {
  id: string;
  from: string;
  to: string;
  subject?: string;
  body: string;
  act?: string;
  createdAt: string;
}

export class HiveMailRouter {
  constructor(private readonly hive: HiveRoot) {}

  ensureAgent(agentId: string): void {
    this.hive.ensureAgent(agentId);
  }

  send(partial: Partial<HiveMessage> & { to: string; body: string }, from = 'system'): HiveMessage {
    this.ensureAgent(from);
    this.ensureAgent(partial.to);
    const msg: HiveMessage = {
      id: partial.id ?? randomUUID(),
      from,
      to: partial.to,
      subject: partial.subject,
      body: partial.body,
      act: partial.act,
      createdAt: partial.createdAt ?? new Date().toISOString()
    };
    const outbox = join(this.hive.agentDir(from), 'outbox');
    mkdirSync(join(outbox, '.sent'), { recursive: true });
    writeFileSync(join(outbox, `${msg.id}.json`), JSON.stringify(msg, null, 2), 'utf8');
    return msg;
  }

  /** Deliver all outbox JSON files once. Returns number delivered. */
  routeOnce(): number {
    const agentsDir = join(this.hive.hiveDir(), 'agents');
    if (!existsSync(agentsDir)) return 0;
    let delivered = 0;
    for (const id of readdirSync(agentsDir)) {
      const outbox = join(agentsDir, id, 'outbox');
      if (!existsSync(outbox)) continue;
      for (const f of readdirSync(outbox)) {
        if (!f.endsWith('.json')) continue;
        const full = join(outbox, f);
        try {
          const msg = JSON.parse(readFileSync(full, 'utf8')) as HiveMessage;
          this.ensureAgent(msg.to);
          const inbox = join(this.hive.agentDir(msg.to), 'inbox');
          mkdirSync(inbox, { recursive: true });
          writeFileSync(join(inbox, f), JSON.stringify(msg, null, 2), 'utf8');
          mkdirSync(join(outbox, '.sent'), { recursive: true });
          renameSync(full, join(outbox, '.sent', f));
          delivered++;
        } catch {
          try {
            mkdirSync(join(outbox, '.sent'), { recursive: true });
            renameSync(full, join(outbox, '.sent', `bad-${f}`));
          } catch {
            /* noop */
          }
        }
      }
    }
    return delivered;
  }

  inbox(agentId: string): HiveMessage[] {
    const dir = join(this.hive.agentDir(agentId), 'inbox');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as HiveMessage);
  }
}
