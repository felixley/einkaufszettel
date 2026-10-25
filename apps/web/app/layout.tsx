import type { ReactNode } from 'react';

export const metadata = {
  title: 'Einkaufszettel',
  description: 'Kollaborative Einkaufsliste (Phase 1: Infrastruktur-Platzhalter)',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
