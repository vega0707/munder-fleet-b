/**
 * Contract: Gateway connectors + audit + usage (P4-P2/P4-P3).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FleetGateway } from '../src/gateway.js';
import { ConnectorRegistry } from '../src/connectorRegistry.js';

describe('P4 Gateway connectors & enterprise stubs', () => {
  it('ConnectorRegistry register/list/byKind', () => {
    const reg = new ConnectorRegistry();
    reg.register({ id: 'mcp-1', name: 'MCP', kind: 'mcp' });
    reg.register({ id: 'im-slack', name: 'Slack', kind: 'im', enabled: false });
    assert.equal(reg.list().length, 2);
    assert.equal(reg.byKind('mcp').length, 1);
    assert.equal(reg.byKind('im').length, 0);
  });

  it('POST /api/connectors records audit + usage', async () => {
    const gw = new FleetGateway({ identityMode: 'local' });
    const login = await gw.handleForTest('POST', '/login', {
      body: { username: 'a', password: 'b' }
    });
    assert.equal(login.status, 200);
    const res = await gw.handleForTest('POST', '/api/connectors', {
      body: { id: 'docs', name: 'Tencent Docs', kind: 'docs' }
    });
    assert.equal(res.status, 200);
    const body = res.body as { connector: { id: string } };
    assert.equal(body.connector.id, 'docs');
    const audit = await gw.handleForTest('GET', '/api/audit');
    const events = (audit.body as { events: Array<{ action: string }> }).events;
    assert.ok(events.some((e) => e.action === 'connector.register'));
    const usage = await gw.handleForTest('GET', '/api/usage');
    const snap = usage.body as { self: number };
    assert.ok(snap.self >= 2);
  });
});
