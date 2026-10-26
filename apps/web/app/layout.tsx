import type { ReactNode } from 'react';
import type { Viewport } from 'next';
import { AuthProvider } from '@/context/AuthContext';
import { SyncProvider } from '@/lib/sync/SyncProvider';
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
    <html lang="de">
      <body>
        <PwaRegister />
        <InstallPrompt />
        <AuthProvider>
          <SyncProvider>{children}</SyncProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
