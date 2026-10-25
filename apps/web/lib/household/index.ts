import { isMockAuth } from '@/lib/auth/mode';
import { MockHouseholdAdapter } from './mock-adapter';
import { SupabaseHouseholdAdapter } from './supabase-adapter';
import type { HouseholdAdapter } from './types';

let adapter: HouseholdAdapter | null = null;

/**
 * Liefert den Haushalts-Adapter passend zum Auth-Modus:
 * - Mock-Auth (Dev/E2E, kein Supabase konfiguriert) -> Mock-API des Dev-Servers.
 * - Supabase-Auth -> echte RPCs aus Migration 005.
 *
 * Die UI kennt nur dieses Interface; im Supabase-Modus laufen alle Schreib-
 * und Lesepfade ueber die RPCs/RLS, im Mock-Modus ueber den In-Memory-Server.
 */
export function getHouseholdAdapter(): HouseholdAdapter {
  adapter ??= isMockAuth() ? new MockHouseholdAdapter() : new SupabaseHouseholdAdapter();
  return adapter;
}

/** Nur fuer Tests: Singleton zuruecksetzen. */
export function resetHouseholdAdapter(): void {
  adapter = null;
}

export type {
  AcceptInviteResult,
  CreateInviteInput,
  HouseholdAdapter,
  HouseholdError,
  HouseholdErrorCode,
  HouseholdInvite,
  HouseholdMember,
  HouseholdResult,
  HouseholdRole,
  HouseholdSummary,
  InviteInvalidReason,
  InvitePreview,
  WriteProbeResult,
} from './types';
export {
  HOUSEHOLD_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  householdFail,
  householdOk,
  isHouseholdRole,
} from './types';
export { buildInviteUrl, generateInviteToken, inviteTokenFromUrl, sha256Hex } from './token';
export { uuidv7 } from './id';
