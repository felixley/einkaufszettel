'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getHouseholdAdapter } from '@/lib/household';
import type {
  HouseholdInvite,
  HouseholdMember,
  HouseholdRole,
  HouseholdSummary,
  WriteProbeResult,
} from '@/lib/household/types';
import { ROLE_LABELS } from '@/lib/household/types';
import { InvitationDialog } from './InvitationDialog';
import styles from './household.module.css';

interface MemberManagementPanelProps {
  household: HouseholdSummary;
  onLeft: () => void;
  onHouseholdChanged?: () => void;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ');
}

function roleBadgeClass(role: HouseholdRole): string {
  // CSS-Module-Klassen sind unter noUncheckedIndexedAccess `string | undefined`.
  const base = styles.roleBadge ?? '';
  if (role === 'owner') return `${base} ${styles.roleOwner ?? ''}`.trim();
  if (role === 'editor') return `${base} ${styles.roleEditor ?? ''}`.trim();
  return base;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

function inviteStatus(invite: HouseholdInvite): string {
  if (invite.revokedAt !== null) return 'widerrufen';
  if (new Date(invite.expiresAt).getTime() <= Date.now()) return 'abgelaufen';
  if (invite.usedCount >= invite.maxUses) return 'aufgebraucht';
  return 'offen';
}

export function MemberManagementPanel({
  household,
  onLeft,
  onHouseholdChanged,
}: MemberManagementPanelProps) {
  const { user } = useAuth();
  const adapter = getHouseholdAdapter();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [invites, setInvites] = useState<HouseholdInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null);
  const [probe, setProbe] = useState<WriteProbeResult | null>(null);
  const [probePending, setProbePending] = useState(false);

  const isOwner = household.role === 'owner';
  const owners = useMemo(
    () => members.filter((member) => member.role === 'owner').length,
    [members],
  );

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    const memberResult = await adapter.listMembers(household.id);
    if (!memberResult.ok) {
      setError(memberResult.error.message);
      setLoading(false);
      return;
    }
    setMembers(memberResult.data);
    if (isOwner) {
      const inviteResult = await adapter.listInvites(household.id);
      setInvites(inviteResult.ok ? inviteResult.data : []);
      if (!inviteResult.ok) setError(inviteResult.error.message);
    } else {
      setInvites([]);
    }
    setLoading(false);
  }, [adapter, household.id, isOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  // Bei Rueckkehr in den Tab neu laden: Rollenaenderungen anderer Geraete
  // werden dann sichtbar (RLS prueft ohnehin bei jedem Schreibzugriff live).
  useEffect(() => {
    function onVisible(): void {
      if (document.visibilityState === 'visible') void load();
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [load]);

  async function handleRoleChange(member: HouseholdMember, role: HouseholdRole): Promise<void> {
    setPending(`role:${member.userId}`);
    setError(null);
    setInfo(null);
    const result = await adapter.changeMemberRole(household.id, member.userId, role);
    if (!result.ok) {
      setError(result.error.message);
    } else {
      setInfo(`Rolle von ${member.displayName} auf ${ROLE_LABELS[role]} geaendert.`);
      await load();
      onHouseholdChanged?.();
    }
    setPending(null);
  }

  async function handleRemove(member: HouseholdMember): Promise<void> {
    setPending(`remove:${member.userId}`);
    setError(null);
    setInfo(null);
    const result = await adapter.removeMember(household.id, member.userId);
    if (!result.ok) {
      setError(result.error.message);
    } else {
      setInfo(`${member.displayName} wurde entfernt.`);
      setRemoveConfirm(null);
      await load();
      onHouseholdChanged?.();
    }
    setPending(null);
  }

  async function handleRevoke(invite: HouseholdInvite): Promise<void> {
    setPending(`revoke:${invite.id}`);
    setError(null);
    setInfo(null);
    const result = await adapter.revokeInvite(invite.id);
    if (!result.ok) {
      setError(result.error.message);
    } else {
      setInfo('Einladung widerrufen.');
      setRevokeConfirm(null);
      await load();
    }
    setPending(null);
  }

  async function handleLeave(): Promise<void> {
    setPending('leave');
    setError(null);
    setInfo(null);
    const result = await adapter.leaveHousehold(household.id);
    if (!result.ok) {
      setError(result.error.message);
      setPending(null);
      return;
    }
    setPending(null);
    onLeft();
  }

  async function handleProbe(): Promise<void> {
    if (!adapter.writeProbe) return;
    setProbePending(true);
    setProbe(null);
    const result = await adapter.writeProbe(household.id);
    setProbe(
      result.ok
        ? result.data
        : { allowed: false, role: household.role, message: result.error.message },
    );
    setProbePending(false);
  }

  return (
    <div className={styles.panel}>
      {error ? (
        <p className={styles.error} role="alert" data-testid="member-error">
          {error}
        </p>
      ) : null}
      {info ? (
        <p className={styles.success} role="status" data-testid="member-info">
          {info}
        </p>
      ) : null}

      <div className="card" style={{ margin: 0 }}>
        <div className={styles.sectionHeader}>
          <h2>Mitglieder</h2>
          <span className={styles.counter} data-testid="member-count">
            {members.length} {members.length === 1 ? 'Person' : 'Personen'}
          </span>
        </div>

        {loading ? <p className="muted">Mitglieder werden geladen …</p> : null}

        <div className={styles.memberList} data-testid="member-list">
          {members.map((member) => {
            const isSelf = member.userId === user?.id;
            const rowPending =
              pending === `role:${member.userId}` || pending === `remove:${member.userId}`;
            return (
              <div key={member.id} className={styles.memberRow} data-testid="member-row">
                <div className={styles.memberMain}>
                  <span className={styles.memberName}>
                    {member.displayName}
                    {isSelf ? <span className="muted"> (Du)</span> : null}
                  </span>
                  <span className={roleBadgeClass(member.role)} data-testid="member-role">
                    {ROLE_LABELS[member.role]}
                  </span>
                </div>

                {isOwner ? (
                  <div className={styles.rowActions}>
                    <label
                      htmlFor={`role-${member.userId}`}
                      className="muted"
                      style={{ fontWeight: 400 }}
                    >
                      Rolle aendern
                    </label>
                    <select
                      id={`role-${member.userId}`}
                      className={styles.select}
                      value={member.role}
                      disabled={rowPending || pending !== null}
                      aria-label={`Rolle von ${member.displayName}`}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (next === 'owner' || next === 'editor' || next === 'viewer') {
                          void handleRoleChange(member, next);
                        }
                      }}
                    >
                      <option value="owner">Owner</option>
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>

                    {!isSelf && removeConfirm !== member.userId ? (
                      <button
                        type="button"
                        className={cx(styles.smallButton, styles.dangerButton)}
                        onClick={() => setRemoveConfirm(member.userId)}
                        disabled={pending !== null}
                      >
                        Entfernen
                      </button>
                    ) : null}
                    {!isSelf && removeConfirm === member.userId ? (
                      <div
                        className={styles.inlineConfirm}
                        role="group"
                        aria-label="Entfernen bestaetigen"
                      >
                        <span className={styles.inlineConfirmText}>
                          {member.displayName} wirklich entfernen?
                        </span>
                        <button
                          type="button"
                          className={cx(styles.smallButton, styles.dangerButton)}
                          onClick={() => void handleRemove(member)}
                          disabled={rowPending}
                          data-testid="remove-confirm"
                        >
                          {rowPending ? 'Entferne …' : 'Wirklich entfernen'}
                        </button>
                        <button
                          type="button"
                          className={cx(styles.smallButton, 'button secondary')}
                          onClick={() => setRemoveConfirm(null)}
                          disabled={rowPending}
                        >
                          Abbrechen
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {isOwner ? (
        <div className="card" style={{ margin: 0 }}>
          <div className={styles.sectionHeader}>
            <h2>Einladungen</h2>
            <button
              type="button"
              className={styles.smallButton}
              onClick={() => setDialogOpen(true)}
              disabled={pending !== null}
              data-testid="open-invite-dialog"
            >
              Mitglied einladen
            </button>
          </div>
          <p className={styles.hint}>
            Offene Einladungen sind hier sichtbar. Der Link/QR wird nur direkt nach dem Erstellen
            angezeigt – gespeichert wird ausschliesslich der Token-Hash.
          </p>

          {invites.length === 0 ? (
            <p className="muted" data-testid="no-invites">
              Noch keine Einladungen.
            </p>
          ) : (
            <div data-testid="invite-list">
              {invites.map((invite) => {
                const status = inviteStatus(invite);
                const rowPending = pending === `revoke:${invite.id}`;
                return (
                  <div key={invite.id} className={styles.inviteRow}>
                    <div className={styles.memberMain}>
                      <span className={styles.memberName}>{ROLE_LABELS[invite.role]}</span>
                      <span className={roleBadgeClass(invite.role)}>{status}</span>
                    </div>
                    <div className={styles.inviteMeta}>
                      <span>
                        Nutzungen {invite.usedCount}/{invite.maxUses}
                      </span>
                      <span>bis {formatDateTime(invite.expiresAt)}</span>
                    </div>
                    {invite.revokedAt === null && status === 'offen' ? (
                      revokeConfirm === invite.id ? (
                        <div
                          className={styles.inlineConfirm}
                          role="group"
                          aria-label="Widerruf bestaetigen"
                        >
                          <span className={styles.inlineConfirmText}>
                            Einladung wirklich widerrufen?
                          </span>
                          <button
                            type="button"
                            className={cx(styles.smallButton, styles.dangerButton)}
                            onClick={() => void handleRevoke(invite)}
                            disabled={rowPending}
                            data-testid="revoke-confirm"
                          >
                            {rowPending ? 'Widerrufe …' : 'Wirklich widerrufen'}
                          </button>
                          <button
                            type="button"
                            className={cx(styles.smallButton, 'button secondary')}
                            onClick={() => setRevokeConfirm(null)}
                            disabled={rowPending}
                          >
                            Abbrechen
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={cx(styles.smallButton, styles.dangerButton)}
                          onClick={() => setRevokeConfirm(invite.id)}
                          disabled={pending !== null}
                        >
                          Widerrufen
                        </button>
                      )
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {adapter.writeProbe ? (
        <div className="card" style={{ margin: 0 }}>
          <h2>Schreibrecht testen</h2>
          <p className={styles.hint}>
            Dev-/E2E-Diagnose: legt einen Testartikel in der Standardliste an. So ist sofort
            sichtbar, ob die aktuelle Rolle schreiben darf.
          </p>
          <button
            type="button"
            className="button secondary"
            onClick={() => void handleProbe()}
            disabled={probePending}
            data-testid="write-probe"
          >
            {probePending ? 'Teste Schreibrecht …' : 'Schreibrecht testen'}
          </button>
          {probe ? (
            <p
              className={cx(
                styles.probeResult,
                probe.allowed ? styles.probeOk : styles.probeDenied,
              )}
              role="status"
              data-testid="write-probe-result"
              data-allowed={probe.allowed ? 'true' : 'false'}
            >
              {probe.message}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="card" style={{ margin: 0 }}>
        <h2>Haushalt verlassen</h2>
        {isOwner && owners <= 1 ? (
          <p className={styles.hint} data-testid="last-owner-hint">
            Du bist der letzte Owner. Uebertrage zuerst die Owner-Rolle, sonst kann der Haushalt
            nicht verlassen werden.
          </p>
        ) : (
          <p className={styles.hint}>
            Du verlaesst den Haushalt und siehst seine Listen nicht mehr. Ein Owner kann die Rolle
            vorher uebergeben.
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={cx(styles.smallButton, styles.dangerButton)}
            onClick={() => void handleLeave()}
            disabled={pending !== null}
            data-testid="leave-household"
          >
            {pending === 'leave' ? 'Verlasse …' : 'Haushalt verlassen'}
          </button>
        </div>
      </div>

      {dialogOpen ? (
        <InvitationDialog
          householdId={household.id}
          onClose={() => setDialogOpen(false)}
          onCreated={() => {
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
