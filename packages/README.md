# Shared packages + shells

| Package | Role |
|---------|------|
| `@munder/fleet-protocol` | Wire types + constants |
| `@munder/fleet-daemon` | Headless hive/pty/hooks/decision/runtime/claim |
| `@munder/fleet-gateway` | Auth gateway (Local / userSession + CSRF) |
| `@munder/shell-web` | Authenticated Web shell → gateway |
| `@munder/shell-electron` | Electron Local client → same gateway |

Run from repo root: `npm install && npm test`.

Upstream delta: [`docs/COMPARISON.md`](../docs/COMPARISON.md).
