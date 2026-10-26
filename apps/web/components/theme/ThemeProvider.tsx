'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  /** Vom Nutzer gewählte Stufe (Hell/Dunkel/System). */
  choice: ThemeChoice;
  /** Tatsächlich aktive Stufe nach Auflösung von „System“. */
  resolved: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
}

export const THEME_STORAGE_KEY = 'einkaufszettel-theme';

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice !== 'system') return choice;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Setzt data-theme/data-theme-choice auf <html> und liefert die aktive Stufe. */
export function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolveTheme(choice);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeChoice = choice;
  }
  return resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Startwerte sind bewusst „System/Hell“: Der Inline-Script in <head> hat das
  // Attribut vor dem ersten Paint bereits gesetzt; hier wird nur der React-
  // Zustand nachgezogen (kein Flash, kein Hydration-Drift bei data-theme).
  const [choice, setChoiceState] = useState<ThemeChoice>('system');
  const [resolved, setResolved] = useState<ResolvedTheme>('light');
  const choiceRef = useRef<ThemeChoice>('system');

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initial: ThemeChoice = isThemeChoice(stored) ? stored : 'system';
    choiceRef.current = initial;
    setChoiceState(initial);
    setResolved(applyTheme(initial));

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onMediaChange = () => {
      if (choiceRef.current !== 'system') return;
      setResolved(applyTheme('system'));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next: ThemeChoice = isThemeChoice(event.newValue) ? event.newValue : 'system';
      choiceRef.current = next;
      setChoiceState(next);
      setResolved(applyTheme(next));
    };

    media.addEventListener('change', onMediaChange);
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', onMediaChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => {
    choiceRef.current = next;
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    setChoiceState(next);
    setResolved(applyTheme(next));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ choice, resolved, setChoice }),
    [choice, resolved, setChoice],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error('useTheme muss innerhalb von <ThemeProvider> verwendet werden.');
  }
  return context;
}
