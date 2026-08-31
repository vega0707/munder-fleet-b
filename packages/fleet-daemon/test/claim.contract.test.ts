/**
 * Contract: ClaimService (Multica freshness ≤150s).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RUNTIME_CLAIM_FRESHNESS_MS } from '@munder/fleet-protocol';
import { RuntimeRegistry } from '../src/runtimeRegistry.js';
import { ClaimService, ClaimConflictError, ClaimStaleError } from '../src/claimService.js';

describe('ClaimService', () => {
  it('claim succeeds on fresh online runtime', () => {
    const reg = new RuntimeRegistry();
    const [r] = reg.ensureLocal({
      daemonId: 'd1',
      deviceName: 'x',
      providers: [{ name: 'claude', provider: 'claude' }],
      now: 1_000_000
    });
    assert.ok(r);
    const claims = new ClaimService(reg);
    const c = claims.claim('task-1', r.id, 1_000_000 + 1_000);
    assert.equal(c.taskId, 'task-1');
    assert.equal(c.runtimeId, r.id);
    assert.equal(c.ownerUserId, r.ownerUserId);
  });

  it('stale heartbeat → ClaimStaleError', () => {
    const reg = new RuntimeRegistry();
    const [r] = reg.ensureLocal({
      daemonId: 'd2',
      deviceName: 'x',
      providers: [{ name: 'claude', provider: 'claude' }],
      now: 1_000_000
    });
    assert.ok(r);
    const claims = new ClaimService(reg);
    assert.throws(
      () => claims.claim('t', r.id, 1_000_000 + RUNTIME_CLAIM_FRESHNESS_MS + 1),
      (e: unknown) => e instanceof ClaimStaleError
    );
  });

  it('second claim different runtime → conflict', () => {
    const reg = new RuntimeRegistry();
    const runtimes = reg.ensureLocal({
      daemonId: 'd3',
      deviceName: 'x',
      providers: [
        { name: 'claude', provider: 'claude' },
        { name: 'codex', provider: 'codex' }
      ],
      now: 1_000_000
    });
    const claims = new ClaimService(reg);
    claims.claim('t1', runtimes[0]!.id, 1_000_000);
    assert.throws(
      () => claims.claim('t1', runtimes[1]!.id, 1_000_000),
      (e: unknown) => e instanceof ClaimConflictError
    );
  });

  it('idempotent re-claim same runtime', () => {
    const reg = new RuntimeRegistry();
    const [r] = reg.ensureLocal({
      daemonId: 'd4',
      deviceName: 'x',
      providers: [{ name: 'claude', provider: 'claude' }],
      now: 1_000_000
    });
    assert.ok(r);
    const claims = new ClaimService(reg);
    const a = claims.claim('t', r.id, 1_000_000);
    const b = claims.claim('t', r.id, 1_000_050);
    assert.equal(a.claimedAt, b.claimedAt);
  });
});
