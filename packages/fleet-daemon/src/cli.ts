#!/usr/bin/env node
/**
 * Headless fleet-daemon entry — no Electron.
 * Usage: fleet-daemon [--hive <dir>] [--listen <host:port>]
 *
 * Control plane is exposed as a minimal JSON HTTP for gateway wiring.
 */
import { createServer } from 'node:http';
import { FleetDaemon } from './daemon.js';
import { BusyError, NotFoundError } from './decisionGate.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const hiveDir = arg('--hive');
const listen = arg('--listen') ?? '127.0.0.1:3920';
const [host, portStr] = listen.split(':');
const port = Number(portStr ?? 3920);

const daemon = new FleetDaemon({
  hiveDir,
  launchedBy: 'cli',
  providers: [
    { name: 'claude', provider: 'claude' },
    { name: 'codex', provider: 'codex' }
  ]
});
const { info, runtimes } = daemon.start();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${host}:${port}`);
  const json = (status: number, body: unknown) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload)
    });
    res.end(payload);
  };

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(200, { ok: true, daemonId: info.daemonId, runtimes: runtimes.length });
    }
    if (req.method === 'GET' && url.pathname === '/runtimes') {
      return json(200, { runtimes: daemon.runtimes.list() });
    }
    if (req.method === 'GET' && url.pathname === '/tasks') {
      return json(200, { tasks: daemon.listTasks() });
    }
    if (req.method === 'POST' && url.pathname === '/tasks') {
      const body = JSON.parse(await readBody(req)) as Parameters<typeof daemon.addTask>[0];
      return json(200, { task: daemon.addTask(body) });
    }
    if (req.method === 'PATCH' && url.pathname.startsWith('/tasks/')) {
      const id = decodeURIComponent(url.pathname.slice('/tasks/'.length));
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      return json(200, { task: daemon.patchTask(id, body) });
    }
    if (req.method === 'POST' && url.pathname === '/decisions') {
      const body = JSON.parse(await readBody(req));
      return json(200, { decision: daemon.registerDecision(body) });
    }
    if (req.method === 'POST' && url.pathname.match(/^\/conversations\/[^/]+\/confirm\/[^/]+$/)) {
      const parts = url.pathname.split('/');
      const conversationId = decodeURIComponent(parts[2]!);
      const callId = decodeURIComponent(parts[4]!);
      return json(200, { decision: daemon.confirmDecision(conversationId, callId) });
    }
    if (req.method === 'POST' && url.pathname.match(/^\/conversations\/[^/]+\/messages$/)) {
      const conversationId = decodeURIComponent(url.pathname.split('/')[2]!);
      const body = JSON.parse(await readBody(req)) as { text?: string };
      return json(200, daemon.sendMessage(conversationId, body.text ?? ''));
    }
    if (req.method === 'GET' && url.pathname.match(/^\/conversations\/[^/]+\/summary$/)) {
      const conversationId = decodeURIComponent(url.pathname.split('/')[2]!);
      return json(200, daemon.decisions.summary(conversationId));
    }
    return json(404, { error: 'not found' });
  } catch (e) {
    if (e instanceof BusyError) return json(409, { error: e.message });
    if (e instanceof NotFoundError) return json(404, { error: e.message });
    console.error(e);
    return json(500, { error: e instanceof Error ? e.message : 'internal' });
  }
});

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8') || '{}'));
    req.on('error', reject);
  });
}

server.listen(port, host, () => {
  console.log(
    JSON.stringify({
      event: 'fleet-daemon-started',
      listen: `${host}:${port}`,
      daemonId: info.daemonId,
      runtimes: runtimes.map((r) => ({ id: r.id, provider: r.provider, owner: r.ownerUserId }))
    })
  );
});

const shutdown = () => {
  daemon.stop();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
