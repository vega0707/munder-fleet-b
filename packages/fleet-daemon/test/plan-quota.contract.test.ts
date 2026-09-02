/**
 * Contract: per-plan quota — no fleet-wide defaults; passive rate-limit + optional proactive limits.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RuntimeRegistry } from '../src/runtimeRegistry.js';
import { PlanRegistry } from '../src/planRegistry.js';
import { QuotaLedger } from '../src/quotaLedger.js';
import { ClaimService, PlanQuotaExhaustedError } from '../src/claimService.js';
import { parseRateLimitSignal } from '../src/rateLimitParser.js';
import { QuotaScheduler } from '../src/quotaScheduler.js';
import { AutoClaimLoop } from '../src/autoClaim.js';
import { BlockerService } from '../src/blockerService.js';
import type { HiveTask } from '@munder/fleet-protocol';

describe('Per-plan quota ledger', () => {
  it('plans without limits stay available until passive rate-limit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fleet-quota-'));
    const reg = new RuntimeRegistry();
    const [r] = reg.ensureLocal({
      daemonId: 'd1',
      deviceName: 'x',
      providers: [{ name: 'cursor', provider: 'cursor', planId: 'cursor-pro' }],
      now: 1_000_000
    });
    const plans = new PlanRegistry(dir);
    plans.upsert({ planId: 'cursor-pro', provider: 'cursor', name: 'Cursor Pro' });
    const quota = new QuotaLedger(dir, plans, reg);
    assert.equal(quota.isAvailable(r!.id, 1_000_000), true);
    quota.recordClaim(r!.id, 1_000_000);
    assert.equal(quota.isAvailable(r!.id, 1_000_001), true);
  });

  it('plan A consecutive limit does not affect plan B', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fleet-quota-'));
    const reg = new RuntimeRegistry();
    const runtimes = reg.ensureLocal({
      daemonId: 'd2',
      deviceName: 'x',
      providers: [
        { name: 'claude', provider: 'claude', planId: 'claude-max' },
        { name: 'codex', provider: 'codex', planId: 'codex-team' }
      ],
      now: 2_000_000
    });
    const plans = new PlanRegistry(dir);
    plans.upsert({
      planId: 'claude-max',
      provider: 'claude',
      limits: { maxConsecutiveTasks: 2, consecutiveCooldownMs: 60_000 }
    });
    plans.upsert({ planId: 'codex-team', provider: 'codex' });
    const quota = new QuotaLedger(dir, plans, reg);
    const claude = runtimes[0]!;
    const codex = runtimes[1]!;
    quota.recordClaim(claude.id, 2_000_000);
    quota.recordClaim(claude.id, 2_000_001);
    assert.equal(quota.isAvailable(claude.id, 2_000_002), false);
    assert.equal(quota.isAvailable(codex.id, 2_000_002), true);
  });

  it('passive rate-limit parses retry-after from provider signal', () => {
    const parsed = parseRateLimitSignal('Error: rate limit exceeded. try again in 45 minutes');
    assert.ok(parsed);
    assert.equal(parsed!.cooldownMs, 45 * 60_000);
  });

  it('cooldown expiry resumes auto-claim on backlog tasks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fleet-quota-'));
    const reg = new RuntimeRegistry();
    const [r] = reg.ensureLocal({
      daemonId: 'd3',
      deviceName: 'x',
      providers: [{ name: 'claude', provider: 'claude', planId: 'claude-jim' }],
      now: 10_000
    });
    const plans = new PlanRegistry(dir);
    plans.upsert({
      planId: 'claude-jim',
      provider: 'claude',
      limits: { maxConsecutiveTasks: 1, consecutiveCooldownMs: 5_000 }
    });
    const quota = new QuotaLedger(dir, plans, reg);
    const claims = new ClaimService(reg, quota);
    const blockers = new BlockerService();
    const tasks: HiveTask[] = [
      {
        id: 't1',
        title: 'a',
        status: 'todo',
        dependsOn: [],
        priority: 0,
        createdAt: new Date().toISOString()
      },
      {
        id: 't2',
        title: 'b',
        status: 'todo',
        dependsOn: [],
        priority: 0,
        createdAt: new Date().toISOString()
      }
    ];
    const auto = new AutoClaimLoop({
      claims,
      blockers,
      listTasks: () => tasks,
      now: () => 10_000
    });

    claims.claim('t1', r!.id, 10_000);
    assert.throws(
      () => claims.claim('t2', r!.id, 10_001),
      (e: unknown) => e instanceof PlanQuotaExhaustedError
    );
    assert.equal(auto.tick().claimed.length, 0);

    const resumed = quota.resumeExpired(16_001);
    assert.deepEqual(resumed, [r!.id]);
    const autoLater = new AutoClaimLoop({
      claims,
      blockers,
      listTasks: () => tasks,
      now: () => 16_001
    });
    const tick = autoLater.tick();
    assert.equal(tick.claimed.length, 1);
    assert.equal(tick.claimed[0]?.taskId, 't2');

    const scheduler = new QuotaScheduler({
      quota,
      autoClaim: autoLater,
      now: () => 16_001
    });
    const result = scheduler.tick();
    assert.equal(result.resumed.length, 0);
    assert.equal(result.claim.claimed.length, 0);
  });
});
