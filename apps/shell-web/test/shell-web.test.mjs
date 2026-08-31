import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

test('shell-web points at fleet-gateway login and board surfaces', () => {
  const html = readFileSync(join(root, '../public/index.html'), 'utf8');
  assert.match(html, /\/login/);
  assert.match(html, /__GATEWAY__/);
  assert.match(html, /Fleet/);
  assert.match(html, /Assignee/);
  assert.match(html, /PendingDecision/);
  assert.match(html, /角色注册/);
});
