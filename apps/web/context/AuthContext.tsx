'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getAuthAdapter } from '@/lib/auth';
import { isMockAuth } from '@/lib/auth/mode';
import type { AuthAdapter, AuthResult, AuthUser, SimpleResult } from '@/lib/auth/types';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  mode: 'supabase' | 'mock';
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<SimpleResult>;
  requestPasswordReset: (email: string) => Promise<SimpleResult>;
  completePasswordReset: (email: string, newPassword: string) => Promise<SimpleResult>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [adapter, setAdapter] = useState<AuthAdapter | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const mode = useMemo<'supabase' | 'mock'>(() => (isMockAuth() ? 'mock' : 'supabase'), []);

  useEffect(() => {
    // Marker fuer E2E: erst nach der Hydration sind Formular-Handler aktiv.
    document.documentElement.dataset.authReady = 'true';
    // Adapter erst im Browser instanziieren (SSR-sicher).
    const instance = getAuthAdapter();
    setAdapter(instance);
    let cancelled = false;
    void instance
      .getCurrentUser()
      .then((current) => {
        if (!cancelled) setUser(current);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      delete document.documentElement.dataset.authReady;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!adapter) return;
    setUser(await adapter.getCurrentUser());
  }, [adapter]);

  const signUp = useCallback(
    async (email: string, password: string) => {
      if (!adapter) throw new Error('Auth-Adapter noch nicht bereit.');
      return adapter.signUp(email, password);
    },
    [adapter],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!adapter) throw new Error('Auth-Adapter noch nicht bereit.');
      const result = await adapter.signIn(email, password);
      if (result.ok) setUser(result.user);
      return result;
    },
    [adapter],
  );

  const signOut = useCallback(async () => {
    if (!adapter) return { ok: false, error: { code: 'not_ready', message: 'Auth nicht bereit.' } };
    const result = await adapter.signOut();
    if (result.ok) setUser(null);
    return result;
  }, [adapter]);

  const requestPasswordReset = useCallback(
    async (email: string) => {
      if (!adapter) throw new Error('Auth-Adapter noch nicht bereit.');
      return adapter.requestPasswordReset(email);
    },
    [adapter],
  );

  const completePasswordReset = useCallback(
    async (email: string, newPassword: string) => {
      if (!adapter) return { ok: false, error: { code: 'not_ready', message: 'Auth nicht bereit.' } };
      const result = await adapter.completePasswordReset(email, newPassword);
      if (result.ok) setUser(null);
      return result;
    },
    [adapter],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      mode,
      signUp,
      signIn,
      signOut,
      requestPasswordReset,
      completePasswordReset,
      refresh,
    }),
    [
      user,
      loading,
      mode,
      signUp,
      signIn,
      signOut,
      requestPasswordReset,
      completePasswordReset,
      refresh,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth muss innerhalb von <AuthProvider> verwendet werden.');
  return context;
}
