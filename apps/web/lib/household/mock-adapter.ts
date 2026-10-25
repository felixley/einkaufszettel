import { uuidv7 } from './id';
import type {
  AcceptInviteResult,
  CreateInviteInput,
  HouseholdAdapter,
  HouseholdInvite,
  HouseholdMember,
  HouseholdResult,
  HouseholdRole,
  HouseholdSummary,
  InvitePreview,
  WriteProbeResult,
} from './types';
import { householdFail, householdOk } from './types';

interface MockErrorShape {
  code?: unknown;
  message?: unknown;
}

interface MockResponseShape {
  ok?: unknown;
  data?: unknown;
  error?: MockErrorShape;
}

const VALID_CODES = new Set([
  'unauthenticated',
  'forbidden',
  'not_found',
  'expired',
  'revoked',
  'exhausted',
  'last_owner',
  'invalid',
  'network',
  'unknown',
]);

function normalizeError(error: MockErrorShape | undefined): HouseholdResult<never> {
  const rawCode = typeof error?.code === 'string' ? error.code : 'unknown';
  const code = VALID_CODES.has(rawCode)
    ? (rawCode as
        | 'unauthenticated'
        | 'forbidden'
        | 'not_found'
        | 'expired'
        | 'revoked'
        | 'exhausted'
        | 'last_owner'
        | 'invalid'
        | 'network'
        | 'unknown')
    : 'unknown';
  const message =
    typeof error?.message === 'string' && error.message.length > 0
      ? error.message
      : 'Unbekannter Haushaltsfehler.';
  return householdFail(code, message);
}

async function call<T>(body: Record<string, unknown>): Promise<HouseholdResult<T>> {
  let response: Response;
  try {
    response = await fetch('/api/mock/household', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'include',
    });
  } catch {
    return householdFail('network', 'Server nicht erreichbar. Bitte Verbindung pruefen.');
  }

  if (response.status === 401) {
    return householdFail('unauthenticated', 'Nicht angemeldet.');
  }

  let parsed: MockResponseShape;
  try {
    parsed = (await response.json()) as MockResponseShape;
  } catch {
    return householdFail('network', 'Antwort des Servers war nicht lesbar.');
  }

  if (parsed.ok !== true) return normalizeError(parsed.error);
  return householdOk(parsed.data as T);
}

/**
 * Mock-Adapter fuer Dev/E2E: der Zustand liegt im Dev-Server-Prozess (siehe
 * app/api/mock/household/route.ts). Zwei Browser-Kontexte sehen denselben
 * Haushalt, weil der Server die Identitaet aus dem Mock-Session-Cookie liest.
 */
export class MockHouseholdAdapter implements HouseholdAdapter {
  readonly mode = 'mock' as const;
  private pendingHouseholdIds: { householdId: string; memberId: string; listId: string } | null =
    null;

  async getMyHousehold(): Promise<HouseholdResult<HouseholdSummary | null>> {
    return call<HouseholdSummary | null>({ action: 'me' });
  }

  async createHousehold(name: string): Promise<HouseholdResult<HouseholdSummary>> {
    const ids = (this.pendingHouseholdIds ??= {
      householdId: uuidv7(),
      memberId: uuidv7(),
      listId: uuidv7(),
    });
    const result = await call<HouseholdSummary>({
      action: 'create',
      name,
      householdId: ids.householdId,
      memberId: ids.memberId,
      listId: ids.listId,
    });
    if (result.ok) this.pendingHouseholdIds = null;
    return result;
  }

  async listMembers(householdId: string): Promise<HouseholdResult<HouseholdMember[]>> {
    return call<HouseholdMember[]>({ action: 'members', householdId });
  }

  async listInvites(householdId: string): Promise<HouseholdResult<HouseholdInvite[]>> {
    return call<HouseholdInvite[]>({ action: 'invites', householdId });
  }

  async createInvite(input: CreateInviteInput): Promise<HouseholdResult<HouseholdInvite>> {
    return call<HouseholdInvite>({
      action: 'invite',
      inviteId: input.inviteId,
      householdId: input.householdId,
      tokenHash: input.tokenHash,
      role: input.role,
      maxUses: input.maxUses,
      expiresAt: input.expiresAt,
    });
  }

  async revokeInvite(inviteId: string): Promise<HouseholdResult<void>> {
    return call<void>({ action: 'revoke', inviteId });
  }

  async checkInvite(tokenHash: string): Promise<HouseholdResult<InvitePreview>> {
    return call<InvitePreview>({ action: 'check', tokenHash });
  }

  async acceptInvite(
    tokenHash: string,
    memberId: string,
  ): Promise<HouseholdResult<AcceptInviteResult>> {
    return call<AcceptInviteResult>({ action: 'accept', tokenHash, memberId });
  }

  async changeMemberRole(
    householdId: string,
    userId: string,
    role: HouseholdRole,
  ): Promise<HouseholdResult<HouseholdMember>> {
    return call<HouseholdMember>({ action: 'role', householdId, userId, role });
  }

  async removeMember(householdId: string, userId: string): Promise<HouseholdResult<void>> {
    return call<void>({ action: 'remove', householdId, userId });
  }

  async leaveHousehold(householdId: string): Promise<HouseholdResult<void>> {
    return call<void>({ action: 'leave', householdId });
  }

  async writeProbe(householdId: string): Promise<HouseholdResult<WriteProbeResult>> {
    return call<WriteProbeResult>({ action: 'write-probe', householdId });
  }

  /** Nur E2E: erzwingt den Ablauf einer Einladung (Zeitreise im Mock). */
  async debugExpireInvite(tokenHash: string): Promise<HouseholdResult<void>> {
    return call<void>({ action: 'debug-expire', tokenHash });
  }
}
