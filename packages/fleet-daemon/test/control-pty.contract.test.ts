/**
 * Contract: ControlRegistry tool gate (munder control.ts behavior).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ControlRegistry } from '../src/control.js';
import { PtyManager, FakePtyBackend } from '../src/ptyManager.js';

describe('Headless control + pty', () => {
  it('paused agent denies tools', () => {
    const c = new ControlRegistry();
    c.pause('agent-1', true);
    const d = c.toolDecision('agent-1', 'Bash');
    assert.equal(d.deny, true);
  });

  it('gated tool is denied; other tools allowed', () => {
    const c = new ControlRegistry();
    c.gateTool('agent-1', 'Bash', true);
    assert.equal(c.toolDecision('agent-1', 'Bash').deny, true);
    assert.equal(c.toolDecision('agent-1', 'Read').deny, false);
  });

  it('PtyManager spawns and kills without Electron', () => {
    const pty = new PtyManager({ backend: new FakePtyBackend() });
    const info = pty.spawn({ command: 'bash', cwd: '/tmp' });
    assert.equal(info.alive, true);
    assert.equal(pty.getActivePtyCount(), 1);
    assert.equal(pty.kill(info.id), true);
    assert.equal(pty.list()[0]?.alive, false);
  });
});
