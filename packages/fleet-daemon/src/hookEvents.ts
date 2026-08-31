/**
 * Hook event validation — from munder-difflin shared/hookEvents.ts (Electron-free).
 */
export interface HookEvent {
  agentId?: string;
  event: string;
  tool?: string;
  notificationType?: string;
  source?: string;
  message?: string;
  blocked?: boolean;
  projectId?: string;
}

const OPTIONAL_STRING_FIELDS = ['tool', 'notificationType', 'source', 'message'] as const;

export function validateHookEvent(value: unknown): value is HookEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.event !== 'string' || candidate.event.length === 0) return false;
  if (
    candidate.agentId !== undefined &&
    (typeof candidate.agentId !== 'string' || candidate.agentId.length === 0)
  ) {
    return false;
  }
  for (const field of OPTIONAL_STRING_FIELDS) {
    if (candidate[field] !== undefined && typeof candidate[field] !== 'string') return false;
  }
  if (
    candidate.projectId !== undefined &&
    (typeof candidate.projectId !== 'string' || candidate.projectId.length === 0)
  ) {
    return false;
  }
  return candidate.blocked === undefined || typeof candidate.blocked === 'boolean';
}
