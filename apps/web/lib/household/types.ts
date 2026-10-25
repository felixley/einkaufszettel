/**
 * Gemeinsame Typen fuer Einladungen (T2.3) und Mitgliederverwaltung (T2.4).
 *
 * Die Rollen entsprechen exakt dem PostgreSQL-Enum `public.household_role`.
 * Alle Fehler werden als Ergebnisobjekt zurueckgegeben (kein Throw in der UI),
 * damit Komponenten jeden Fall explizit behandeln koennen.
 */

export type HouseholdRole = 'owner' | 'editor' | 'viewer';

export const HOUSEHOLD_ROLES = ['owner', 'editor', 'viewer'] as const;

export function isHouseholdRole(value: unknown): value is HouseholdRole {
  return typeof value === 'string' && (HOUSEHOLD_ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<HouseholdRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<HouseholdRole, string> = {
  owner: 'Vollzugriff, verwaltet Mitglieder und Einladungen.',
  editor: 'Darf Listen und Artikel bearbeiten.',
  viewer: 'Nur lesen, keine Aenderungen.',
};

export interface HouseholdSummary {
  id: string;
  name: string;
  role: HouseholdRole;
}

export interface HouseholdMember {
  id: string;
  userId: string;
  role: HouseholdRole;
  displayName: string;
  createdAt: string;
}

export interface HouseholdInvite {
  id: string;
  householdId: string;
  role: HouseholdRole;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  revokedAt: string | null;
  createdAt: string;
}

export type InviteInvalidReason = 'not_found' | 'expired' | 'revoked' | 'exhausted';

export interface InvitePreview {
  valid: boolean;
  reason?: InviteInvalidReason;
  householdId?: string;
  householdName?: string;
  role?: HouseholdRole;
  expiresAt?: string;
  remainingUses?: number;
}

export interface AcceptInviteResult {
  householdId: string;
  householdName: string;
  role: HouseholdRole;
  alreadyMember: boolean;
  restoredMember: boolean;
  previousRole?: HouseholdRole | null;
}

export type HouseholdErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'expired'
  | 'revoked'
  | 'exhausted'
  | 'last_owner'
  | 'invalid'
  | 'network'
  | 'unknown';

export interface HouseholdError {
  code: HouseholdErrorCode;
  message: string;
}

export type HouseholdResult<T> = { ok: true; data: T } | { ok: false; error: HouseholdError };

export function householdOk<T>(data: T): HouseholdResult<T> {
  return { ok: true, data };
}

export function householdFail<T = never>(
  code: HouseholdErrorCode,
  message: string,
): HouseholdResult<T> {
  return { ok: false, error: { code, message } };
}

export interface WriteProbeResult {
  allowed: boolean;
  role: HouseholdRole;
  message: string;
}

export interface CreateInviteInput {
  /** Clientseitige UUIDv7 (Replay-Sicherheit wie bei allen RPCs). */
  inviteId: string;
  householdId: string;
  /** SHA-256-Hex des Roh-Tokens; der Server sieht den Roh-Token nie. */
  tokenHash: string;
  role: HouseholdRole;
  maxUses: number;
  expiresAt: string;
}

export interface HouseholdAdapter {
  readonly mode: 'mock' | 'supabase';
  getMyHousehold(): Promise<HouseholdResult<HouseholdSummary | null>>;
  createHousehold(name: string): Promise<HouseholdResult<HouseholdSummary>>;
  listMembers(householdId: string): Promise<HouseholdResult<HouseholdMember[]>>;
  listInvites(householdId: string): Promise<HouseholdResult<HouseholdInvite[]>>;
  createInvite(input: CreateInviteInput): Promise<HouseholdResult<HouseholdInvite>>;
  revokeInvite(inviteId: string): Promise<HouseholdResult<void>>;
  checkInvite(tokenHash: string): Promise<HouseholdResult<InvitePreview>>;
  acceptInvite(tokenHash: string, memberId: string): Promise<HouseholdResult<AcceptInviteResult>>;
  changeMemberRole(
    householdId: string,
    userId: string,
    role: HouseholdRole,
  ): Promise<HouseholdResult<HouseholdMember>>;
  removeMember(householdId: string, userId: string): Promise<HouseholdResult<void>>;
  leaveHousehold(householdId: string): Promise<HouseholdResult<void>>;
  /** Nur im Mock-/E2E-Modus: prueft Schreibrecht mit einem echten Testschreibvorgang. */
  writeProbe?(householdId: string): Promise<HouseholdResult<WriteProbeResult>>;
}
