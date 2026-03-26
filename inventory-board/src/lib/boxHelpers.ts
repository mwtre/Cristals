import type { Id, ItemCard, LocationState } from '../types';

export function isBoxItem(it: ItemCard | undefined): boolean {
  return it?.kind === 'box';
}

export function containedPiecesQty(itemsById: Record<Id, ItemCard>, box: ItemCard): number {
  return (box.containedItemIds ?? []).reduce((sum, id) => sum + (itemsById[id]?.qty ?? 0), 0);
}

/** Location roll-up: box counts as its qty plus all pieces inside nested cards. */
export function locationTotal(locId: Id, st: LocationState): number {
  const itemIds = st.locationItemIds[locId] ?? [];
  return itemIds.reduce((sum, itemId) => {
    const it = st.itemsById[itemId];
    if (!it) return sum;
    if (it.kind === 'box') {
      return sum + it.qty + containedPiecesQty(st.itemsById, it);
    }
    return sum + it.qty;
  }, 0);
}

/** Remove item from parent's contained list and clear parentBoxItemId (item not yet in any location list). */
export function detachFromParentBox(st: LocationState, itemId: Id): LocationState {
  const item = st.itemsById[itemId];
  if (!item?.parentBoxItemId) return st;
  const pid = item.parentBoxItemId;
  const parent = st.itemsById[pid];
  const nextItems = { ...st.itemsById };
  if (parent?.kind === 'box') {
    nextItems[pid] = {
      ...parent,
      containedItemIds: (parent.containedItemIds ?? []).filter((id) => id !== itemId),
    };
  }
  nextItems[itemId] = { ...item, parentBoxItemId: undefined };
  return { ...st, itemsById: nextItems };
}
