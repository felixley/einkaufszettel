import Script from 'next/script';

/**
 * Setzt das Theme vor dem ersten Paint (kein Hell/Dunkel-Flackern).
 * `beforeInteractive` wird von Next.js in den <head> injiziert, auch wenn die
 * Komponente im Root-Layout im Body gerendert wird. Muss laut Next-Doku im
 * Root-Layout (`app/layout.tsx`) liegen.
 */
const THEME_INIT_SCRIPT = `(function(){try{var k='einkaufszettel-theme';var c=localStorage.getItem(k);if(c!=='light'&&c!=='dark'&&c!=='system'){c='system';}var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var r=c==='system'?(m?'dark':'light'):c;var e=document.documentElement;e.dataset.theme=r;e.dataset.themeChoice=c;}catch(_e){}})();`;

export function ThemeScript() {
  return (
    <Script id="theme-init" strategy="beforeInteractive">
      {THEME_INIT_SCRIPT}
    </Script>
  );
}
