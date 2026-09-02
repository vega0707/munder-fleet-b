/**
 * Connector channel registry — MCP + optional IM/docs channels (P4-P2).
 */
import type { ConnectorKind, ConnectorRef } from '@munder/fleet-protocol';

export interface ConnectorChannel extends ConnectorRef {
  registeredAt: string;
}

export class ConnectorRegistry {
  private readonly channels = new Map<string, ConnectorChannel>();

  list(): ConnectorChannel[] {
    return [...this.channels.values()].map((c) => ({ ...c }));
  }

  register(input: Omit<ConnectorRef, 'enabled'> & { enabled?: boolean }): ConnectorChannel {
    const channel: ConnectorChannel = {
      id: input.id,
      name: input.name,
      kind: input.kind,
      enabled: input.enabled ?? true,
      config: input.config ? { ...input.config } : undefined,
      registeredAt: new Date().toISOString()
    };
    this.channels.set(channel.id, channel);
    return { ...channel };
  }

  unregister(id: string): boolean {
    return this.channels.delete(id);
  }

  get(id: string): ConnectorChannel | undefined {
    const c = this.channels.get(id);
    return c ? { ...c } : undefined;
  }

  byKind(kind: ConnectorKind): ConnectorChannel[] {
    return this.list().filter((c) => c.kind === kind && c.enabled);
  }
}
