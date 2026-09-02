/**
 * Project config — global instructions + default Expert/Skill/Connector presets.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HiveTask, ProjectConfig } from '@munder/fleet-protocol';

export function defaultProjectConfig(projectId: string): ProjectConfig {
  return {
    projectId,
    globalInstructions: '',
    defaultExperts: [],
    defaultSkills: [],
    defaultConnectors: [],
    updatedAt: new Date().toISOString()
  };
}

/** Merge project defaults + optional memory lines into a new task. */
export function injectProjectContext(
  task: HiveTask,
  config: ProjectConfig,
  memoryLines: string[] = []
): HiveTask {
  const parts: string[] = [];
  if (config.globalInstructions.trim()) parts.push(config.globalInstructions.trim());
  if (memoryLines.length) parts.push(memoryLines.join('\n'));
  const injected = parts.join('\n\n');

  const skillIds = [...new Set([...(task.skillIds ?? []), ...config.defaultSkills])];
  const connectorIds = [...new Set([...(task.connectorIds ?? []), ...config.defaultConnectors])];

  let expertId = task.expertId;
  let assignee = task.assignee;
  if (!expertId && config.defaultExperts.length === 1) {
    expertId = config.defaultExperts[0];
  }
  if (!assignee && config.defaultExperts.length === 1) {
    assignee = config.defaultExperts[0];
  }

  return {
    ...task,
    expertId,
    assignee,
    skillIds: skillIds.length ? skillIds : undefined,
    connectorIds: connectorIds.length ? connectorIds : undefined,
    injectedInstructions: injected || task.injectedInstructions,
    description: injected
      ? [task.description, injected].filter(Boolean).join('\n\n')
      : task.description
  };
}

export class ProjectConfigStore {
  private readonly filePath: string;
  private config: ProjectConfig;

  constructor(hiveDir: string, projectId: string) {
    mkdirSync(hiveDir, { recursive: true });
    this.filePath = join(hiveDir, 'project.json');
    this.config = defaultProjectConfig(projectId);
    this.load(projectId);
  }

  private load(projectId: string): void {
    if (!existsSync(this.filePath)) {
      this.config = defaultProjectConfig(projectId);
      this.persist();
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as ProjectConfig;
      this.config = { ...defaultProjectConfig(projectId), ...raw, projectId };
    } catch {
      this.config = defaultProjectConfig(projectId);
    }
  }

  get(): ProjectConfig {
    return { ...this.config };
  }

  update(patch: Partial<ProjectConfig>): ProjectConfig {
    this.config = {
      ...this.config,
      ...patch,
      projectId: this.config.projectId,
      updatedAt: new Date().toISOString()
    };
    this.persist();
    return this.get();
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.config, null, 2), 'utf8');
  }
}
