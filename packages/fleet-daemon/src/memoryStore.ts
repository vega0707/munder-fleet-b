/**
 * Per-user memory — cross-task preferences (separate from project team standards).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MemoryEntry } from '@munder/fleet-protocol';

export class MemoryStore {
  private readonly filePath: string;
  private entries: MemoryEntry[] = [];

  constructor(hiveDir: string) {
    mkdirSync(hiveDir, { recursive: true });
    this.filePath = join(hiveDir, 'memory.json');
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.entries = [];
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
      this.entries = Array.isArray(raw) ? (raw as MemoryEntry[]) : [];
    } catch {
      this.entries = [];
    }
  }

  list(userId?: string): MemoryEntry[] {
    const all = this.entries.map((e) => ({ ...e }));
    return userId ? all.filter((e) => e.userId === userId) : all;
  }

  get(userId: string, key: string): MemoryEntry | undefined {
    return this.entries.find((e) => e.userId === userId && e.key === key);
  }

  set(userId: string, key: string, value: string): MemoryEntry {
    const now = new Date().toISOString();
    const idx = this.entries.findIndex((e) => e.userId === userId && e.key === key);
    const entry: MemoryEntry = { userId, key, value, updatedAt: now };
    if (idx >= 0) this.entries[idx] = entry;
    else this.entries.push(entry);
    this.persist();
    return entry;
  }

  /** Format memory as instruction lines for task injection */
  linesForUser(userId: string): string[] {
    return this.list(userId).map((e) => `[memory:${e.key}] ${e.value}`);
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2), 'utf8');
  }
}
