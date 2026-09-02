/**
 * Enterprise audit log — modular stub for SSO/audit borrow from Aion (P4-P3).
 */
export interface AuditEvent {
  id: string;
  at: string;
  userId: string;
  action: string;
  detail?: string;
}

export class AuditLog {
  private readonly events: AuditEvent[] = [];
  private seq = 0;

  record(userId: string, action: string, detail?: string): AuditEvent {
    const event: AuditEvent = {
      id: `aud_${++this.seq}`,
      at: new Date().toISOString(),
      userId,
      action,
      detail
    };
    this.events.push(event);
    return { ...event };
  }

  list(limit = 100): AuditEvent[] {
    return this.events.slice(-limit).map((e) => ({ ...e }));
  }
}
