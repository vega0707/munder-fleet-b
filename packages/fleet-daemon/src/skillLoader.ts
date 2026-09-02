/**
 * Skill package loader — SKILL.md + scripts + tool whitelist (WorkBuddy P4).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillPackage } from '@munder/fleet-protocol';

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  tools?: string[];
}

export function parseSkillMarkdown(raw: string): { frontmatter: SkillFrontmatter; body: string } {
  const trimmed = raw.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('---\n')) {
    return { frontmatter: {}, body: trimmed };
  }
  const end = trimmed.indexOf('\n---\n', 4);
  if (end < 0) return { frontmatter: {}, body: trimmed };
  const fmBlock = trimmed.slice(4, end);
  const body = trimmed.slice(end + 5);
  const frontmatter: SkillFrontmatter = {};
  for (const line of fmBlock.split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === 'name') frontmatter.name = value;
    else if (key === 'description') frontmatter.description = value;
    else if (key === 'tools') {
      frontmatter.tools = value
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }
  return { frontmatter, body };
}

export function loadSkillPackage(skillDir: string, id: string): SkillPackage | null {
  const skillMd = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMd)) return null;
  const raw = readFileSync(skillMd, 'utf8');
  const { frontmatter, body } = parseSkillMarkdown(raw);
  const scriptsDir = join(skillDir, 'scripts');
  const scripts: string[] = [];
  if (existsSync(scriptsDir)) {
    for (const entry of readdirSync(scriptsDir)) {
      const full = join(scriptsDir, entry);
      if (statSync(full).isFile()) scripts.push(entry);
    }
  }
  return {
    id,
    name: frontmatter.name ?? id,
    description: frontmatter.description ?? '',
    content: body.trim(),
    scripts,
    toolWhitelist: frontmatter.tools ?? [],
    dir: skillDir
  };
}

export class SkillLoader {
  private readonly skillsDir: string;
  private cache = new Map<string, SkillPackage>();
  private loaded = false;

  constructor(hiveDir: string) {
    this.skillsDir = join(hiveDir, 'skills');
  }

  private loadFromDisk(): void {
    this.cache.clear();
    if (!existsSync(this.skillsDir)) return;
    for (const entry of readdirSync(this.skillsDir)) {
      const dir = join(this.skillsDir, entry);
      if (!statSync(dir).isDirectory()) continue;
      const pkg = loadSkillPackage(dir, entry);
      if (pkg) this.cache.set(entry, pkg);
    }
  }

  reload(): SkillPackage[] {
    this.loaded = false;
    return this.list();
  }

  list(): SkillPackage[] {
    if (!this.loaded) {
      this.loadFromDisk();
      this.loaded = true;
    }
    return [...this.cache.values()];
  }

  get(id: string): SkillPackage | undefined {
    this.list();
    return this.cache.get(id);
  }
}
