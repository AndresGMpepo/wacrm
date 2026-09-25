export const AGENT_ALLOWED_PATHS = [
  '/inbox',
  '/notifications',
  '/call-tasks',
  '/contacts',
  '/pipelines',
  '/appointments',
] as const;

export type AccountRole = 'owner' | 'admin' | 'agent' | 'viewer';
export type AssignmentMode = 'round_robin' | 'least_open';

export function isAgentAllowedRoute(pathname: string): boolean {
  return AGENT_ALLOWED_PATHS.some((path) => pathname === path || pathname.startsWith(path));
}

export function canSeeAgentScopedConversation(
  role: AccountRole | null | undefined,
  assignedAgentId: string | null | undefined,
  currentUserId: string | null | undefined,
): boolean {
  if (!role || role !== 'agent') return true;
  if (!assignedAgentId) return true;
  return currentUserId ? assignedAgentId === currentUserId : false;
}

export function canReceiveIncomingNotification(
  role: AccountRole | null | undefined,
  assignedAgentId: string | null | undefined,
  currentUserId: string | null | undefined,
): boolean {
  if (!role || role !== 'agent') return true;
  return !assignedAgentId || (currentUserId ? assignedAgentId === currentUserId : false);
}

export function selectNextAgent<T extends { userId: string } | string>({
  candidates,
  lastAssignedAgentId,
  mode,
}: {
  candidates: T[];
  lastAssignedAgentId?: string | null;
  mode: AssignmentMode;
}): string | null {
  const normalized = candidates.map((candidate) =>
    typeof candidate === 'string' ? { userId: candidate } : candidate,
  );

  if (!normalized.length) return null;

  if (mode === 'least_open') {
    const sorted = [...normalized].sort((a, b) => {
      const aOpen = 'openCount' in a ? Number(a.openCount ?? 0) : 0;
      const bOpen = 'openCount' in b ? Number(b.openCount ?? 0) : 0;
      if (aOpen !== bOpen) return aOpen - bOpen;
      return a.userId.localeCompare(b.userId);
    });
    return sorted[0]?.userId ?? null;
  }

  if (lastAssignedAgentId) {
    const start = normalized.findIndex((candidate) => candidate.userId === lastAssignedAgentId);
    if (start >= 0) {
      return normalized[(start + 1) % normalized.length]?.userId ?? null;
    }
  }

  return normalized[0]?.userId ?? null;
}
