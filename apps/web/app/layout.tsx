import type { ReactNode } from 'react';
import type { Viewport } from 'next';
import { AuthProvider } from '@/context/AuthContext';
import { SyncProvider } from '@/lib/sync/SyncProvider';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ThemeScript } from '@/components/theme/ThemeScript';
import { PwaRegister } from '@/components/pwa/PwaRegister';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import './globals.css';

export const metadata = {
  title: 'Einkaufszettel',
  description: 'Kollaborative Einkaufsliste – local-first, offline-fähig',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#1f6feb',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme setzt das Inline-Script vor dem ersten Paint (T4.4).
    <html lang="de" suppressHydrationWarning>
      <body>
        <ThemeScript />
        <PwaRegister />
        <InstallPrompt />
        <ThemeProvider>
          <AuthProvider>
            <SyncProvider>{children}</SyncProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
