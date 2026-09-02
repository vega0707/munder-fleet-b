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
import { ClaimConflictError, ClaimStaleError } from './claimService.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const hiveHome = arg('--hive');
const listen = arg('--listen') ?? '127.0.0.1:3920';
const [host, portStr] = listen.split(':');
const port = Number(portStr ?? 3920);

const daemon = new FleetDaemon({
  hiveHome,
  launchedBy: 'cli',
  preferNodePty: true,
  providers: [
    { name: 'claude', provider: 'claude' },
    { name: 'codex', provider: 'codex' }
  ]
});
const { info, runtimes } = await daemon.startAsync();

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
    if (req.method === 'POST' && url.pathname === '/claims') {
      const body = JSON.parse(await readBody(req)) as { taskId?: string; runtimeId?: string };
      return json(200, {
        claim: daemon.claimTask(body.taskId ?? '', body.runtimeId ?? '')
      });
    }
    if (req.method === 'GET' && url.pathname === '/claims') {
      return json(200, { claims: daemon.claims.list() });
    }
    if (req.method === 'GET' && url.pathname === '/hooks/sock') {
      return json(200, { sockPath: daemon.hive.sockPath(), projectId: daemon.hive.projectId });
    }
    if (req.method === 'GET' && url.pathname === '/team') {
      return json(200, { agents: daemon.team.listAgents(), mailbox: daemon.team.listMailbox() });
    }
    if (req.method === 'POST' && url.pathname === '/team/register') {
      const body = JSON.parse(await readBody(req));
      daemon.team.upsertAgent(body);
      return json(200, { agents: daemon.team.listAgents() });
    }
    if (req.method === 'POST' && url.pathname === '/team/complete') {
      const body = JSON.parse(await readBody(req)) as { slotId?: string; summary?: string };
      return json(200, daemon.completeToMichael(body.slotId ?? '', body.summary));
    }
    if (req.method === 'GET' && url.pathname === '/blockers') {
      return json(200, { blockers: daemon.blockers.listOpen() });
    }
    if (req.method === 'POST' && url.pathname === '/blockers') {
      const body = JSON.parse(await readBody(req));
      return json(200, { blocker: daemon.blockers.raise(body) });
    }
    if (req.method === 'POST' && url.pathname.match(/^\/blockers\/[^/]+\/resolve$/)) {
      const id = decodeURIComponent(url.pathname.split('/')[2]!);
      const body = JSON.parse(await readBody(req)) as { byUserId?: string };
      return json(200, { blocker: daemon.blockers.resolve(id, body.byUserId ?? '') });
    }
    if (req.method === 'POST' && url.pathname === '/claims/auto') {
      return json(200, daemon.autoClaim.tick());
    }
    if (req.method === 'GET' && url.pathname === '/metrics') {
      return json(200, daemon.metrics.snapshot());
    }
    if (req.method === 'POST' && url.pathname === '/mail/route') {
      return json(200, { delivered: daemon.mail.routeOnce() });
    }
    if (req.method === 'GET' && url.pathname === '/project/config') {
      return json(200, { config: daemon.getProjectConfig() });
    }
    if (req.method === 'PUT' && url.pathname === '/project/config') {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      return json(200, { config: daemon.updateProjectConfig(body) });
    }
    if (req.method === 'GET' && url.pathname === '/experts') {
      return json(200, { experts: daemon.listExperts() });
    }
    if (req.method === 'POST' && url.pathname === '/experts') {
      const body = JSON.parse(await readBody(req));
      return json(200, { expert: daemon.upsertExpert(body) });
    }
    if (req.method === 'GET' && url.pathname === '/skills') {
      return json(200, { skills: daemon.listSkills() });
    }
    if (req.method === 'POST' && url.pathname === '/skills/reload') {
      return json(200, { skills: daemon.reloadSkills() });
    }
    if (req.method === 'POST' && url.pathname === '/orchestrate/split') {
      const body = JSON.parse(await readBody(req)) as {
        parentId?: string;
        subtasks?: Parameters<typeof daemon.splitTask>[1];
      };
      return json(200, daemon.splitTask(body.parentId ?? '', body.subtasks ?? []));
    }
    if (req.method === 'GET' && url.pathname.match(/^\/tasks\/[^/]+\/artifacts$/)) {
      const taskId = decodeURIComponent(url.pathname.split('/')[2]!);
      return json(200, { artifacts: daemon.listArtifacts(taskId) });
    }
    if (req.method === 'POST' && url.pathname.match(/^\/tasks\/[^/]+\/artifacts$/)) {
      const taskId = decodeURIComponent(url.pathname.split('/')[2]!);
      const body = JSON.parse(await readBody(req)) as {
        filename?: string;
        content?: string;
        mimeType?: string;
      };
      return json(200, {
        artifact: daemon.writeArtifact(taskId, {
          filename: body.filename ?? 'output.txt',
          content: body.content ?? '',
          mimeType: body.mimeType
        })
      });
    }
    if (req.method === 'GET' && url.pathname === '/memory') {
      const userId = url.searchParams.get('userId') ?? undefined;
      return json(200, { entries: daemon.listMemory(userId) });
    }
    if (req.method === 'PUT' && url.pathname === '/memory') {
      const body = JSON.parse(await readBody(req)) as { userId?: string; key?: string; value?: string };
      return json(200, {
        entry: daemon.setMemory(body.userId ?? '', body.key ?? '', body.value ?? '')
      });
    }
    return json(404, { error: 'not found' });
  } catch (e) {
    if (e instanceof BusyError) return json(409, { error: e.message });
    if (e instanceof NotFoundError) return json(404, { error: e.message });
    if (e instanceof ClaimStaleError || e instanceof ClaimConflictError) {
      return json(e.statusCode, { error: e.message });
    }
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
