import { describe, expect, it } from 'vitest';

import {
  AGENT_ALLOWED_PATHS,
  canReceiveIncomingNotification,
  canSeeAgentScopedConversation,
  isAgentAllowedRoute,
  selectNextAgent,
  type AssignmentMode,
} from './business-rules';

describe('agent route access', () => {
  it('allows only the operational subset for agents', () => {
    expect(isAgentAllowedRoute('/inbox')).toBe(true);
    expect(isAgentAllowedRoute('/notifications')).toBe(true);
    expect(isAgentAllowedRoute('/contacts')).toBe(true);
    expect(isAgentAllowedRoute('/reports')).toBe(false);
    expect(isAgentAllowedRoute('/broadcasts')).toBe(false);
    expect(AGENT_ALLOWED_PATHS.includes('/appointments')).toBe(true);
  });
});

describe('agent-scoped visibility', () => {
  it('only grants assigned or unassigned conversations to agents', () => {
    expect(canSeeAgentScopedConversation('agent', null, 'user-1')).toBe(true);
    expect(canSeeAgentScopedConversation('agent', 'user-1', 'user-1')).toBe(true);
    expect(canSeeAgentScopedConversation('agent', 'user-2', 'user-1')).toBe(false);
    expect(canSeeAgentScopedConversation('owner', 'user-2', 'user-1')).toBe(true);
  });

  it('matches notification scope for incoming messages', () => {
    expect(canReceiveIncomingNotification('agent', null, 'user-1')).toBe(true);
    expect(canReceiveIncomingNotification('agent', 'user-1', 'user-1')).toBe(true);
    expect(canReceiveIncomingNotification('agent', 'user-2', 'user-1')).toBe(false);
    expect(canReceiveIncomingNotification('admin', 'user-2', 'user-1')).toBe(true);
  });
});

describe('assignment stickiness and fallback', () => {
  it('round-robins to the next available agent after the last assignee', () => {
    const picked = selectNextAgent({
      candidates: ['user-1', 'user-2', 'user-3'],
      lastAssignedAgentId: 'user-2',
      mode: 'round_robin',
    });

    expect(picked).toBe('user-3');
  });

  it('falls back to the first online candidate when the previous assignee is unavailable', () => {
    const picked = selectNextAgent({
      candidates: ['user-1', 'user-2', 'user-3'],
      lastAssignedAgentId: 'user-9',
      mode: 'round_robin',
    });

    expect(picked).toBe('user-1');
  });

  it('prefers the least-open agent in least_open mode', () => {
    const picked = selectNextAgent({
      candidates: [
        { userId: 'user-1', openCount: 2 },
        { userId: 'user-2', openCount: 1 },
        { userId: 'user-3', openCount: 1 },
      ],
      lastAssignedAgentId: 'user-1',
      mode: 'least_open',
    });

    expect(picked).toBe('user-2');
  });

  it('supports the explicit fallback type for the mode union', () => {
    const mode: AssignmentMode = 'least_open';
    expect(mode).toBe('least_open');
  });
});
