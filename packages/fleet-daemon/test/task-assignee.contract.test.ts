/**
 * Contract: Hive task assignee survives status patches (Munder).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTaskLedger, patchTaskInLedger } from '../src/taskLedger.js';
import { HiveTaskStore } from '../src/hiveTasks.js';
import { FleetDaemon } from '../src/daemon.js';

describe('Task assignee preservation', () => {
  it('status patch does not clear assignee', () => {
    const existing = [
      {
        id: 't1',
        title: 'Ship',
        assignee: 'worker-alice',
        status: 'todo',
        dependsOn: [],
        priority: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        result: 'keep-me'
      }
    ];
    const patched = patchTaskInLedger(existing, 't1', { status: 'doing' });
    assert.equal((patched[0] as { assignee: string }).assignee, 'worker-alice');
    assert.equal((patched[0] as { result: string }).result, 'keep-me');
    assert.equal((patched[0] as { status: string }).status, 'doing');
  });

  it('mergeTaskLedger keeps fields omitted by incoming writer', () => {
    const existing = [{ id: 't1', title: 'A', assignee: 'bob', secret: 'hand-written' }];
    const incoming = [{ id: 't1', title: 'A', status: 'done' }];
    const merged = mergeTaskLedger(existing, incoming);
    assert.equal((merged[0] as { assignee: string }).assignee, 'bob');
    assert.equal((merged[0] as { secret: string }).secret, 'hand-written');
    assert.equal((merged[0] as { status: string }).status, 'done');
  });

  it('HiveTaskStore.patchTask status-only keeps assignee', () => {
    const store = new HiveTaskStore();
    store.addTask({
      id: 't1',
      title: 'Work',
      assignee: 'agent-9',
      status: 'todo',
      dependsOn: [],
      priority: 0,
      createdAt: new Date().toISOString()
    });
    const updated = store.patchTask('t1', { status: 'blocked' });
    assert.equal(updated?.assignee, 'agent-9');
    assert.equal(updated?.status, 'blocked');
  });

  it('FleetDaemon preserves assignee across patch', () => {
    const daemon = new FleetDaemon({ launchedBy: 'test' });
    daemon.start();
    daemon.addTask({
      id: 'task-1',
      title: 'Do thing',
      assignee: 'clone-x',
      status: 'todo',
      dependsOn: [],
      priority: 2,
      createdAt: new Date().toISOString()
    });
    daemon.patchTask('task-1', { status: 'doing' });
    assert.equal(daemon.listTasks()[0]?.assignee, 'clone-x');
    daemon.stop();
  });
});
