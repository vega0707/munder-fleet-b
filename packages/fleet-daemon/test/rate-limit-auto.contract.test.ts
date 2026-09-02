/**
 * Contract: auto-parse CLI rate-limit from PTY/hook output + per-plan dynamic tune.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RuntimeRegistry } from '../src/runtimeRegistry.js';
import { PlanRegistry } from '../src/planRegistry.js';
import { QuotaLedger } from '../src/quotaLedger.js';
import { PlanLimitTuner } from '../src/planLimitTuner.js';
import { RateLimitWatcher } from '../src/rateLimitWatcher.js';
import { FakePtyBackend, PtyManager } from '../src/ptyManager.js';

describe('Auto rate-limit parse + dynamic tune', () => {
  it('RateLimitWatcher ingests PTY output and enters cooldown', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fleet-rl-'));
    const reg = new RuntimeRegistry();
    const [r] = reg.ensureLocal({
      daemonId: 'd1',
      deviceName: 'x',
      providers: [{ name: 'claude', provider: 'claude', planId: 'claude-jim' }],
      now: 1_000_000
    });
    const plans = new PlanRegistry(dir);
    plans.upsert({
      planId: 'claude-jim',
      provider: 'claude',
      limits: { rateLimitFallbackCooldownMs: 600_000 }
    });
    const quota = new QuotaLedger(dir, plans, reg);
    const watcher = new RateLimitWatcher({ quota, now: () => 1_000_100 });
    const snap = watcher.ingest(
      r!.id,
      'Error: rate limit exceeded — try again in 10 minutes\n'
    );
    assert.ok(snap);
    assert.equal(snap!.available, false);
    assert.equal(snap!.cooldownReason, 'rate_limit');
    assert.equal(quota.isAvailable(r!.id, 1_000_100), false);
    assert.equal(quota.isAvailable(r!.id, 1_000_100 + 10 * 60_000), true);
  });

  it('PtyManager pipes output to RateLimitWatcher via runtimeId', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fleet-rl-pty-'));
    const reg = new RuntimeRegistry();
    const [r] = reg.ensureLocal({
      daemonId: 'd2',
      deviceName: 'x',
      providers: [{ name: 'cursor', provider: 'cursor', planId: 'cursor-1' }],
      now: 2_000_000
    });
    const plans = new PlanRegistry(dir);
    plans.upsert({
      planId: 'cursor-1',
      provider: 'cursor',
      limits: { rateLimitFallbackCooldownMs: 300_000 }
    });
    const quota = new QuotaLedger(dir, plans, reg);
    const watcher = new RateLimitWatcher({ quota, now: () => 2_000_001 });
    const fake = new FakePtyBackend();
    const pty = new PtyManager({
      backend: fake,
      emit: (_event, _ptyId, payload) => {
        const p = payload as { chunk?: string; runtimeId?: string };
        if (p.chunk && p.runtimeId) watcher.ingest(p.runtimeId, p.chunk);
      }
    });
    const info = pty.spawn({ command: 'claude', runtimeId: r!.id });
    fake.emitData(info.id, '429 Too Many Requests try again in 5 minutes');
    assert.equal(quota.isAvailable(r!.id, 2_000_001), false);
  });

  it('PlanLimitTuner rewrites limits when autoTune.enabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fleet-tune-'));
    const reg = new RuntimeRegistry();
    const [r] = reg.ensureLocal({
      daemonId: 'd3',
      deviceName: 'x',
      providers: [{ name: 'claude', provider: 'claude', planId: 'claude-learn' }],
      now: 3_000_000
    });
    const plans = new PlanRegistry(dir);
    plans.upsert({
      planId: 'claude-learn',
      provider: 'claude',
      autoTune: { enabled: true, learningRate: 0.5 }
    });
    const quota = new QuotaLedger(dir, plans, reg);
    const tuner = new PlanLimitTuner(dir, plans);
    let now = 3_000_100;
    const watcher = new RateLimitWatcher({ quota, tuner, now: () => now });

    quota.recordClaim(r!.id, 3_000_000);
    quota.recordClaim(r!.id, 3_000_001);
    watcher.ingest(r!.id, 'rate limit — try again in 20 minutes');
    now += 10_000;
    quota.recordClaim(r!.id, 3_000_010);
    watcher.ingest(r!.id, 'quota exceeded try again in 18 minutes');

    const tuned = plans.get('claude-learn');
    assert.ok(tuned?.limits?.maxConsecutiveTasks);
    assert.ok(tuned?.limits?.rateLimitFallbackCooldownMs);
    assert.ok(tuner.list('claude-learn').length >= 2);
  });
});
