import type {
  FieldTimestamps,
  IsoTimestamp,
  ListItem,
  ListItemFields,
  ListItemRowData,
  RowId,
} from '../types.js';

export const TEST_NOW = '2026-01-01T00:00:00.000Z';

/** Deterministische, monotone Uhr für Tests. */
export function fixedClock(start: IsoTimestamp = TEST_NOW, stepMs = 1): () => IsoTimestamp {
  let millis = Date.parse(start);
  return () => {
    const current = new Date(millis).toISOString();
    millis += stepMs;
    return current;
  };
}

export interface MakeListItemMeta {
  id?: RowId;
  updated_at?: IsoTimestamp;
  deleted_at?: IsoTimestamp | null;
  field_updated_at?: FieldTimestamps<ListItemFields>;
}

export function makeListItem(
  overrides: Partial<ListItemFields> & { id?: RowId } = {},
  meta: MakeListItemMeta = {},
): ListItem {
  const { id: overrideId, ...fieldOverrides } = overrides;
  const updatedAt = meta.updated_at ?? TEST_NOW;
  const fields: ListItemFields = {
    list_id: 'list-1',
    name: 'Milch',
    name_normalized: 'milch',
    quantity: 1,
    unit: 'l',
    category_id: null,
    checked: false,
    checked_by: null,
    source_recipe_id: null,
    note: null,
    ...fieldOverrides,
  };
  const timestamps: FieldTimestamps<ListItemFields> = {};
  for (const key of Object.keys(fields) as (keyof ListItemFields)[]) {
    timestamps[key] = updatedAt;
  }
  return {
    id: meta.id ?? overrideId ?? 'item-1',
    updated_at: updatedAt,
    deleted_at: meta.deleted_at ?? null,
    field_updated_at: { ...timestamps, ...meta.field_updated_at },
    fields,
  };
}

export function toRowData(item: ListItem): ListItemRowData {
  return { ...item.fields, id: item.id };
}
