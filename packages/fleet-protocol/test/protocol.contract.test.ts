/**
 * Protocol type smoke — shared exports used by contract suites.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCAL_DEFAULT_USER,
  RUNTIME_CLAIM_FRESHNESS_MS
} from '../src/index.js';

describe('fleet-protocol exports', () => {
  it('LOCAL_DEFAULT_USER matches Aion system_default_user', () => {
    assert.equal(LOCAL_DEFAULT_USER.id, 'system_default_user');
    assert.equal(LOCAL_DEFAULT_USER.username, 'system_default_user');
  });

  it('claim freshness is 150s (Multica)', () => {
    assert.equal(RUNTIME_CLAIM_FRESHNESS_MS, 150_000);
  });
});
