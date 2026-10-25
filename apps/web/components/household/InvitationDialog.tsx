'use client';

import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import {
  buildInviteUrl,
  generateInviteToken,
  getHouseholdAdapter,
  sha256Hex,
  uuidv7,
} from '@/lib/household';
import type { HouseholdInvite, HouseholdRole } from '@/lib/household/types';
import { HOUSEHOLD_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/household/types';
import styles from './household.module.css';

interface InvitationDialogProps {
  householdId: string;
  onClose: () => void;
  onCreated: () => void;
}

const EXPIRY_OPTIONS = [
  { value: '1h', label: '1 Stunde', hours: 1 },
  { value: '1d', label: '1 Tag', hours: 24 },
  { value: '7d', label: '7 Tage', hours: 24 * 7 },
] as const;

type ExpiryValue = (typeof EXPIRY_OPTIONS)[number]['value'];

function expiryLabel(hours: number): string {
  return EXPIRY_OPTIONS.find((option) => option.hours === hours)?.label ?? `${hours} h`;
}

export function InvitationDialog({ householdId, onClose, onCreated }: InvitationDialogProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<HouseholdRole>('viewer');
  const [maxUses, setMaxUses] = useState(1);
  const [expiry, setExpiry] = useState<ExpiryValue>('7d');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<HouseholdInvite | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    titleRef.current?.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleCreate(): Promise<void> {
    setError(null);
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 20) {
      setError('Nutzungen muessen zwischen 1 und 20 liegen.');
      return;
    }
    setPending(true);
    try {
      const token = generateInviteToken();
      const tokenHash = await sha256Hex(token);
      const hours = EXPIRY_OPTIONS.find((option) => option.value === expiry)?.hours ?? 168;
      const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
      const result = await getHouseholdAdapter().createInvite({
        inviteId: uuidv7(),
        householdId,
        tokenHash,
        role,
        maxUses,
        expiresAt,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const url = buildInviteUrl(window.location.origin, token);
      setCreated(result.data);
      setInviteUrl(url);
      onCreated();
      try {
        const dataUrl = await QRCode.toDataURL(url, {
          width: 320,
          margin: 1,
          errorCorrectionLevel: 'M',
        });
        setQrDataUrl(dataUrl);
      } catch {
        setQrDataUrl(null);
        setError('QR-Code konnte nicht erzeugt werden. Der Link funktioniert trotzdem.');
      }
    } catch {
      setError('Einladung konnte nicht erstellt werden. Bitte erneut versuchen.');
    } finally {
      setPending(false);
    }
  }

  async function handleCopy(): Promise<void> {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      linkRef.current?.focus();
      linkRef.current?.select();
      setCopied(false);
      setError('Kopieren nicht erlaubt – der Link ist markiert, bitte manuell kopieren.');
    }
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-dialog-title"
        data-testid="invite-dialog"
      >
        <div className={styles.dialogHeader}>
          <h2 id="invite-dialog-title" ref={titleRef} tabIndex={-1}>
            {created ? 'Einladung erstellt' : 'Mitglied einladen'}
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            aria-label="Dialog schliessen"
            onClick={onClose}
            data-testid="invite-close"
          >
            ×
          </button>
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        {created ? (
          <div className="stack">
            <p className={styles.success}>
              Einladung fuer <strong>{ROLE_LABELS[created.role]}</strong> angelegt. Der Link ist nur
              jetzt sichtbar – er wird aus Sicherheitsgruenden nicht gespeichert.
            </p>

            <div className={styles.qrBox}>
              {qrDataUrl ? (
                <img
                  className={styles.qrImage}
                  src={qrDataUrl}
                  alt={`QR-Code zur Einladung als ${ROLE_LABELS[created.role]}`}
                  data-testid="invite-qr"
                />
              ) : (
                <p className={styles.hint}>QR-Code wird erzeugt …</p>
              )}
            </div>

            <div className={styles.linkBox}>
              <label htmlFor="invite-link">Einladungslink</label>
              <input
                id="invite-link"
                ref={linkRef}
                className={styles.linkInput}
                readOnly
                value={inviteUrl ?? ''}
                data-testid="invite-link"
                onFocus={(event) => event.currentTarget.select()}
              />
              <button type="button" onClick={() => void handleCopy()} data-testid="invite-copy">
                {copied ? 'Kopiert' : 'Link kopieren'}
              </button>
              <p className={styles.hint}>
                Rolle: {ROLE_LABELS[created.role]} · Nutzungen: {created.usedCount}/
                {created.maxUses} · gueltig bis{' '}
                {new Date(created.expiresAt).toLocaleString('de-DE')}
              </p>
            </div>

            <div className={styles.actions}>
              <button type="button" onClick={onClose} data-testid="invite-done">
                Fertig
              </button>
            </div>
          </div>
        ) : (
          <div className="stack">
            <div>
              <p className={styles.hint} style={{ marginBottom: '0.4rem' }}>
                Rolle beim Beitritt
              </p>
              <div className={styles.roleGrid} role="group" aria-label="Rolle waehlen">
                {HOUSEHOLD_ROLES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={styles.roleOption}
                    aria-pressed={role === option}
                    onClick={() => setRole(option)}
                    data-testid={`invite-role-${option}`}
                  >
                    <span className={styles.roleOptionTitle}>{ROLE_LABELS[option]}</span>
                    <span className={styles.roleOptionHint}>{ROLE_DESCRIPTIONS[option]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.fieldRow}>
              <div>
                <label htmlFor="invite-max-uses">Nutzungen</label>
                <input
                  id="invite-max-uses"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={20}
                  step={1}
                  value={maxUses}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    setMaxUses(Number.isNaN(parsed) ? 1 : parsed);
                  }}
                />
              </div>
              <div>
                <label htmlFor="invite-expiry">Gueltig</label>
                <select
                  id="invite-expiry"
                  className={styles.select}
                  value={expiry}
                  onChange={(event) => setExpiry(event.target.value as ExpiryValue)}
                >
                  {EXPIRY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {expiryLabel(option.hours)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={pending}
                data-testid="invite-create"
              >
                {pending ? 'Einladung wird erstellt …' : 'Einladung erstellen'}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={onClose}
                disabled={pending}
              >
                Abbrechen
              </button>
            </div>
            <p className={styles.hint}>
              Link und QR-Code werden erst nach dem Erstellen angezeigt. Der Server speichert nur
              einen Hash des Tokens.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
