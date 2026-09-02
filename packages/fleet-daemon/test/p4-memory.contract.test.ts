/**
 * Contract: Memory — per-user prefs injected into new tasks (P4-P3).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FleetDaemon } from '../src/daemon.js';
import { MemoryStore } from '../src/memoryStore.js';

describe('P4 Memory', () => {
  it('MemoryStore set/get roundtrip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fleet-mem-'));
    const store = new MemoryStore(dir);
    store.set('u1', 'style', 'bullet-first');
    const entry = store.get('u1', 'style');
    assert.equal(entry?.value, 'bullet-first');
    assert.deepEqual(store.linesForUser('u1'), ['[memory:style] bullet-first']);
  });

  it('addTask injects memory for requesting user', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fleet-mem-d-'));
    const daemon = new FleetDaemon({ hiveHome: home, enableHooks: false });
    await daemon.startAsync();
    daemon.setMemory('user-a', 'tone', 'formal');
    const task = daemon.addTask(
      {
        id: 't1',
        title: 'Memo',
        status: 'todo',
        dependsOn: [],
        priority: 0,
        createdAt: new Date().toISOString()
      },
      { userId: 'user-a' }
    );
    assert.match(task.description ?? '', /formal/);
    daemon.stop();
  });
});
