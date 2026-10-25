export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type FieldError = string | null;

export function validateEmail(email: string): FieldError {
  const value = email.trim();
  if (value.length === 0) return 'Bitte E-Mail-Adresse eingeben.';
  if (!EMAIL_RE.test(value)) return 'Bitte eine gueltige E-Mail-Adresse eingeben.';
  return null;
}

export function validatePassword(password: string): FieldError {
  if (password.length === 0) return 'Bitte Passwort eingeben.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.`;
  }
  return null;
}

export function validatePasswordConfirmation(password: string, confirmation: string): FieldError {
  if (confirmation.length === 0) return 'Bitte Passwort wiederholen.';
  if (password !== confirmation) return 'Passwoerter stimmen nicht ueberein.';
  return null;
}

/** Normalisiert E-Mail-Adressen fuer den Mock-Store (case-insensitive). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
