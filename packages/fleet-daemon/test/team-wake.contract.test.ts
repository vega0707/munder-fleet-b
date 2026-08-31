/**
 * Contract: TeamWake + Michael completion (Aion scheduler).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentNotFoundError, TeamWakeScheduler } from '../src/teamWake.js';
import { FleetDaemon } from '../src/daemon.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function seedTeam(s: TeamWakeScheduler) {
  s.upsertAgent({ slotId: 'michael', name: 'Michael', role: 'lead', status: 'idle' });
  s.upsertAgent({ slotId: 'w1', name: 'Worker1', role: 'teammate', status: 'idle' });
  s.upsertAgent({ slotId: 'w2', name: 'Worker2', role: 'teammate', status: 'idle' });
}

describe('TeamWakeScheduler', () => {
  it('tryWake idle → Working + payload', () => {
    const s = new TeamWakeScheduler();
    seedTeam(s);
    const p = s.tryWake('w1');
    assert.ok(p);
    assert.equal(p.agent.status, 'working');
  });

  it('tryWake non-idle → null', () => {
    const s = new TeamWakeScheduler();
    seedTeam(s);
    s.tryWake('w1');
    assert.equal(s.tryWake('w1'), null);
  });

  it('tryWake missing → AgentNotFoundError', () => {
    const s = new TeamWakeScheduler();
    assert.throws(() => s.tryWake('ghost'), (e: unknown) => e instanceof AgentNotFoundError);
  });

  it('teammate markIdle writes idle_notification to Michael', () => {
    const s = new TeamWakeScheduler();
    seedTeam(s);
    s.tryWake('w1');
    s.markIdle('w1', 'sub-task done');
    const mail = s.listMailbox('michael');
    assert.equal(mail.length, 1);
    assert.equal(mail[0]?.type, 'idle_notification');
    assert.equal(mail[0]?.content, 'sub-task done');
    assert.equal(mail[0]?.from, 'w1');
  });

  it('all teammates settled + lead idle → returns michael to wake', () => {
    const s = new TeamWakeScheduler();
    seedTeam(s);
    s.tryWake('w1');
    s.tryWake('w2');
    assert.equal(s.markIdle('w1', 'a'), null); // w2 still working
    const lead = s.markIdle('w2', 'b');
    assert.equal(lead, 'michael');
  });

  it('lead markIdle never self-wakes and writes no notification', () => {
    const s = new TeamWakeScheduler();
    seedTeam(s);
    s.tryWake('michael');
    assert.equal(s.markIdle('michael', 'done'), null);
    assert.equal(s.listMailbox('michael').length, 0);
  });

  it('FleetDaemon.completeToMichael wakes lead when all idle', () => {
    const home = mkdtempSync(join(tmpdir(), 'fleet-team-'));
    const d = new FleetDaemon({ hiveHome: home, launchedBy: 'test', enableHooks: false });
    d.start();
    d.team.upsertAgent({ slotId: 'w1', name: 'W', role: 'teammate', status: 'working' });
    const { leadToWake } = d.completeToMichael('w1', 'shipped');
    assert.equal(leadToWake, 'michael');
    assert.equal(d.team.listAgents().find((a) => a.slotId === 'michael')?.status, 'working');
    d.stop();
  });
});
