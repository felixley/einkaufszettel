-- =============================================================================
-- Einkaufszettel — Migration 006: RLS-Fix fuer household_members (Soft-Delete)
-- Quelle: PLAN.md §4.5 (Sicherheit), §5 T2.4 (Mitglied entfernen)
-- =============================================================================
-- Befund aus pgTAP (T2.4, PostgreSQL 16.2):
--   `remove_member()` lief als SECURITY INVOKER und scheiterte beim Soft-Delete
--   eines Mitglieds mit "new row violates row-level security policy for table
--   household_members".
--
-- Ursache: PostgreSQL wendet die USING-Klausel der SELECT-Policy bei UPDATE
-- zusaetzlich auf die NEUE Zeile an (dasselbe Verhalten wie bei `lists`, siehe
-- Migration 004). `household_members_select` verlangte `deleted_at IS NULL`
-- und `is_household_member(household_id)`. Nach dem Setzen von `deleted_at`
-- erfuellt die neue Zeile beides nicht mehr — der Owner konnte also kein
-- Mitglied entfernen, obwohl die UPDATE-Policy (Owner-only) es erlaubt.
--
-- Fix: Owner duerfen soft-geloeschte Mitgliedszeilen sehen. Noetig fuer
-- Entfernen, Re-Invite (Reaktivierung einer soft-geloeschten Zeile) und
-- Outbox-Replay. Editor/Viewer sehen weiterhin ausschliesslich aktive
-- Mitglieder; Nichtmitglieder sehen gar nichts (Mitgliedschaftsbezug bleibt
-- ueber is_household_member() geprueft).
--
-- Die Migration ist idempotent (DROP POLICY IF EXISTS + CREATE POLICY).
-- =============================================================================

drop policy if exists household_members_select on public.household_members;

create policy household_members_select on public.household_members
  for select to authenticated
  using (
    public.is_household_member(household_id)
    and (
      deleted_at is null
      or public.is_household_owner(household_id)
    )
  );

comment on policy household_members_select on public.household_members is
  'Mitglieder sehen aktive Mitglieder; Owner zusaetzlich soft-geloeschte (Entfernen/Re-Invite/Replay).';
