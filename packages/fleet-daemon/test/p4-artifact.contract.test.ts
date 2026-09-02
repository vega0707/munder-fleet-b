/**
 * Contract: Artifact delivery — versioned task outputs (P4-P2).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FleetDaemon } from '../src/daemon.js';
import { ArtifactStore } from '../src/artifactStore.js';

describe('P4 Artifact delivery', () => {
  it('versions same filename on rewrite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fleet-art-'));
    const store = new ArtifactStore(dir);
    const a1 = store.write({ taskId: 't1', filename: 'report.md', content: 'v1' });
    const a2 = store.write({ taskId: 't1', filename: 'report.md', content: 'v2 longer' });
    assert.equal(a1.version, 1);
    assert.equal(a2.version, 2);
    const listed = store.list('t1');
    assert.equal(listed.length, 2);
    const read = store.read('t1', a2.id);
    assert.equal(read?.content.toString('utf8'), 'v2 longer');
  });

  it('daemon writeArtifact links artifactIds on task', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fleet-art-d-'));
    const daemon = new FleetDaemon({ hiveHome: home, enableHooks: false });
    await daemon.startAsync();
    daemon.addTask({
      id: 't1',
      title: 'Deliverable',
      status: 'todo',
      dependsOn: [],
      priority: 0,
      createdAt: new Date().toISOString()
    });
    const ref = daemon.writeArtifact('t1', { filename: 'out.txt', content: 'hello' });
    const task = daemon.listTasks().find((t) => t.id === 't1');
    assert.ok(task?.artifactIds?.includes(ref.id));
    assert.equal(daemon.listArtifacts('t1').length, 1);
    daemon.stop();
  });
});
