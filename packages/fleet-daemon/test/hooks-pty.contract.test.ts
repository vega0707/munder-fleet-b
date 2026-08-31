/**
 * Contract: HookServer PreToolUse ↔ ControlRegistry / DecisionGate (munder + Aion).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ControlRegistry } from '../src/control.js';
import { DecisionGate } from '../src/decisionGate.js';
import { HookServer } from '../src/hookServer.js';
import { buildPtyEnv, withHiveRuntimeFallback } from '../src/ptyEnv.js';
import { HiveRoot } from '../src/hiveRoot.js';
import { FleetDaemon } from '../src/daemon.js';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('HookServer contracts', () => {
  it('paused agent → PreToolUse permissionDecision deny', () => {
    const control = new ControlRegistry();
    control.pause('agent-1', true);
    const events: unknown[] = [];
    const hooks = new HookServer({
      sockPath: '/tmp/unused.sock',
      control,
      emit: (e) => events.push(e)
    });
    const res = hooks.handle({
      hook_event_name: 'PreToolUse',
      agent_id: 'agent-1',
      tool_name: 'Bash'
    }) as { hookSpecificOutput?: { permissionDecision?: string } };
    assert.equal(res.hookSpecificOutput?.permissionDecision, 'deny');
    assert.equal((events[0] as { blocked?: boolean }).blocked, true);
  });

  it('halt → continue:false', () => {
    const control = new ControlRegistry();
    control.halt('agent-1');
    const hooks = new HookServer({ sockPath: '/tmp/unused.sock', control });
    const res = hooks.handle({
      hook_event_name: 'PostToolUse',
      agent_id: 'agent-1'
    }) as { continue?: boolean };
    assert.equal(res.continue, false);
  });

  it('require_decision → PendingDecision + deny until confirm', () => {
    const decisions = new DecisionGate();
    const hooks = new HookServer({
      sockPath: '/tmp/unused.sock',
      projectId: 'floor-1',
      decisions
    });
    const res = hooks.handle({
      hook_event_name: 'PreToolUse',
      agent_id: 'w1',
      tool_name: 'Bash',
      require_decision: true,
      call_id: 'call-9'
    }) as { hookSpecificOutput?: { permissionDecision?: string } };
    assert.equal(res.hookSpecificOutput?.permissionDecision, 'deny');
    assert.equal(decisions.pendingCount('floor-1'), 1);
    assert.equal(decisions.summary('floor-1').canSendMessage, false);
    decisions.confirm('floor-1', 'call-9');
    assert.equal(decisions.pendingCount('floor-1'), 0);
  });

  it('steer injects additionalContext once', () => {
    const control = new ControlRegistry();
    control.steer('agent-1', 'prefer tests');
    const hooks = new HookServer({ sockPath: '/tmp/unused.sock', control });
    const res = hooks.handle({
      hook_event_name: 'UserPromptSubmit',
      agent_id: 'agent-1'
    }) as { hookSpecificOutput?: { additionalContext?: string } };
    assert.match(res.hookSpecificOutput?.additionalContext ?? '', /prefer tests/);
    const again = hooks.handle({
      hook_event_name: 'UserPromptSubmit',
      agent_id: 'agent-1'
    }) as { hookSpecificOutput?: { additionalContext?: string } };
    assert.equal(again.hookSpecificOutput?.additionalContext, undefined);
  });
});

describe('ptyEnv + HiveRoot', () => {
  it('buildPtyEnv strips parent Claude session markers', () => {
    const env = buildPtyEnv(
      {
        PATH: '/usr/bin',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        CLAUDE_CODE_SESSION_ID: 'parent',
        CLAUDE_CONFIG_DIR: '/keep'
      },
      '/usr/bin'
    );
    assert.equal(env.CLAUDE_CODE_SESSION_ID, undefined);
    assert.equal(env.CLAUDE_CODE_ENTRYPOINT, undefined);
    assert.equal(env.CLAUDE_CONFIG_DIR, '/keep');
  });

  it('withHiveRuntimeFallback appends bin/runtime', () => {
    const path = withHiveRuntimeFallback('/usr/bin', '/hive', ':');
    assert.equal(path, '/usr/bin:/hive/bin/runtime');
  });

  it('HiveRoot.ensure creates tasks.json and sock path', () => {
    const home = mkdtempSync(join(tmpdir(), 'fleet-hive-'));
    const hive = new HiveRoot({ home, projectId: 'p1' });
    hive.ensure();
    assert.ok(existsSync(join(home, 'hive', 'tasks.json')));
    assert.ok(hive.sockPath().includes('hooks.sock') || hive.sockPath().includes('pipe'));
  });

  it('FleetDaemon.start wires HookServer when enableHooks', () => {
    const home = mkdtempSync(join(tmpdir(), 'fleet-daemon-'));
    const daemon = new FleetDaemon({
      hiveHome: home,
      launchedBy: 'test',
      enableHooks: true,
      providers: [{ name: 'claude', provider: 'claude' }]
    });
    daemon.start();
    assert.ok(daemon.hooks);
    assert.ok(existsSync(join(home, 'hive', 'tasks.json')));
    daemon.stop();
  });
});
