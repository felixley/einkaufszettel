'use client';

import { useEffect } from 'react';
import { registerServiceWorker } from '@/lib/pwa/register';

/**
 * Registriert den Service Worker im Browser. Rendert bewusst nichts und ist
 * fehlertolerant – ohne HTTPS/SW-Unterstützung bleibt die App voll nutzbar.
 */
export function PwaRegister() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  return null;
}
