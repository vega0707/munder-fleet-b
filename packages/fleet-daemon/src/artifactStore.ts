/**
 * Task artifact delivery — versioned files under hive/artifacts/.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ArtifactRef } from '@munder/fleet-protocol';

export interface ArtifactWriteInput {
  taskId: string;
  filename: string;
  content: string | Buffer;
  mimeType?: string;
}

export class ArtifactStore {
  private readonly root: string;

  constructor(hiveDir: string) {
    this.root = join(hiveDir, 'artifacts');
    mkdirSync(this.root, { recursive: true });
  }

  list(taskId: string): ArtifactRef[] {
    const dir = join(this.root, taskId);
    if (!existsSync(dir)) return [];
    const manifestPath = join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) return [];
    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as ArtifactRef[];
      return Array.isArray(raw) ? raw.map((a) => ({ ...a })) : [];
    } catch {
      return [];
    }
  }

  write(input: ArtifactWriteInput): ArtifactRef {
    const taskDir = join(this.root, input.taskId);
    mkdirSync(taskDir, { recursive: true });
    const existing = this.list(input.taskId).filter((a) => a.filename === input.filename);
    const version = existing.length ? Math.max(...existing.map((a) => a.version)) + 1 : 1;
    const versionDir = join(taskDir, String(version));
    mkdirSync(versionDir, { recursive: true });
    const filePath = join(versionDir, input.filename);
    const buf = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content, 'utf8');
    writeFileSync(filePath, buf);
    const ref: ArtifactRef = {
      id: `art_${randomUUID().slice(0, 8)}`,
      taskId: input.taskId,
      filename: input.filename,
      version,
      mimeType: input.mimeType,
      createdAt: new Date().toISOString(),
      sizeBytes: buf.length
    };
    const manifest = [...existing, ref];
    writeFileSync(join(taskDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    return ref;
  }

  read(taskId: string, artifactId: string): { ref: ArtifactRef; content: Buffer } | null {
    const ref = this.list(taskId).find((a) => a.id === artifactId);
    if (!ref) return null;
    const filePath = join(this.root, taskId, String(ref.version), ref.filename);
    if (!existsSync(filePath)) return null;
    return { ref, content: readFileSync(filePath) };
  }

  /** Stable digest for contract tests */
  digest(taskId: string): string {
    const dir = join(this.root, taskId);
    if (!existsSync(dir)) return '';
    const parts: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === 'manifest.json') continue;
      const vdir = join(dir, entry);
      if (!statSync(vdir).isDirectory()) continue;
      for (const file of readdirSync(vdir)) {
        const content = readFileSync(join(vdir, file));
        parts.push(createHash('sha256').update(content).digest('hex'));
      }
    }
    return createHash('sha256').update(parts.sort().join('')).digest('hex');
  }
}
