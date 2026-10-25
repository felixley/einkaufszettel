'use client';

import Link from 'next/link';
import type { ListItem } from '@einkaufszettel/core';
import styles from '@/app/lists/lists.module.css';

interface Props {
  item: ListItem;
  onToggle: (item: ListItem) => void;
  onDelete: (item: ListItem) => void;
}

export function ListItemRow({ item, onToggle, onDelete }: Props) {
  const { fields } = item;
  const quantityText =
    fields.quantity !== null ? `${fields.quantity} ${fields.unit ?? ''}`.trim() : '';

  return (
    <div className={styles.itemRow} data-testid="list-item">
      <button
        type="button"
        className={`${styles.checkbox} ${fields.checked ? styles.checked : ''}`}
        onClick={() => onToggle(item)}
        aria-label={fields.checked ? 'Abhaken rückgängig' : 'Abhaken'}
      />
      <Link href={`/list/${item.id}`} className={styles.itemContent}>
        <div className={styles.itemName}>{fields.name}</div>
        {quantityText && <div className={styles.itemDetails}>{quantityText}</div>}
      </Link>
      <button
        type="button"
        className={styles.deleteBtn}
        onClick={() => onDelete(item)}
        aria-label="Löschen"
        data-testid="delete-btn"
      >
        ✕
      </button>
    </div>
  );
}
