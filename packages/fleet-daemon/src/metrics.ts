/**
 * Lightweight observability — counters + recent events for P3.
 */
export type MetricEvent = {
  ts: number;
  kind: string;
  detail?: Record<string, unknown>;
};

export class FleetMetrics {
  private counters = new Map<string, number>();
  private events: MetricEvent[] = [];
  private readonly maxEvents: number;

  constructor(maxEvents = 200) {
    this.maxEvents = maxEvents;
  }

  incr(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  event(kind: string, detail?: Record<string, unknown>): void {
    this.events.push({ ts: Date.now(), kind, detail });
    if (this.events.length > this.maxEvents) this.events.shift();
    this.incr(`event.${kind}`);
  }

  snapshot(): { counters: Record<string, number>; events: MetricEvent[] } {
    return {
      counters: Object.fromEntries(this.counters),
      events: [...this.events]
    };
  }
}
