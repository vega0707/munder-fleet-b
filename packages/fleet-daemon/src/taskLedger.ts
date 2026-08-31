/**
 * Task ledger merge — from munder-difflin shared/taskLedger.ts.
 * Assignees and unknown fields survive partial writes.
 */
type RawTask = Record<string, unknown>;

function isRawTask(value: unknown): value is RawTask {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function idOf(value: unknown): string | null {
  if (!isRawTask(value)) return null;
  return typeof value.id === 'string' && value.id ? value.id : null;
}

export function mergeTaskLedger(existing: unknown, incoming: unknown): unknown[] {
  const incomingList = Array.isArray(incoming) ? incoming : [];
  const existingList = Array.isArray(existing) ? existing : [];
  const byId = new Map<string, RawTask>();
  for (const entry of existingList) {
    const id = idOf(entry);
    if (id && !byId.has(id)) byId.set(id, entry as RawTask);
  }
  return incomingList.map((entry) => {
    const id = idOf(entry);
    if (!id) return entry;
    const prior = byId.get(id);
    return prior ? { ...prior, ...(entry as RawTask) } : entry;
  });
}

export function patchTaskInLedger(
  rawTasks: unknown,
  id: string,
  patch: Record<string, unknown>
): unknown[] {
  const list = Array.isArray(rawTasks) ? rawTasks : [];
  return list.map((entry) => (idOf(entry) === id ? { ...(entry as RawTask), ...patch } : entry));
}
