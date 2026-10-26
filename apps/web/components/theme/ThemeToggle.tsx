'use client';

import { useContext, useEffect, useState } from 'react';
import {
  applyTheme,
  isThemeChoice,
  THEME_STORAGE_KEY,
  ThemeContext,
  type ThemeChoice,
} from './ThemeProvider';

const NEXT_CHOICE: Record<ThemeChoice, ThemeChoice> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

const ICON: Record<ThemeChoice, string> = {
  light: '☀',
  dark: '☾',
  system: '◐',
};

const LABEL: Record<ThemeChoice, string> = {
  light: 'Hell',
  dark: 'Dunkel',
  system: 'System',
};

/**
 * Zyklischer Toggle Hell → Dunkel → System (T4.4).
 * Funktioniert auch ohne umschliessenden ThemeProvider (Fallback mit eigenem
 * Zustand + localStorage), damit Seiten nicht crashen, falls das Root-Layout
 * (noch) keinen Provider setzt. Sobald ein Provider vorhanden ist, wird dessen
 * Zustand verwendet.
 */
export function ThemeToggle() {
  const context = useContext(ThemeContext);
  const [localChoice, setLocalChoice] = useState<ThemeChoice>('system');

  useEffect(() => {
    if (context !== null) return;
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initial: ThemeChoice = isThemeChoice(stored) ? stored : 'system';
    setLocalChoice(initial);
    applyTheme(initial);

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onMediaChange = () => {
      setLocalChoice((current) => {
        if (current === 'system') applyTheme('system');
        return current;
      });
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next: ThemeChoice = isThemeChoice(event.newValue) ? event.newValue : 'system';
      setLocalChoice(next);
      applyTheme(next);
    };
    media.addEventListener('change', onMediaChange);
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', onMediaChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [context]);

  const choice = context?.choice ?? localChoice;
  const setChoice =
    context?.setChoice ??
    ((next: ThemeChoice) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      setLocalChoice(next);
      applyTheme(next);
    });
  const next = NEXT_CHOICE[choice];

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setChoice(next)}
      aria-label={`Farbschema: ${LABEL[choice]} – umschalten zu ${LABEL[next]}`}
      title={`Farbschema: ${LABEL[choice]} (nächste Stufe: ${LABEL[next]})`}
      data-testid="theme-toggle"
      data-theme-choice={choice}
    >
      <span aria-hidden="true">{ICON[choice]}</span>
    </button>
  );
}
