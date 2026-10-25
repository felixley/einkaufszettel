import { beforeEach, describe, expect, it } from 'vitest';
import { MockHouseholdStore, MockStoreError } from './mock-store';

const OWNER = '11111111-1111-7111-8111-111111111111';
const EDITOR = '22222222-2222-7222-8222-222222222222';
const VIEWER = '33333333-3333-7333-8333-333333333333';

const HOUSEHOLD = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const LIST = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';

const INVITE = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const TOKEN_HASH = 'f'.repeat(64);

function expectStoreError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('Erwarteter MockStoreError blieb aus.');
  } catch (error) {
    expect(error).toBeInstanceOf(MockStoreError);
    expect((error as MockStoreError).code).toBe(code);
  }
}

describe('MockHouseholdStore', () => {
  let clock: number;
  let store: MockHouseholdStore;

  beforeEach(() => {
    clock = Date.parse('2026-10-25T12:00:00.000Z');
    store = new MockHouseholdStore(() => new Date(clock));
    store.ensureProfile(OWNER, 'owner@example.com');
    store.ensureProfile(EDITOR, 'editor@example.com');
    store.ensureProfile(VIEWER, 'viewer@example.com');
  });

  function createHousehold(): void {
    store.createHousehold(OWNER, '  Testhaushalt  ', {
      householdId: HOUSEHOLD,
      memberId: MEMBER,
      listId: LIST,
    });
  }

  function createInvite(role: 'owner' | 'editor' | 'viewer', maxUses = 1): void {
    store.createInvite(OWNER, {
      inviteId: INVITE,
      householdId: HOUSEHOLD,
      tokenHash: TOKEN_HASH,
      role,
      maxUses,
      expiresAt: new Date(clock + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  it('legt Haushalt, Owner-Mitglied und Standardliste an', () => {
    createHousehold();
    expect(store.getMyHousehold(OWNER)).toEqual({
      id: HOUSEHOLD,
      name: 'Testhaushalt',
      role: 'owner',
    });
    expect(store.getMyHousehold(EDITOR)).toBeNull();
    expect(store.listMembers(OWNER, HOUSEHOLD)).toEqual([
      {
        id: MEMBER,
        userId: OWNER,
        role: 'owner',
        displayName: 'owner',
        createdAt: new Date(clock).toISOString(),
      },
    ]);
  });

  it('ist replay-sicher beim Anlegen (gleiche IDs, keine Duplikate)', () => {
    createHousehold();
    createHousehold();
    expect(store.listMembers(OWNER, HOUSEHOLD)).toHaveLength(1);
  });

  it('laesst nur den Owner Einladungen anlegen', () => {
    createHousehold();
    expectStoreError(
      () =>
        store.createInvite(EDITOR, {
          inviteId: INVITE,
          householdId: HOUSEHOLD,
          tokenHash: TOKEN_HASH,
          role: 'viewer',
          maxUses: 1,
          expiresAt: new Date(clock + 86_400_000).toISOString(),
        }),
      'forbidden',
    );
  });

  it('loest eine Einladung mit der gewaehlten Rolle ein', () => {
    createHousehold();
    createInvite('editor');
    const preview = store.checkInvite(TOKEN_HASH);
    expect(preview).toMatchObject({
      valid: true,
      householdName: 'Testhaushalt',
      role: 'editor',
      remainingUses: 1,
    });

    const accepted = store.acceptInvite(EDITOR, TOKEN_HASH, 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee');
    expect(accepted).toMatchObject({
      householdId: HOUSEHOLD,
      role: 'editor',
      alreadyMember: false,
      restoredMember: false,
    });
    expect(store.getMyHousehold(EDITOR)?.role).toBe('editor');
    expect(store.checkInvite(TOKEN_HASH)).toMatchObject({ valid: false, reason: 'exhausted' });
  });

  it('behandelt Replay fuer bestehende Mitglieder ohne zweiten Verbrauch', () => {
    createHousehold();
    createInvite('viewer');
    store.acceptInvite(EDITOR, TOKEN_HASH, 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee');
    // Zweiter Aufruf mit demselben Token und bereits aktivem Mitglied.
    const replay = store.acceptInvite(EDITOR, TOKEN_HASH, 'ffffffff-ffff-7fff-8fff-ffffffffffff');
    expect(replay).toMatchObject({ alreadyMember: true, role: 'viewer' });
    expect(store.listInvites(OWNER, HOUSEHOLD)[0]?.usedCount).toBe(1);
  });

  it('lehnt abgelaufene, widerrufene und aufgebrauchte Links unterscheidbar ab', () => {
    createHousehold();
    createInvite('viewer');
    clock += 8 * 24 * 60 * 60 * 1000;
    expect(store.checkInvite(TOKEN_HASH)).toMatchObject({ valid: false, reason: 'expired' });
    expectStoreError(() => store.acceptInvite(EDITOR, TOKEN_HASH, 'e'), 'expired');

    clock = Date.parse('2026-10-25T12:00:00.000Z');
    store.reset();
    store.ensureProfile(OWNER, 'owner@example.com');
    createHousehold();
    createInvite('viewer');
    store.revokeInvite(OWNER, INVITE);
    expect(store.checkInvite(TOKEN_HASH)).toMatchObject({ valid: false, reason: 'revoked' });
    expectStoreError(() => store.acceptInvite(EDITOR, TOKEN_HASH, 'e'), 'revoked');
  });

  it('wirkt ein Rollenwechsel sofort auf das Schreibrecht', () => {
    createHousehold();
    createInvite('editor');
    store.acceptInvite(EDITOR, TOKEN_HASH, 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee');

    expect(store.writeProbe(EDITOR, HOUSEHOLD)).toMatchObject({ allowed: true, role: 'editor' });
    store.changeMemberRole(OWNER, HOUSEHOLD, EDITOR, 'viewer');
    expect(store.writeProbe(EDITOR, HOUSEHOLD)).toMatchObject({ allowed: false, role: 'viewer' });
  });

  it('entzieht Zugriff beim Entfernen eines Mitglieds', () => {
    createHousehold();
    createInvite('viewer');
    store.acceptInvite(EDITOR, TOKEN_HASH, 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee');
    store.removeMember(OWNER, HOUSEHOLD, EDITOR);

    expect(store.getMyHousehold(EDITOR)).toBeNull();
    expectStoreError(() => store.writeProbe(EDITOR, HOUSEHOLD), 'forbidden');
    expect(store.listMembers(OWNER, HOUSEHOLD).map((member) => member.userId)).toEqual([OWNER]);
  });

  it('schuetzt den letzten Owner vor Austritt, Entfernen und Herabstufung', () => {
    createHousehold();
    expectStoreError(() => store.leaveHousehold(OWNER, HOUSEHOLD), 'last_owner');
    expectStoreError(() => store.removeMember(OWNER, HOUSEHOLD, OWNER), 'last_owner');
    expectStoreError(() => store.changeMemberRole(OWNER, HOUSEHOLD, OWNER, 'editor'), 'last_owner');
  });

  it('haengt owner_id beim Austritt eines Owners um', () => {
    createHousehold();
    createInvite('owner');
    store.acceptInvite(EDITOR, TOKEN_HASH, 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee');
    store.leaveHousehold(OWNER, HOUSEHOLD);

    expect(store.getMyHousehold(OWNER)).toBeNull();
    expect(store.getMyHousehold(EDITOR)?.role).toBe('owner');
    // Der verbleibende Owner ist jetzt letzter Owner und darf nicht austreten.
    expectStoreError(() => store.leaveHousehold(EDITOR, HOUSEHOLD), 'last_owner');
  });

  it('erlaubt nur Ownern Rollenwechsel und Entfernen', () => {
    createHousehold();
    createInvite('editor');
    store.acceptInvite(EDITOR, TOKEN_HASH, 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee');
    expectStoreError(() => store.changeMemberRole(EDITOR, HOUSEHOLD, OWNER, 'viewer'), 'forbidden');
    expectStoreError(() => store.removeMember(EDITOR, HOUSEHOLD, OWNER), 'forbidden');
  });

  it('prueft Einladungsgrenzen (max_uses, Ablauf in der Zukunft, Tokenlaenge)', () => {
    createHousehold();
    expectStoreError(
      () =>
        store.createInvite(OWNER, {
          inviteId: INVITE,
          householdId: HOUSEHOLD,
          tokenHash: 'kurz',
          role: 'viewer',
          maxUses: 1,
          expiresAt: new Date(clock + 86_400_000).toISOString(),
        }),
      'invalid',
    );
    expectStoreError(
      () =>
        store.createInvite(OWNER, {
          inviteId: INVITE,
          householdId: HOUSEHOLD,
          tokenHash: TOKEN_HASH,
          role: 'viewer',
          maxUses: 1,
          expiresAt: new Date(clock - 1000).toISOString(),
        }),
      'invalid',
    );
    expectStoreError(
      () =>
        store.createInvite(OWNER, {
          inviteId: INVITE,
          householdId: HOUSEHOLD,
          tokenHash: TOKEN_HASH,
          role: 'viewer',
          maxUses: 0,
          expiresAt: new Date(clock + 86_400_000).toISOString(),
        }),
      'invalid',
    );
  });

  it('meldet unbekannte Tokens als not_found', () => {
    createHousehold();
    expect(store.checkInvite('0'.repeat(64))).toEqual({ valid: false, reason: 'not_found' });
  });
});
