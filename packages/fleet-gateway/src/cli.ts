#!/usr/bin/env node
import { FleetGateway } from './gateway.js';
import type { AuthIdentityMode } from '@munder/fleet-protocol';
import { SessionStore } from './sessionStore.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const mode = (arg('--mode') ?? 'userSession') as AuthIdentityMode;
if (mode !== 'local' && mode !== 'userSession') {
  console.error('Usage: fleet-gateway --mode local|userSession [--listen host:port] [--db path] [--daemon url]');
  process.exit(1);
}

const listen = arg('--listen') ?? '127.0.0.1:25808';
const [host, portStr] = listen.split(':');
const dbPath = arg('--db');
if (dbPath && dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

const gateway = new FleetGateway({
  identityMode: mode,
  store: new SessionStore(dbPath ?? ':memory:'),
  host: host ?? '127.0.0.1',
  port: Number(portStr ?? 25808),
  daemonUrl: arg('--daemon')
});

const addr = await gateway.listen();
console.log(
  JSON.stringify({
    event: 'fleet-gateway-started',
    listen: `${addr.host}:${addr.port}`,
    identityMode: mode
  })
);

const shutdown = async () => {
  await gateway.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
