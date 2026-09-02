/**
 * Headless PtyManager — behavioral subset of munder-difflin PtyManager.
 * No Electron WebContents; emits via callback. Spawning is optional/pluggable
 * so contract tests run without node-pty native bindings.
 */
import { randomUUID } from 'node:crypto';

export interface PtyInfo {
  id: string;
  pid?: number;
  cwd: string;
  command: string;
  alive: boolean;
}

export interface SpawnOpts {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  /** Fleet runtime bound to this PTY session (for quota / rate-limit detection). */
  runtimeId?: string;
}

export type PtyEmit = (event: 'data' | 'exit', ptyId: string, payload: unknown) => void;

/** Pluggable backend — real node-pty or fake for tests. */
export interface PtyBackend {
  spawn(opts: SpawnOpts): {
    id?: string;
    pid?: number;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(): void;
    onData?(callback: (data: string) => void): void;
  };
}

export class FakePtyBackend implements PtyBackend {
  private readonly dataHandlers = new Map<string, (data: string) => void>();

  /** Test helper — push output as if CLI wrote to PTY. */
  emitData(ptyId: string, data: string): void {
    this.dataHandlers.get(ptyId)?.(data);
  }

  spawn(opts: SpawnOpts) {
    const id = randomUUID();
    return {
      id,
      pid: process.pid,
      write(_data: string) {},
      resize(_cols: number, _rows: number) {},
      kill() {},
      onData: (callback: (data: string) => void) => {
        this.dataHandlers.set(id, callback);
      }
    };
  }
}

export class PtyManager {
  private readonly sessions = new Map<
    string,
    {
      info: PtyInfo;
      runtimeId?: string;
      write: (d: string) => void;
      resize: (c: number, r: number) => void;
      kill: () => void;
    }
  >();
  private backend: PtyBackend;
  private emit: PtyEmit;

  constructor(opts: { backend?: PtyBackend; emit?: PtyEmit } = {}) {
    this.backend = opts.backend ?? new FakePtyBackend();
    this.emit = opts.emit ?? (() => {});
  }

  setEmit(emit: PtyEmit): void {
    this.emit = emit;
  }

  setBackend(backend: PtyBackend): void {
    this.backend = backend;
  }

  spawn(opts: SpawnOpts): PtyInfo {
    const handle = this.backend.spawn(opts);
    const id = handle.id ?? randomUUID();
    const info: PtyInfo = {
      id,
      pid: handle.pid,
      cwd: opts.cwd ?? process.cwd(),
      command: opts.command,
      alive: true
    };
    if (handle.onData) {
      handle.onData((chunk) => {
        this.emit('data', id, { chunk, runtimeId: opts.runtimeId });
      });
    }
    this.sessions.set(id, {
      info,
      runtimeId: opts.runtimeId,
      write: (d) => handle.write(d),
      resize: (c, r) => handle.resize(c, r),
      kill: () => handle.kill()
    });
    return info;
  }

  write(ptyId: string, data: string): boolean {
    const s = this.sessions.get(ptyId);
    if (!s?.info.alive) return false;
    s.write(data);
    return true;
  }

  resize(ptyId: string, cols: number, rows: number): boolean {
    const s = this.sessions.get(ptyId);
    if (!s?.info.alive) return false;
    s.resize(cols, rows);
    return true;
  }

  kill(ptyId: string): boolean {
    const s = this.sessions.get(ptyId);
    if (!s) return false;
    s.kill();
    s.info.alive = false;
    this.emit('exit', ptyId, { code: 0 });
    return true;
  }

  list(): PtyInfo[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }));
  }

  getActivePtyCount(): number {
    return [...this.sessions.values()].filter((s) => s.info.alive).length;
  }

  runtimeIdFor(ptyId: string): string | undefined {
    return this.sessions.get(ptyId)?.runtimeId;
  }
}
