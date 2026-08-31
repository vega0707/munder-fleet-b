/**
 * Contract: Blocker → owner + AutoClaim Multica lifecycle.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_DEFAULT_USER } from '@munder/fleet-protocol';
import { BlockerService } from '../src/blockerService.js';
import { RuntimeRegistry } from '../src/runtimeRegistry.js';
import { ClaimService } from '../src/claimService.js';
import { AutoClaimLoop } from '../src/autoClaim.js';
import { HiveMailRouter } from '../src/hiveMail.js';
import { HiveRoot } from '../src/hiveRoot.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('BlockerService', () => {
  it('raise routes to owner; blocks auto claim', () => {
    const b = new BlockerService();
    const blk = b.raise({
      taskOrIssueId: 't1',
      raisedBySlotId: 'w1',
      reason: 'need API key',
      ownerUserId: LOCAL_DEFAULT_USER.id
    });
    assert.equal(blk.ownerUserId, LOCAL_DEFAULT_USER.id);
    assert.equal(b.blocksAutoClaim('t1'), true);
    assert.equal(b.listOpen(LOCAL_DEFAULT_USER.id).length, 1);
  });

  it('only owner can resolve', () => {
    const b = new BlockerService();
    const blk = b.raise({
      taskOrIssueId: 't1',
      raisedBySlotId: 'w1',
      reason: 'x',
      ownerUserId: 'owner-1'
    });
    assert.throws(() => b.resolve(blk.id, 'other'));
    assert.equal(b.resolve(blk.id, 'owner-1').status, 'resolved');
    assert.equal(b.blocksAutoClaim('t1'), false);
  });

  it('dependency completed unblocks downstream', () => {
    const b = new BlockerService();
    b.raise({
      taskOrIssueId: 't2',
      raisedBySlotId: 'w1',
      reason: 'waits t1',
      reasonCode: 'dependency',
      ownerUserId: 'owner-1',
      blockedBy: ['t1']
    });
    const { unblockedIds } = b.onDependencyCompleted('t1');
    assert.deepEqual(unblockedIds, ['t2']);
    assert.equal(b.listOpen().length, 0);
  });
});

describe('AutoClaimLoop + Multica lifecycle', () => {
  it('claims fresh runtime; skips blocked and human assignee', () => {
    const reg = new RuntimeRegistry();
    const [r] = reg.ensureLocal({
      daemonId: 'd1',
      deviceName: 'x',
      providers: [{ name: 'claude', provider: 'claude' }],
      now: 1_000_000
    });
    assert.ok(r);
    const claims = new ClaimService(reg);
    const blockers = new BlockerService();
    blockers.raise({
      taskOrIssueId: 'blocked-1',
      raisedBySlotId: 'w1',
      reason: 'need human',
      ownerUserId: LOCAL_DEFAULT_USER.id
    });
    const loop = new AutoClaimLoop({
      claims,
      blockers,
      listTasks: () => [
        {
          id: 'ok-1',
          title: 'A',
          assignee: 'w1',
          status: 'todo',
          dependsOn: [],
          priority: 0,
          createdAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'blocked-1',
          title: 'B',
          assignee: 'w1',
          status: 'todo',
          dependsOn: [],
          priority: 0,
          createdAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'human-1',
          title: 'C',
          assignee: 'human:alice',
          status: 'todo',
          dependsOn: [],
          priority: 0,
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      now: () => 1_000_000
    });
    const result = loop.tick();
    assert.equal(result.claimed.length, 1);
    assert.equal(result.claimed[0]?.taskId, 'ok-1');
    assert.deepEqual(result.skippedBlocked, ['blocked-1']);
    assert.deepEqual(result.skippedHuman, ['human-1']);
  });
});

describe('HiveMailRouter', () => {
  it('send + routeOnce delivers outbox to inbox', () => {
    const home = mkdtempSync(join(tmpdir(), 'fleet-mail-'));
    const hive = new HiveRoot({ home });
    hive.ensure();
    const mail = new HiveMailRouter(hive);
    mail.send({ to: 'god', body: 'hello', subject: 'hi' }, 'w1');
    assert.equal(mail.routeOnce(), 1);
    assert.equal(mail.inbox('god').length, 1);
    assert.equal(mail.inbox('god')[0]?.body, 'hello');
    assert.equal(mail.routeOnce(), 0); // archived
  });
});
