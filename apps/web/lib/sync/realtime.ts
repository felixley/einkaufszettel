import type { ListItem } from '@einkaufszettel/core';
import { createSupabaseBrowserClient } from '@/lib/auth/supabase';
import { listItemFromDbRow, type DbListItemRow } from './supabase-adapter';

/** Abstraktion, damit der Worker in Tests ohne Supabase laufen kann. */
export interface RealtimeSource {
  subscribe(onRow: (row: ListItem) => void): () => void;
}

type BrowserClient = ReturnType<typeof createSupabaseBrowserClient>;

/**
 * Supabase-Realtime auf `public.list_items` (PLAN.md §4.2).
 *
 * RLS filtert die Events bereits pro Nutzer; deshalb genügt ein Kanal ohne
 * Listen-Filter. Soft-Deletes kommen als UPDATE mit gesetztem `deleted_at` an;
 * echte DELETE-Events gibt es dank Delete-Trigger nicht.
 */
export function createSupabaseRealtimeSource(client?: BrowserClient): RealtimeSource {
  const supabase = client ?? createSupabaseBrowserClient();
  return {
    subscribe(onRow) {
      const channel = supabase
        .channel('list_items_changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'list_items' },
          (payload: { new?: Partial<DbListItemRow> }) => {
            const row = payload.new;
            if (row === undefined || typeof row.id !== 'string') return;
            if (typeof row.list_id !== 'string' || typeof row.name !== 'string') return;
            onRow(
              listItemFromDbRow({
                id: row.id,
                list_id: row.list_id,
                name: row.name,
                name_normalized: row.name_normalized ?? row.name,
                quantity: row.quantity ?? null,
                unit: row.unit ?? null,
                category_id: row.category_id ?? null,
                checked: row.checked ?? false,
                checked_by: row.checked_by ?? null,
                source_recipe_id: row.source_recipe_id ?? null,
                note: row.note ?? null,
                updated_at: row.updated_at ?? new Date().toISOString(),
                deleted_at: row.deleted_at ?? null,
              }),
            );
          },
        )
        .subscribe();
      return () => {
        void supabase.removeChannel(channel);
      };
    },
  };
}
