/**
 * Parse provider CLI rate-limit / quota signals — per-plan passive cooldown.
 */
export interface RateLimitSignal {
  cooldownMs: number;
  detail: string;
}

const PATTERNS: Array<{ re: RegExp; ms: (m: RegExpMatchArray) => number }> = [
  {
    re: /try again in (\d+)\s*hours?/i,
    ms: (m) => Number(m[1]) * 3_600_000
  },
  {
    re: /try again in (\d+)\s*minutes?/i,
    ms: (m) => Number(m[1]) * 60_000
  },
  {
    re: /try again in (\d+)\s*seconds?/i,
    ms: (m) => Number(m[1]) * 1_000
  },
  {
    re: /retry[- ]after[:\s]+(\d+)/i,
    ms: (m) => Number(m[1]) * 1_000
  },
  {
    re: /rate limit|quota exceeded|usage limit|too many requests|429/i,
    ms: () => 0
  }
];

/** Returns cooldown duration; 0 ms means "unknown duration" → caller picks plan-specific fallback. */
export function parseRateLimitSignal(text: string): RateLimitSignal | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  for (const { re, ms } of PATTERNS) {
    const m = normalized.match(re);
    if (m) {
      return { cooldownMs: ms(m), detail: m[0] };
    }
  }
  return null;
}
