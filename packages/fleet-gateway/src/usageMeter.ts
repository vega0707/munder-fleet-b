/**
 * Usage metering — per-user API call counts (P4-P3 enterprise stub).
 */
export class UsageMeter {
  private readonly counts = new Map<string, number>();

  increment(userId: string, delta = 1): number {
    const next = (this.counts.get(userId) ?? 0) + delta;
    this.counts.set(userId, next);
    return next;
  }

  get(userId: string): number {
    return this.counts.get(userId) ?? 0;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts.entries());
  }
}
