import type { MetadataRoute } from 'next';

const THEME_COLOR = '#1c66e0';
const BACKGROUND_COLOR = '#f7f7f8';

/**
 * Web-App-Manifest (T4.1).
 *
 * Bewusst als `app/manifest.ts` statt `public/manifest.webmanifest`:
 * Next.js rendert die Datei als Metadata-Route unter `/manifest.webmanifest`
 * und verlinkt sie automatisch im `<head>`. Dadurch gibt es genau eine Quelle
 * für Name, Icons und Theme – ohne doppelt gepflegte JSON-Datei.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Einkaufszettel',
    short_name: 'Einkaufszettel',
    description: 'Kollaborative Einkaufsliste – local-first, offline-fähig',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'de',
    dir: 'ltr',
    theme_color: THEME_COLOR,
    background_color: BACKGROUND_COLOR,
    categories: ['shopping', 'productivity', 'lifestyle'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
