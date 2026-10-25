import { describe, expect, it } from 'vitest';
import {
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
} from './validation';

describe('validateEmail', () => {
  it('akzeptiert eine normale Adresse', () => {
    expect(validateEmail('anna@example.com')).toBeNull();
  });

  it('lehnt leere Eingabe ab', () => {
    expect(validateEmail('   ')).toBe('Bitte E-Mail-Adresse eingeben.');
  });

  it('lehnt Adressen ohne @ oder Domain ab', () => {
    expect(validateEmail('anna.example.com')).not.toBeNull();
    expect(validateEmail('anna@example')).not.toBeNull();
  });
});

describe('validatePassword', () => {
  it('akzeptiert Passwoerter ab Mindestlaenge', () => {
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it('lehnt zu kurze Passwoerter ab', () => {
    expect(validatePassword('kurz')).toContain('mindestens');
  });
});

describe('validatePasswordConfirmation', () => {
  it('akzeptiert identische Passwoerter', () => {
    expect(validatePasswordConfirmation('geheim1234', 'geheim1234')).toBeNull();
  });

  it('lehnt abweichende Passwoerter ab', () => {
    expect(validatePasswordConfirmation('geheim1234', 'anders1234')).toBe(
      'Passwoerter stimmen nicht ueberein.',
    );
  });
});

describe('normalizeEmail', () => {
  it('trimmt und normalisiert auf Kleinschreibung', () => {
    expect(normalizeEmail('  Anna@Example.COM ')).toBe('anna@example.com');
  });
});
