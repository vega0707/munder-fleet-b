/**
 * Contract: Runtime.ensureLocal (Multica register semantics).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_DEFAULT_USER, RUNTIME_CLAIM_FRESHNESS_MS } from '@munder/fleet-protocol';
import { RuntimeRegistry } from '../src/runtimeRegistry.js';
import { FleetDaemon } from '../src/daemon.js';

describe('Runtime.ensureLocal', () => {
  it('daemon boot registers local runtimes with owner=local user', () => {
    const reg = new RuntimeRegistry();
    const runtimes = reg.ensureLocal({
      daemonId: 'd1',
      deviceName: 'desk',
      providers: [
        { name: 'claude', provider: 'claude', version: '1.0' },
        { name: 'codex', provider: 'codex' }
      ]
    });
    assert.equal(runtimes.length, 2);
    for (const r of runtimes) {
      assert.equal(r.status, 'online');
      assert.equal(r.ownerUserId, LOCAL_DEFAULT_USER.id);
      assert.equal(r.daemonId, 'd1');
    }
  });

  it('empty providers still yields a local placeholder runtime', () => {
    const reg = new RuntimeRegistry();
    const runtimes = reg.ensureLocal({ daemonId: 'd2', deviceName: 'laptop' });
    assert.equal(runtimes.length, 1);
    assert.equal(runtimes[0]?.provider, 'local');
    assert.equal(runtimes[0]?.status, 'online');
  });

  it('heartbeat refreshes lastSeenAt; stale runtime is not claimable', () => {
    const reg = new RuntimeRegistry();
    const [r] = reg.ensureLocal({
      daemonId: 'd3',
      deviceName: 'x',
      providers: [{ name: 'claude', provider: 'claude' }],
      now: 1_000_000
    });
    assert.ok(r);
    assert.equal(reg.isClaimable(r.id, 1_000_000 + 1_000), true);
    assert.equal(reg.isClaimable(r.id, 1_000_000 + RUNTIME_CLAIM_FRESHNESS_MS + 1), false);
    const hb = reg.heartbeat(r.id, 2_000_000);
    assert.equal(hb.status, 'ok');
    assert.equal(reg.isClaimable(r.id, 2_000_000 + 1_000), true);
  });

  it('runtime_gone → prune; heartbeat reports gone', () => {
    const reg = new RuntimeRegistry();
    const [r] = reg.ensureLocal({
      daemonId: 'd4',
      deviceName: 'x',
      providers: [{ name: 'claude', provider: 'claude' }]
    });
    assert.ok(r);
    reg.markGone(r.id);
    assert.equal(reg.get(r.id), undefined);
    const hb = reg.heartbeat(r.id);
    assert.equal(hb.runtimeGone, true);
  });

  it('shutdown deregister → offline', () => {
    const reg = new RuntimeRegistry();
    reg.ensureLocal({
      daemonId: 'd5',
      deviceName: 'x',
      providers: [{ name: 'claude', provider: 'claude' }]
    });
    reg.deregisterAll();
    for (const r of reg.list()) assert.equal(r.status, 'offline');
  });

  it('FleetDaemon.start calls ensureLocal and exposes headless control plane', () => {
    const daemon = new FleetDaemon({
      daemonId: 'fixed-daemon',
      deviceName: 'test-host',
      launchedBy: 'test',
      providers: [{ name: 'claude', provider: 'claude' }]
    });
    const { info, runtimes } = daemon.start();
    assert.equal(info.daemonId, 'fixed-daemon');
    assert.equal(runtimes.length, 1);
    assert.equal(daemon.isRunning, true);
    // No solo|distributed flag on daemon info / public API
    assert.equal('mode' in info, false);
    daemon.stop();
    assert.equal(daemon.isRunning, false);
  });
});
