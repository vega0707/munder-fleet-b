/**
 * Expert Group orchestrator — Michael splits parent task → parallel subtasks → aggregate.
 */
import { randomUUID } from 'node:crypto';
import type { HiveTask } from '@munder/fleet-protocol';

export interface SubtaskSpec {
  title: string;
  description?: string;
  assignee?: string;
  expertId?: string;
}

export class Orchestrator {
  /**
   * Split parent into child tasks. Children depend on parent completion gate
   * (parent stays `doing` until all children `done`).
   */
  splitParent(
    parent: HiveTask,
    subtasks: SubtaskSpec[],
    now = new Date().toISOString()
  ): { parent: HiveTask; children: HiveTask[] } {
    const children: HiveTask[] = subtasks.map((spec, i) => ({
      id: `${parent.id}__sub_${i + 1}`,
      title: spec.title,
      description: spec.description,
      assignee: spec.assignee ?? spec.expertId,
      expertId: spec.expertId,
      status: 'todo' as const,
      dependsOn: [],
      priority: parent.priority,
      createdAt: now,
      parentTaskId: parent.id
    }));

    const parentPatch: HiveTask = {
      ...parent,
      status: 'doing',
      dependsOn: parent.dependsOn
    };

    return { parent: parentPatch, children };
  }

  /** When all direct children are done, merge results into parent. */
  aggregateIfReady(parent: HiveTask, allTasks: HiveTask[]): HiveTask | null {
    const children = allTasks.filter((t) => t.parentTaskId === parent.id);
    if (children.length === 0) return null;
    if (!children.every((c) => c.status === 'done')) return null;
    const summaries = children
      .map((c) => `## ${c.title}\n${c.result ?? '(no result)'}`)
      .join('\n\n');
    return {
      ...parent,
      status: 'done',
      result: summaries
    };
  }

  newGroupId(): string {
    return `grp_${randomUUID().slice(0, 8)}`;
  }
}
