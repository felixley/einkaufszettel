'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true
  );
}

/**
 * Dezenter Installations-Button (T4.1).
 *
 * Kein Modal-Zwang: Der Button erscheint nur, wenn der Browser ein
 * `beforeinstallprompt`-Event liefert, und verschwindet nach Installation,
 * Ablehnung oder im Standalone-Modus.
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone()) return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferredPrompt(null);

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!deferredPrompt) return null;

  async function handleInstall() {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch {
      // Abbruch/Fehler: Button bleibt verborgen, kein Zwang.
    } finally {
      setDeferredPrompt(null);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        left: '1rem',
        bottom: 'calc(1rem + env(safe-area-inset-bottom))',
        zIndex: 60,
      }}
    >
      <button type="button" className="button secondary" onClick={handleInstall}>
        App installieren
      </button>
    </div>
  );
}
