/**
 * Contract: Expert Group orchestrator — split → parallel children → aggregate parent.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FleetDaemon } from '../src/daemon.js';
import { Orchestrator } from '../src/orchestrator.js';

describe('P4 Expert Group orchestrator', () => {
  it('splitParent creates children linked to parent', () => {
    const orch = new Orchestrator();
    const parent = {
      id: 'grp-1',
      title: 'Deliver report',
      status: 'todo' as const,
      dependsOn: [],
      priority: 1,
      createdAt: new Date().toISOString()
    };
    const { parent: patched, children } = orch.splitParent(parent, [
      { title: 'Research', assignee: 'w1' },
      { title: 'Slides', assignee: 'w2' }
    ]);
    assert.equal(patched.status, 'doing');
    assert.equal(children.length, 2);
    assert.equal(children[0]?.parentTaskId, 'grp-1');
    assert.equal(children[1]?.assignee, 'w2');
  });

  it('aggregateIfReady merges child results when all done', () => {
    const orch = new Orchestrator();
    const parent = {
      id: 'grp-1',
      title: 'Deliver',
      status: 'doing' as const,
      dependsOn: [],
      priority: 1,
      createdAt: new Date().toISOString()
    };
    const all = [
      parent,
      {
        id: 'grp-1__sub_1',
        title: 'Research',
        status: 'done' as const,
        dependsOn: [],
        priority: 1,
        createdAt: new Date().toISOString(),
        parentTaskId: 'grp-1',
        result: 'facts'
      },
      {
        id: 'grp-1__sub_2',
        title: 'Slides',
        status: 'done' as const,
        dependsOn: [],
        priority: 1,
        createdAt: new Date().toISOString(),
        parentTaskId: 'grp-1',
        result: 'deck'
      }
    ];
    const agg = orch.aggregateIfReady(parent, all);
    assert.ok(agg);
    assert.equal(agg.status, 'done');
    assert.match(agg.result ?? '', /Research/);
    assert.match(agg.result ?? '', /deck/);
  });

  it('daemon splitTask + patch children completes parent', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fleet-orch-'));
    const daemon = new FleetDaemon({ hiveHome: home, enableHooks: false });
    await daemon.startAsync();
    daemon.addTask({
      id: 'grp-1',
      title: 'Bundle',
      status: 'todo',
      dependsOn: [],
      priority: 1,
      createdAt: new Date().toISOString()
    });
    const { children } = daemon.splitTask('grp-1', [
      { title: 'A', assignee: 'w1' },
      { title: 'B', assignee: 'w2' }
    ]);
    assert.equal(children.length, 2);
    for (const c of children) {
      daemon.patchTask(c.id, { status: 'done', result: `done-${c.title}` });
    }
    const parent = daemon.listTasks().find((t) => t.id === 'grp-1');
    assert.equal(parent?.status, 'done');
    assert.match(parent?.result ?? '', /done-A/);
    daemon.stop();
  });
});
