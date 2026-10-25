import { createSupabaseBrowserClient } from '@/lib/auth/supabase';
import { uuidv7 } from './id';
import type {
  AcceptInviteResult,
  CreateInviteInput,
  HouseholdAdapter,
  HouseholdError,
  HouseholdInvite,
  HouseholdMember,
  HouseholdResult,
  HouseholdRole,
  HouseholdSummary,
  InviteInvalidReason,
  InvitePreview,
} from './types';
import { householdFail, householdOk } from './types';

interface RpcErrorShape {
  code?: string;
  message?: string;
}

interface DbMemberRow {
  id?: unknown;
  user_id?: unknown;
  role?: unknown;
  created_at?: unknown;
  profiles?: unknown;
}

interface DbHouseholdRow {
  id?: unknown;
  name?: unknown;
}

interface DbInviteRow {
  id?: unknown;
  household_id?: unknown;
  role?: unknown;
  expires_at?: unknown;
  max_uses?: unknown;
  used_count?: unknown;
  revoked_at?: unknown;
  created_at?: unknown;
}

interface InvitePreviewJson {
  valid?: unknown;
  reason?: unknown;
  household_id?: unknown;
  role?: unknown;
  expires_at?: unknown;
  remaining_uses?: unknown;
}

interface AcceptJson {
  household_id?: unknown;
  household_name?: unknown;
  role?: unknown;
  already_member?: unknown;
  restored_member?: unknown;
  previous_role?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asRole(value: unknown): HouseholdRole {
  return value === 'owner' || value === 'editor' || value === 'viewer' ? value : 'viewer';
}

function displayNameFromProfiles(value: unknown): string {
  if (Array.isArray(value)) {
    const first: unknown = value[0];
    if (typeof first === 'object' && first !== null) {
      return asString((first as { display_name?: unknown }).display_name) ?? 'Mitglied';
    }
    return 'Mitglied';
  }
  if (typeof value === 'object' && value !== null) {
    return asString((value as { display_name?: unknown }).display_name) ?? 'Mitglied';
  }
  return 'Mitglied';
}

function mapInviteReason(value: unknown): InviteInvalidReason {
  return value === 'expired' || value === 'revoked' || value === 'exhausted' ? value : 'not_found';
}

/** PostgreSQL/PostgREST-Fehlercodes in differenzierte UI-Fehler uebersetzen. */
export function mapHouseholdRpcError(error: RpcErrorShape | null): HouseholdError {
  const code = error?.code ?? '';
  const message = error?.message ?? 'Unbekannter Haushaltsfehler.';
  if (code === '42501') return { code: 'forbidden', message };
  if (code === 'P0001') return { code: 'last_owner', message };
  if (code === 'P0002') return { code: 'not_found', message };
  if (code === '22023') {
    if (/abgelaufen/i.test(message)) return { code: 'expired', message };
    if (/widerrufen/i.test(message)) return { code: 'revoked', message };
    if (/aufgebraucht/i.test(message)) return { code: 'exhausted', message };
    return { code: 'invalid', message };
  }
  return { code: 'unknown', message };
}

function toInvite(row: DbInviteRow): HouseholdInvite {
  return {
    id: asString(row.id) ?? '',
    householdId: asString(row.household_id) ?? '',
    role: asRole(row.role),
    expiresAt: asString(row.expires_at) ?? '',
    maxUses: asNumber(row.max_uses, 1),
    usedCount: asNumber(row.used_count),
    revokedAt: asString(row.revoked_at),
    createdAt: asString(row.created_at) ?? '',
  };
}

/**
 * Supabase-Adapter: nutzt ausschliesslich die in Migration 005 definierten
 * RPCs. Die UI ruft diese Klasse nur auf, wenn kein Mock-Modus aktiv ist.
 */
export class SupabaseHouseholdAdapter implements HouseholdAdapter {
  readonly mode = 'supabase' as const;
  private readonly client = createSupabaseBrowserClient();

  private async currentUserId(): Promise<string | null> {
    const { data } = await this.client.auth.getUser();
    return data.user?.id ?? null;
  }

  private async ensureProfile(): Promise<HouseholdResult<string>> {
    const { data } = await this.client.auth.getUser();
    const user = data.user;
    if (!user) return householdFail('unauthenticated', 'Nicht angemeldet.');
    const email = user.email ?? '';
    const displayName = email.split('@')[0]?.trim() || 'Mitglied';
    const { error } = await this.client
      .from('profiles')
      .upsert(
        { id: user.id, display_name: displayName },
        { onConflict: 'id', ignoreDuplicates: true },
      );
    if (error && error.code !== '23505') {
      return householdFail('unknown', error.message);
    }
    return householdOk(user.id);
  }

  async getMyHousehold(): Promise<HouseholdResult<HouseholdSummary | null>> {
    const userId = await this.currentUserId();
    if (!userId) return householdFail('unauthenticated', 'Nicht angemeldet.');
    const { data, error } = await this.client
      .from('household_members')
      .select('role, household_id, households(id,name)')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return { ok: false, error: mapHouseholdRpcError(error) };
    if (!data) return householdOk(null);
    const row = data as { role?: unknown; households?: unknown };
    const embedded = Array.isArray(row.households) ? row.households[0] : row.households;
    const household = (embedded ?? {}) as DbHouseholdRow;
    const id = asString(household.id);
    const name = asString(household.name);
    if (!id || !name) return householdOk(null);
    return householdOk({ id, name, role: asRole(row.role) });
  }

  async createHousehold(name: string): Promise<HouseholdResult<HouseholdSummary>> {
    const ensured = await this.ensureProfile();
    if (!ensured.ok) return ensured;
    const { data, error } = await this.client.rpc('create_household', {
      p_household_id: uuidv7(),
      p_name: name,
      p_member_id: uuidv7(),
      p_list_id: uuidv7(),
      p_list_name: 'Einkaufsliste',
    });
    if (error) return { ok: false, error: mapHouseholdRpcError(error) };
    const row = (Array.isArray(data) ? data[0] : data) as DbHouseholdRow | null;
    const id = asString(row?.id);
    const householdName = asString(row?.name) ?? name;
    if (!id) return householdFail('unknown', 'Haushalt konnte nicht angelegt werden.');
    return householdOk({ id, name: householdName, role: 'owner' });
  }

  async listMembers(householdId: string): Promise<HouseholdResult<HouseholdMember[]>> {
    const { data, error } = await this.client
      .from('household_members')
      .select('id,user_id,role,created_at,profiles(display_name)')
      .eq('household_id', householdId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    if (error) return { ok: false, error: mapHouseholdRpcError(error) };
    const rows = (data ?? []) as DbMemberRow[];
    const members = rows.map((row) => ({
      id: asString(row.id) ?? '',
      userId: asString(row.user_id) ?? '',
      role: asRole(row.role),
      displayName: displayNameFromProfiles(row.profiles),
      createdAt: asString(row.created_at) ?? '',
    }));
    return householdOk(members);
  }

  async listInvites(householdId: string): Promise<HouseholdResult<HouseholdInvite[]>> {
    const { data, error } = await this.client.rpc('list_household_invites', {
      p_household_id: householdId,
    });
    if (error) return { ok: false, error: mapHouseholdRpcError(error) };
    return householdOk(((data ?? []) as DbInviteRow[]).map(toInvite));
  }

  async createInvite(input: CreateInviteInput): Promise<HouseholdResult<HouseholdInvite>> {
    const { data, error } = await this.client.rpc('create_invite', {
      p_invite_id: input.inviteId,
      p_household_id: input.householdId,
      p_token_hash: input.tokenHash,
      p_role: input.role,
      p_max_uses: input.maxUses,
      p_expires_at: input.expiresAt,
    });
    if (error) return { ok: false, error: mapHouseholdRpcError(error) };
    const row = (Array.isArray(data) ? data[0] : data) as DbInviteRow | null;
    if (!row) return householdFail('unknown', 'Einladung konnte nicht angelegt werden.');
    return householdOk(toInvite(row));
  }

  async revokeInvite(inviteId: string): Promise<HouseholdResult<void>> {
    const { error } = await this.client.rpc('revoke_invite', { p_invite_id: inviteId });
    if (error) return { ok: false, error: mapHouseholdRpcError(error) };
    return householdOk(undefined);
  }

  async checkInvite(tokenHash: string): Promise<HouseholdResult<InvitePreview>> {
    const { data, error } = await this.client.rpc('check_invite', { p_token_hash: tokenHash });
    if (error) return { ok: false, error: mapHouseholdRpcError(error) };
    const raw = (Array.isArray(data) ? data[0] : data) as InvitePreviewJson | null;
    if (!raw || raw.valid !== true) {
      return householdOk({ valid: false, reason: mapInviteReason(raw?.reason) });
    }
    const householdId = asString(raw.household_id);
    const preview: InvitePreview = {
      valid: true,
      role: asRole(raw.role),
      expiresAt: asString(raw.expires_at) ?? '',
      remainingUses: asNumber(raw.remaining_uses),
    };
    if (householdId) {
      preview.householdId = householdId;
      // RLS erlaubt Nicht-Mitgliedern keinen Blick auf households; der Name ist
      // fuer die Vorschau optional. Nach dem Beitritt liefert accept_invite ihn.
      const { data: household } = await this.client
        .from('households')
        .select('name')
        .eq('id', householdId)
        .maybeSingle();
      const name = asString((household as DbHouseholdRow | null)?.name);
      if (name) preview.householdName = name;
    }
    return householdOk(preview);
  }

  async acceptInvite(
    tokenHash: string,
    memberId: string,
  ): Promise<HouseholdResult<AcceptInviteResult>> {
    const { data, error } = await this.client.rpc('accept_invite', {
      p_token_hash: tokenHash,
      p_member_id: memberId,
    });
    if (error) return { ok: false, error: mapHouseholdRpcError(error) };
    const raw = (Array.isArray(data) ? data[0] : data) as AcceptJson | null;
    const householdId = asString(raw?.household_id);
    const householdName = asString(raw?.household_name);
    if (!raw || !householdId || !householdName) {
      return householdFail('unknown', 'Beitritt lieferte keine gueltige Antwort.');
    }
    const previousRole = asString(raw.previous_role);
    const result: AcceptInviteResult = {
      householdId,
      householdName,
      role: asRole(raw.role),
      alreadyMember: raw.already_member === true,
      restoredMember: raw.restored_member === true,
    };
    if (previousRole === 'owner' || previousRole === 'editor' || previousRole === 'viewer') {
      result.previousRole = previousRole;
    }
    return householdOk(result);
  }

  async changeMemberRole(
    householdId: string,
    userId: string,
    role: HouseholdRole,
  ): Promise<HouseholdResult<HouseholdMember>> {
    const { data, error } = await this.client.rpc('change_member_role', {
      p_household_id: householdId,
      p_user_id: userId,
      p_new_role: role,
    });
    if (error) return { ok: false, error: mapHouseholdRpcError(error) };
    const row = (Array.isArray(data) ? data[0] : data) as DbMemberRow | null;
    if (!row) return householdFail('unknown', 'Rollenwechsel lieferte keine Antwort.');
    return householdOk({
      id: asString(row.id) ?? '',
      userId: asString(row.user_id) ?? userId,
      role: asRole(row.role),
      displayName: 'Mitglied',
      createdAt: asString(row.created_at) ?? '',
    });
  }

  async removeMember(householdId: string, userId: string): Promise<HouseholdResult<void>> {
    const { error } = await this.client.rpc('remove_member', {
      p_household_id: householdId,
      p_user_id: userId,
    });
    if (error) return { ok: false, error: mapHouseholdRpcError(error) };
    return householdOk(undefined);
  }

  async leaveHousehold(householdId: string): Promise<HouseholdResult<void>> {
    const { error } = await this.client.rpc('leave_household', { p_household_id: householdId });
    if (error) return { ok: false, error: mapHouseholdRpcError(error) };
    return householdOk(undefined);
  }
}
