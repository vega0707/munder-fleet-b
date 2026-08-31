/**
 * Optional real node-pty backend. Falls back when native module absent.
 */
import { randomUUID } from 'node:crypto';
import type { PtyBackend, SpawnOpts } from './ptyManager.js';
import { buildPtyEnv } from './ptyEnv.js';

export async function tryCreateNodePtyBackend(): Promise<PtyBackend | null> {
  try {
    const pty = (await import('node-pty')) as typeof import('node-pty');
    return {
      spawn(opts: SpawnOpts) {
        const env = buildPtyEnv(process.env, process.env.PATH ?? '', opts.env);
        const proc = pty.spawn(opts.command, opts.args ?? [], {
          name: 'xterm-256color',
          cols: opts.cols ?? 80,
          rows: opts.rows ?? 24,
          cwd: opts.cwd ?? process.cwd(),
          env
        });
        return {
          id: randomUUID(),
          pid: proc.pid,
          write: (data: string) => proc.write(data),
          resize: (cols: number, rows: number) => proc.resize(cols, rows),
          kill: () => {
            try {
              proc.kill();
            } catch {
              /* noop */
            }
          }
        };
      }
    };
  } catch {
    return null;
  }
}
