/**
 * Contract: PendingDecision hard gate (Aion Confirmation §4.6).
 * Input → expected RuntimeSummary / send outcome.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BusyError, DecisionGate, NotFoundError } from '../src/decisionGate.js';

describe('PendingDecision hard gate', () => {
  it('pending → waiting_confirmation and canSendMessage=false', () => {
    const gate = new DecisionGate();
    gate.setBaseState('running');
    gate.register({
      callId: 'c1',
      conversationId: 'conv-a',
      description: 'Allow Bash?',
      options: [{ label: 'Allow', value: 'allow' }]
    });
    const s = gate.summary('conv-a');
    assert.equal(s.state, 'waiting_confirmation');
    assert.equal(s.canSendMessage, false);
    assert.equal(s.isProcessing, true);
    assert.equal(s.pendingConfirmations, 1);
  });

  it('send while pending → BusyError 409', () => {
    const gate = new DecisionGate();
    gate.register({
      callId: 'c1',
      conversationId: 'conv-a',
      description: 'Allow?',
      options: []
    });
    assert.throws(() => gate.assertClear('conv-a'), (e: unknown) => {
      assert.ok(e instanceof BusyError);
      assert.equal(e.statusCode, 409);
      return true;
    });
  });

  it('confirm clears pending and unblocks send', () => {
    const gate = new DecisionGate();
    gate.setBaseState('running');
    gate.register({
      callId: 'c1',
      conversationId: 'conv-a',
      description: 'Allow?',
      options: []
    });
    gate.confirm('conv-a', 'c1');
    assert.equal(gate.pendingCount('conv-a'), 0);
    assert.doesNotThrow(() => gate.assertClear('conv-a'));
    const s = gate.summary('conv-a');
    assert.equal(s.state, 'running');
    assert.equal(s.pendingConfirmations, 0);
  });

  it('confirm unknown callId → NotFoundError', () => {
    const gate = new DecisionGate();
    assert.throws(() => gate.confirm('conv-a', 'missing'), (e: unknown) => e instanceof NotFoundError);
  });

  it('duplicate callId replaces previous pending', () => {
    const gate = new DecisionGate();
    gate.register({
      callId: 'c1',
      conversationId: 'conv-a',
      description: 'first',
      options: []
    });
    gate.register({
      callId: 'c1',
      conversationId: 'conv-a',
      description: 'second',
      options: []
    });
    assert.equal(gate.pendingCount('conv-a'), 1);
    assert.equal(gate.list('conv-a')[0]?.description, 'second');
  });

  it('cancelAll clears all pending for conversation', () => {
    const gate = new DecisionGate();
    gate.register({ callId: 'a', conversationId: 'c', description: '1', options: [] });
    gate.register({ callId: 'b', conversationId: 'c', description: '2', options: [] });
    assert.equal(gate.cancelAll('c'), 2);
    assert.equal(gate.pendingCount('c'), 0);
  });
});
