#!/usr/bin/env node
/**
 * Minimal authenticated Web shell — talks to fleet-gateway (userSession).
 * Serves a single-page login + /api/me proxy awareness.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATEWAY = process.env.FLEET_GATEWAY_URL ?? 'http://127.0.0.1:25808';
const PORT = Number(process.env.PORT ?? 5173);

const html = readFileSync(join(__dirname, 'public', 'index.html'), 'utf8');

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html.replaceAll('__GATEWAY__', GATEWAY));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/config.json') {
    const body = JSON.stringify({ gatewayUrl: GATEWAY, identityMode: 'userSession' });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
    return;
  }
  res.writeHead(404).end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'shell-web-started', listen: `127.0.0.1:${PORT}`, gateway: GATEWAY }));
});
