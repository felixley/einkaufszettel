/**
 * In-Memory-Server fuer den Mock-Modus (Dev/E2E).
 *
 * Spiegelt den Vertrag aus Migration 005 (Rollen, Einladungs-Ablauf, Widerruf,
 * Auslastung, Letzter-Owner-Regel, Owner-Umhaengung, Soft-Delete) und ist
 * bewusst serverseitig, damit zwei Browser-Kontexte denselben Zustand sehen.
 * NICHT fuer Produktion: Zustand lebt nur im Dev-Server-Prozess.
 *
 * Die Autorisierung ist hier nachgebildet (Owner-only fuer Verwaltung,
 * Schreibrecht fuer Owner/Editor). Im echten Stack prueft das PostgreSQL/RLS;
 * die pgTAP-Suite 03 belegt diese Regeln. Dieser Store ist das Testdouble fuer
 * die UI-/E2E-Ebene, kein Ersatz fuer die RLS-Pruefung.
 */

import type {
  AcceptInviteResult,
  HouseholdErrorCode,
  HouseholdInvite,
  HouseholdMember,
  HouseholdRole,
  HouseholdSummary,
  InvitePreview,
  WriteProbeResult,
} from './types';
import { ROLE_LABELS, isHouseholdRole } from './types';

export class MockStoreError extends Error {
  readonly code: HouseholdErrorCode;

  constructor(code: HouseholdErrorCode, message: string) {
    super(message);
    this.name = 'MockStoreError';
    this.code = code;
  }
}

interface StoreProfile {
  id: string;
  email: string;
  displayName: string;
}

interface StoreHousehold {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  deletedAt: string | null;
}

interface StoreMember {
  id: string;
  householdId: string;
  userId: string;
  role: HouseholdRole;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface StoreInvite {
  id: string;
  householdId: string;
  tokenHash: string;
  role: HouseholdRole;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface StoreList {
  id: string;
  householdId: string;
  name: string;
  createdAt: string;
  deletedAt: string | null;
}

interface StoreListItem {
  id: string;
  listId: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

export interface CreateHouseholdIds {
  householdId: string;
  memberId: string;
  listId: string;
}

export interface CreateInviteStoreInput {
  inviteId: string;
  householdId: string;
  tokenHash: string;
  role: HouseholdRole;
  maxUses: number;
  expiresAt: string;
}

const INVITE_MAX_USES_DEFAULT = 1;
const INVITE_TTL_DAYS = 7;

function asDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export class MockHouseholdStore {
  private readonly profiles = new Map<string, StoreProfile>();
  private readonly households = new Map<string, StoreHousehold>();
  private readonly members = new Map<string, StoreMember>();
  private readonly invites = new Map<string, StoreInvite>();
  private readonly lists = new Map<string, StoreList>();
  private readonly listItems: StoreListItem[] = [];
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  /** Nur fuer Tests: kompletter Reset. */
  reset(): void {
    this.profiles.clear();
    this.households.clear();
    this.members.clear();
    this.invites.clear();
    this.lists.clear();
    this.listItems.length = 0;
  }

  ensureProfile(userId: string, email: string): StoreProfile {
    const existing = this.profiles.get(userId);
    if (existing) {
      existing.email = email;
      return existing;
    }
    const localPart = email.split('@')[0]?.trim();
    const profile: StoreProfile = {
      id: userId,
      email,
      displayName: localPart && localPart.length > 0 ? localPart : 'Mitglied',
    };
    this.profiles.set(userId, profile);
    return profile;
  }

  getMyHousehold(userId: string): HouseholdSummary | null {
    const member = [...this.members.values()]
      .filter((row) => row.userId === userId && row.deletedAt === null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!member) return null;
    const household = this.households.get(member.householdId);
    if (!household || household.deletedAt !== null) return null;
    return { id: household.id, name: household.name, role: member.role };
  }

  createHousehold(userId: string, name: string, ids: CreateHouseholdIds): HouseholdSummary {
    const trimmed = name.trim();
    if (!trimmed) throw new MockStoreError('invalid', 'Haushaltsname darf nicht leer sein.');

    const existing = this.households.get(ids.householdId);
    if (existing) {
      if (existing.ownerId !== userId || existing.deletedAt !== null) {
        throw new MockStoreError('forbidden', 'Haushalt nicht gefunden oder keine Berechtigung.');
      }
      const member = this.findMember(existing.id, userId);
      if (!member) throw new MockStoreError('forbidden', 'Owner-Mitgliedschaft fehlt.');
      return { id: existing.id, name: existing.name, role: member.role };
    }

    if (this.members.has(ids.memberId)) {
      throw new MockStoreError('invalid', 'Mitglieds-ID ist bereits vergeben.');
    }

    const at = this.now().toISOString();
    const household: StoreHousehold = {
      id: ids.householdId,
      name: trimmed,
      ownerId: userId,
      createdAt: at,
      deletedAt: null,
    };
    const member: StoreMember = {
      id: ids.memberId,
      householdId: ids.householdId,
      userId,
      role: 'owner',
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    const list: StoreList = {
      id: ids.listId,
      householdId: ids.householdId,
      name: 'Einkaufsliste',
      createdAt: at,
      deletedAt: null,
    };
    this.households.set(household.id, household);
    this.members.set(member.id, member);
    this.lists.set(list.id, list);
    return { id: household.id, name: household.name, role: 'owner' };
  }

  listMembers(requesterId: string, householdId: string): HouseholdMember[] {
    this.requireActiveMember(requesterId, householdId);
    return [...this.members.values()]
      .filter((row) => row.householdId === householdId && row.deletedAt === null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((row) => this.toMember(row));
  }

  listInvites(requesterId: string, householdId: string): HouseholdInvite[] {
    this.requireOwner(requesterId, householdId);
    return [...this.invites.values()]
      .filter((row) => row.householdId === householdId && row.deletedAt === null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((row) => this.toInvite(row));
  }

  createInvite(requesterId: string, input: CreateInviteStoreInput): HouseholdInvite {
    this.requireOwner(requesterId, input.householdId);

    const role = input.role;
    if (!isHouseholdRole(role)) {
      throw new MockStoreError('invalid', 'Unbekannte Rolle.');
    }
    if (!Number.isInteger(input.maxUses) || input.maxUses < 1) {
      throw new MockStoreError('invalid', 'max_uses muss mindestens 1 sein.');
    }
    const expires = asDate(input.expiresAt);
    if (!expires || expires.getTime() <= this.now().getTime()) {
      throw new MockStoreError('invalid', 'expires_at muss in der Zukunft liegen.');
    }
    if (input.tokenHash.length < 32) {
      throw new MockStoreError('invalid', 'token_hash muss mindestens 32 Zeichen haben.');
    }

    const existing = this.invites.get(input.inviteId);
    if (existing) {
      if (existing.householdId !== input.householdId || existing.deletedAt !== null) {
        throw new MockStoreError('forbidden', 'Einladung konnte nicht angelegt werden.');
      }
      return this.toInvite(existing);
    }

    const tokenTaken = [...this.invites.values()].some(
      (row) => row.tokenHash === input.tokenHash && row.deletedAt === null,
    );
    if (tokenTaken) {
      throw new MockStoreError('invalid', 'Dieser Einladungstoken ist bereits vergeben.');
    }

    const at = this.now().toISOString();
    const invite: StoreInvite = {
      id: input.inviteId,
      householdId: input.householdId,
      tokenHash: input.tokenHash,
      role,
      expiresAt: expires.toISOString(),
      maxUses: input.maxUses,
      usedCount: 0,
      revokedAt: null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    this.invites.set(invite.id, invite);
    return this.toInvite(invite);
  }

  revokeInvite(requesterId: string, inviteId: string): void {
    const invite = this.invites.get(inviteId);
    if (!invite || invite.deletedAt !== null) {
      throw new MockStoreError('not_found', 'Einladung nicht gefunden.');
    }
    this.requireOwner(requesterId, invite.householdId);
    invite.revokedAt ??= this.now().toISOString();
    invite.updatedAt = this.now().toISOString();
  }

  checkInvite(tokenHash: string): InvitePreview {
    const invite = [...this.invites.values()].find(
      (row) => row.tokenHash === tokenHash && row.deletedAt === null,
    );
    if (!invite) return { valid: false, reason: 'not_found' };
    if (invite.revokedAt !== null) {
      return { valid: false, reason: 'revoked', householdId: invite.householdId };
    }
    if (asDate(invite.expiresAt)!.getTime() <= this.now().getTime()) {
      return { valid: false, reason: 'expired', householdId: invite.householdId };
    }
    if (invite.usedCount >= invite.maxUses) {
      return { valid: false, reason: 'exhausted', householdId: invite.householdId };
    }
    const household = this.households.get(invite.householdId);
    if (!household || household.deletedAt !== null) {
      return { valid: false, reason: 'not_found' };
    }
    return {
      valid: true,
      householdId: household.id,
      householdName: household.name,
      role: invite.role,
      expiresAt: invite.expiresAt,
      remainingUses: invite.maxUses - invite.usedCount,
    };
  }

  acceptInvite(userId: string, tokenHash: string, memberId: string): AcceptInviteResult {
    const invite = [...this.invites.values()].find(
      (row) => row.tokenHash === tokenHash && row.deletedAt === null,
    );
    if (!invite) throw new MockStoreError('not_found', 'Einladung nicht gefunden.');
    if (invite.revokedAt !== null) {
      throw new MockStoreError('revoked', 'Einladung wurde widerrufen.');
    }
    if (asDate(invite.expiresAt)!.getTime() <= this.now().getTime()) {
      throw new MockStoreError('expired', 'Einladung ist abgelaufen.');
    }
    const household = this.households.get(invite.householdId);
    if (!household || household.deletedAt !== null) {
      throw new MockStoreError('not_found', 'Einladung nicht gefunden.');
    }

    // Bereits aktives Mitglied: idempotenter Erfolg ohne zweiten Verbrauch.
    const active = this.findMember(invite.householdId, userId);
    if (active) {
      return {
        householdId: household.id,
        householdName: household.name,
        role: active.role,
        alreadyMember: true,
        restoredMember: false,
      };
    }

    if (invite.usedCount >= invite.maxUses) {
      throw new MockStoreError('exhausted', 'Einladung ist aufgebraucht.');
    }

    const byId = this.members.get(memberId);
    if (byId && byId.userId !== userId) {
      throw new MockStoreError('invalid', 'Mitglieds-ID ist bereits vergeben.');
    }

    const previous = [...this.members.values()]
      .filter((row) => row.householdId === invite.householdId && row.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

    const at = this.now().toISOString();
    let restoredMember = false;
    let previousRole: HouseholdRole | null = null;

    if (previous && previous.deletedAt !== null) {
      previousRole = previous.role;
      previous.deletedAt = null;
      previous.role = invite.role;
      previous.updatedAt = at;
      restoredMember = true;
    } else if (!previous) {
      const member: StoreMember = {
        id: memberId,
        householdId: invite.householdId,
        userId,
        role: invite.role,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      this.members.set(member.id, member);
    } else {
      throw new MockStoreError('invalid', 'Mitgliedschaft konnte nicht angelegt werden.');
    }

    invite.usedCount += 1;
    invite.updatedAt = at;

    const result: AcceptInviteResult = {
      householdId: household.id,
      householdName: household.name,
      role: invite.role,
      alreadyMember: false,
      restoredMember,
    };
    if (previousRole !== null) result.previousRole = previousRole;
    return result;
  }

  changeMemberRole(
    requesterId: string,
    householdId: string,
    targetUserId: string,
    newRole: HouseholdRole,
  ): HouseholdMember {
    this.requireOwner(requesterId, householdId);
    if (!isHouseholdRole(newRole)) throw new MockStoreError('invalid', 'Unbekannte Rolle.');
    const member = this.findMember(householdId, targetUserId);
    if (!member) throw new MockStoreError('not_found', 'Mitglied nicht gefunden.');

    if (member.role === 'owner' && newRole !== 'owner') {
      if (this.activeOwnerCount(householdId) <= 1) {
        throw new MockStoreError('last_owner', 'Der letzte Owner kann nicht herabgestuft werden.');
      }
      this.reassignOwner(householdId, targetUserId);
    }

    member.role = newRole;
    member.updatedAt = this.now().toISOString();
    return this.toMember(member);
  }

  removeMember(requesterId: string, householdId: string, targetUserId: string): void {
    this.requireOwner(requesterId, householdId);
    if (targetUserId === requesterId) {
      this.leaveHousehold(requesterId, householdId);
      return;
    }
    const member = this.findMember(householdId, targetUserId);
    if (!member) throw new MockStoreError('not_found', 'Mitglied nicht gefunden.');
    if (member.role === 'owner' && this.activeOwnerCount(householdId) <= 1) {
      throw new MockStoreError('last_owner', 'Der letzte Owner kann nicht entfernt werden.');
    }
    if (member.role === 'owner') this.reassignOwner(householdId, targetUserId);
    member.deletedAt = this.now().toISOString();
    member.updatedAt = member.deletedAt;
  }

  leaveHousehold(userId: string, householdId: string): void {
    const member = this.findMember(householdId, userId);
    if (!member) {
      throw new MockStoreError('not_found', 'Keine aktive Mitgliedschaft in diesem Haushalt.');
    }
    if (member.role === 'owner' && this.activeOwnerCount(householdId) <= 1) {
      throw new MockStoreError('last_owner', 'Der letzte Owner kann den Haushalt nicht verlassen.');
    }
    if (member.role === 'owner') this.reassignOwner(householdId, userId);
    member.deletedAt = this.now().toISOString();
    member.updatedAt = member.deletedAt;
  }

  writeProbe(userId: string, householdId: string): WriteProbeResult {
    const member = this.findMember(householdId, userId);
    if (!member) throw new MockStoreError('forbidden', 'Kein Zugriff auf diesen Haushalt.');
    const allowed = member.role === 'owner' || member.role === 'editor';
    if (!allowed) {
      return {
        allowed: false,
        role: member.role,
        message: `Schreiben verweigert – ${ROLE_LABELS[member.role]} hat nur Leserechte.`,
      };
    }
    const list = [...this.lists.values()].find(
      (row) => row.householdId === householdId && row.deletedAt === null,
    );
    if (!list) throw new MockStoreError('not_found', 'Keine aktive Liste im Haushalt.');
    this.listItems.push({
      id: `item-${this.listItems.length + 1}`,
      listId: list.id,
      name: `Testartikel ${this.now().toISOString()}`,
      createdBy: userId,
      createdAt: this.now().toISOString(),
    });
    return {
      allowed: true,
      role: member.role,
      message: `Testartikel angelegt – ${ROLE_LABELS[member.role]} darf schreiben.`,
    };
  }

  /** Nur Mock/E2E: zwingt eine Einladung in die Vergangenheit (Ablauf-Test). */
  debugExpireInvite(tokenHash: string): void {
    const invite = [...this.invites.values()].find(
      (row) => row.tokenHash === tokenHash && row.deletedAt === null,
    );
    if (!invite) throw new MockStoreError('not_found', 'Einladung nicht gefunden.');
    invite.expiresAt = new Date(this.now().getTime() - 1000).toISOString();
    invite.updatedAt = this.now().toISOString();
  }

  private requireActiveMember(userId: string, householdId: string): StoreMember {
    const member = this.findMember(householdId, userId);
    if (!member) throw new MockStoreError('forbidden', 'Kein Zugriff auf diesen Haushalt.');
    const household = this.households.get(householdId);
    if (!household || household.deletedAt !== null) {
      throw new MockStoreError('not_found', 'Haushalt nicht gefunden.');
    }
    return member;
  }

  private requireOwner(userId: string, householdId: string): StoreMember {
    const member = this.requireActiveMember(userId, householdId);
    if (member.role !== 'owner') {
      throw new MockStoreError('forbidden', 'Nur Owner duerfen Mitglieder verwalten.');
    }
    return member;
  }

  private findMember(householdId: string, userId: string): StoreMember | null {
    return (
      [...this.members.values()].find(
        (row) => row.householdId === householdId && row.userId === userId && row.deletedAt === null,
      ) ?? null
    );
  }

  private activeOwnerCount(householdId: string): number {
    return [...this.members.values()].filter(
      (row) => row.householdId === householdId && row.role === 'owner' && row.deletedAt === null,
    ).length;
  }

  private reassignOwner(householdId: string, leavingUserId: string): void {
    const household = this.households.get(householdId);
    if (!household || household.ownerId !== leavingUserId) return;
    const next = [...this.members.values()]
      .filter(
        (row) =>
          row.householdId === householdId &&
          row.role === 'owner' &&
          row.deletedAt === null &&
          row.userId !== leavingUserId,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
    if (!next) {
      throw new MockStoreError('last_owner', 'Haushalt haette danach keinen Owner mehr.');
    }
    household.ownerId = next.userId;
  }

  private toMember(row: StoreMember): HouseholdMember {
    const profile = this.profiles.get(row.userId);
    return {
      id: row.id,
      userId: row.userId,
      role: row.role,
      displayName: profile?.displayName ?? 'Mitglied',
      createdAt: row.createdAt,
    };
  }

  private toInvite(row: StoreInvite): HouseholdInvite {
    return {
      id: row.id,
      householdId: row.householdId,
      role: row.role,
      expiresAt: row.expiresAt,
      maxUses: row.maxUses,
      usedCount: row.usedCount,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    };
  }
}

export const DEFAULT_INVITE_MAX_USES = INVITE_MAX_USES_DEFAULT;
export const DEFAULT_INVITE_TTL_DAYS = INVITE_TTL_DAYS;
