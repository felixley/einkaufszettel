import { OfflineFallback } from '@/components/pwa/OfflineFallback';

export const metadata = {
  title: 'Offline – Einkaufszettel',
};

export default function OfflinePage() {
  return <OfflineFallback />;
}
