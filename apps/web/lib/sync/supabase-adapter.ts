import type {
  AddToListRequest,
  FieldTimestamps,
  ListItem,
  ListItemFields,
  ListItemRowData,
  RowId,
  SyncAdapter,
  Unit,
} from '@einkaufszettel/core';
import { createSupabaseBrowserClient } from '@/lib/auth/supabase';

/** Zeilenform, wie PostgREST sie für `public.list_items` liefert. */
export interface DbListItemRow {
  id: string;
  list_id: string;
  name: string;
  name_normalized: string;
  quantity: number | string | null;
  unit: Unit | null;
  category_id: string | null;
  checked: boolean;
  checked_by: string | null;
  source_recipe_id: string | null;
  note: string | null;
  updated_at: string;
  deleted_at: string | null;
}

export class SyncAdapterError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = 'SyncAdapterError';
    this.code = code;
  }
}

/** Fehlercode von PostgREST/Supabase in eine lesbare Meldung übersetzen. */
function toAdapterError(error: { message?: string; code?: string } | null): SyncAdapterError {
  if (error === null) return new SyncAdapterError('Unbekannter Supabase-Fehler.');
  return new SyncAdapterError(error.message ?? 'Unbekannter Supabase-Fehler.', error.code ?? null);
}

function numeric(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Serverzeile → Domänenzeile. Feld-Zeitstempel werden mit `updated_at` belegt. */
export function listItemFromDbRow(row: DbListItemRow): ListItem {
  const updatedAt = row.updated_at;
  const fields: ListItemFields = {
    list_id: row.list_id,
    name: row.name,
    name_normalized: row.name_normalized,
    quantity: numeric(row.quantity),
    unit: row.unit,
    category_id: row.category_id,
    checked: row.checked,
    checked_by: row.checked_by,
    source_recipe_id: row.source_recipe_id,
    note: row.note,
  };
  const stamps: FieldTimestamps<ListItemFields> = {};
  for (const key of Object.keys(fields) as (keyof ListItemFields)[]) stamps[key] = updatedAt;
  return {
    id: row.id,
    updated_at: updatedAt,
    deleted_at: row.deleted_at,
    field_updated_at: stamps,
    fields,
  };
}

/** Domänenzeile → PostgREST-Payload. `changed_fields` dient nur der Outbox-Doku. */
export function dbRowFromListItem(row: ListItemRowData): Record<string, unknown> {
  return {
    id: row.id,
    list_id: row.list_id,
    name: row.name,
    name_normalized: row.name_normalized,
    quantity: row.quantity,
    unit: row.unit,
    category_id: row.category_id,
    checked: row.checked,
    checked_by: row.checked_by,
    source_recipe_id: row.source_recipe_id,
    note: row.note,
  };
}

type BrowserClient = ReturnType<typeof createSupabaseBrowserClient>;

/**
 * Echter Sync-Adapter gegen Supabase/PostgREST.
 *
 * - `upsert` ist idempotent über die clientseitige UUID (onConflict: id).
 * - `softDelete` setzt `deleted_at`; ein späterer Upsert belebt die Zeile
 *   nicht wieder, weil `deleted_at` dabei nicht überschrieben wird.
 * - `addToList` ruft die RPC `add_to_list` auf. Die SQL-Funktion ist in den
 *   Migrationen dieses Repos noch nicht vorhanden (Backend-Lücke); der Aufruf
 *   schlägt dann sauber fehl und landet nach maxAttempts im Dead-Letter.
 */
export class SupabaseSyncAdapter implements SyncAdapter {
  private readonly client: BrowserClient;

  constructor(client?: BrowserClient) {
    this.client = client ?? createSupabaseBrowserClient();
  }

  async upsert(table: string, row: ListItemRowData): Promise<void> {
    const { error } = await this.client
      .from(table)
      .upsert(dbRowFromListItem(row), { onConflict: 'id' });
    if (error) throw toAdapterError(error);
  }

  async softDelete(table: string, id: RowId): Promise<void> {
    const { error } = await this.client
      .from(table)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw toAdapterError(error);
  }

  async addToList(request: AddToListRequest): Promise<void> {
    // Die RPC-Signatur ist im generierten DB-Typ dieses Repos nicht deklariert.
    const rpc = this.client.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message?: string; code?: string } | null }>;
    const { error } = await rpc('add_to_list', { ...request });
    if (error) throw toAdapterError(error);
  }
}
