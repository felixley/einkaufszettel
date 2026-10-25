import { NextResponse, type NextRequest } from 'next/server';
import { isMockAuth } from '@/lib/auth/mode';
import { decodeMockSession, MOCK_SESSION_COOKIE } from '@/lib/auth/session';
import { MockHouseholdStore, MockStoreError } from '@/lib/household/mock-store';
import type { HouseholdRole } from '@/lib/household/types';
import { isHouseholdRole } from '@/lib/household/types';
import { uuidv7 } from '@/lib/household/id';

export const dynamic = 'force-dynamic';

type GlobalWithStore = typeof globalThis & {
  __ezMockHouseholdStore?: MockHouseholdStore;
};

const globalStore = globalThis as GlobalWithStore;
const store = (globalStore.__ezMockHouseholdStore ??= new MockHouseholdStore());

type Body = Record<string, unknown>;

function readString(body: Body, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(body: Body, key: string, fallback: number): number {
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function ok(data: unknown): NextResponse {
  return NextResponse.json({ ok: true, data });
}

function fail(code: string, message: string, status = 200): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

function asBody(value: unknown): Body {
  return typeof value === 'object' && value !== null ? (value as Body) : {};
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isMockAuth()) {
    return fail('not_found', 'Mock-Haushalts-API ist nur im Mock-Modus aktiv.', 404);
  }

  const session = decodeMockSession(request.cookies.get(MOCK_SESSION_COOKIE)?.value);
  if (!session) {
    return fail('unauthenticated', 'Nicht angemeldet.', 401);
  }
  store.ensureProfile(session.sub, session.email);

  const raw: unknown = await request.json().catch(() => null);
  const body = asBody(raw);
  const action = readString(body, 'action');

  try {
    switch (action) {
      case 'me': {
        return ok(store.getMyHousehold(session.sub));
      }
      case 'create': {
        const name = readString(body, 'name');
        if (!name) return fail('invalid', 'Haushaltsname fehlt.');
        const summary = store.createHousehold(session.sub, name, {
          householdId: readString(body, 'householdId') ?? uuidv7(),
          memberId: readString(body, 'memberId') ?? uuidv7(),
          listId: readString(body, 'listId') ?? uuidv7(),
        });
        return ok(summary);
      }
      case 'members': {
        const householdId = readString(body, 'householdId');
        if (!householdId) return fail('invalid', 'householdId fehlt.');
        return ok(store.listMembers(session.sub, householdId));
      }
      case 'invites': {
        const householdId = readString(body, 'householdId');
        if (!householdId) return fail('invalid', 'householdId fehlt.');
        return ok(store.listInvites(session.sub, householdId));
      }
      case 'invite': {
        const householdId = readString(body, 'householdId');
        const tokenHash = readString(body, 'tokenHash');
        const role = body.role;
        const inviteId = readString(body, 'inviteId') ?? uuidv7();
        const expiresAt = readString(body, 'expiresAt');
        if (!householdId || !tokenHash || !expiresAt) {
          return fail('invalid', 'Einladungsdaten unvollstaendig.');
        }
        if (!isHouseholdRole(role)) return fail('invalid', 'Unbekannte Rolle.');
        const invite = store.createInvite(session.sub, {
          inviteId,
          householdId,
          tokenHash,
          role: role as HouseholdRole,
          maxUses: readNumber(body, 'maxUses', 1),
          expiresAt,
        });
        return ok(invite);
      }
      case 'revoke': {
        const inviteId = readString(body, 'inviteId');
        if (!inviteId) return fail('invalid', 'inviteId fehlt.');
        store.revokeInvite(session.sub, inviteId);
        return ok(null);
      }
      case 'check': {
        const tokenHash = readString(body, 'tokenHash');
        if (!tokenHash) return fail('invalid', 'tokenHash fehlt.');
        return ok(store.checkInvite(tokenHash));
      }
      case 'accept': {
        const tokenHash = readString(body, 'tokenHash');
        const memberId = readString(body, 'memberId') ?? uuidv7();
        if (!tokenHash) return fail('invalid', 'tokenHash fehlt.');
        return ok(store.acceptInvite(session.sub, tokenHash, memberId));
      }
      case 'role': {
        const householdId = readString(body, 'householdId');
        const userId = readString(body, 'userId');
        const role = body.role;
        if (!householdId || !userId) return fail('invalid', 'Mitgliedsdaten unvollstaendig.');
        if (!isHouseholdRole(role)) return fail('invalid', 'Unbekannte Rolle.');
        return ok(store.changeMemberRole(session.sub, householdId, userId, role as HouseholdRole));
      }
      case 'remove': {
        const householdId = readString(body, 'householdId');
        const userId = readString(body, 'userId');
        if (!householdId || !userId) return fail('invalid', 'Mitgliedsdaten unvollstaendig.');
        store.removeMember(session.sub, householdId, userId);
        return ok(null);
      }
      case 'leave': {
        const householdId = readString(body, 'householdId');
        if (!householdId) return fail('invalid', 'householdId fehlt.');
        store.leaveHousehold(session.sub, householdId);
        return ok(null);
      }
      case 'write-probe': {
        const householdId = readString(body, 'householdId');
        if (!householdId) return fail('invalid', 'householdId fehlt.');
        return ok(store.writeProbe(session.sub, householdId));
      }
      case 'debug-expire': {
        const tokenHash = readString(body, 'tokenHash');
        if (!tokenHash) return fail('invalid', 'tokenHash fehlt.');
        store.debugExpireInvite(tokenHash);
        return ok(null);
      }
      default:
        return fail('invalid', 'Unbekannte Aktion.', 400);
    }
  } catch (error) {
    if (error instanceof MockStoreError) return fail(error.code, error.message);
    return fail('unknown', 'Unerwarteter Mock-Fehler.');
  }
}
