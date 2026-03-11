import { useEffect, useMemo, useRef, useState } from 'react';
import type { Id, ItemCard, Location, LocationState, Movement, RemotePayload } from '../types';
import { hasSupabaseEnv, loadLocal, loadRemote, newEmptyState, saveLocal, saveRemote } from '../lib/storage';

function uid(prefix: string): Id {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clampQty(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function locationTotal(locId: Id, st: LocationState): number {
  const itemIds = st.locationItemIds[locId] ?? [];
  return itemIds.reduce((sum, itemId) => sum + (st.itemsById[itemId]?.qty ?? 0), 0);
}

function findLocationById(st: LocationState, id: Id): Location | undefined {
  return st.locations.find((l) => l.id === id);
}

function sortMovementsDesc(a: Movement, b: Movement) {
  return b.ts.localeCompare(a.ts);
}

type DragPayload = { itemId: Id; fromLocationId: Id };
type DragPayloadV2 = { itemId: Id; fromLocationId: Id; type: 'item' };

export function InventoryBoardApp() {
  const [state, setState] = useState<LocationState>(() => newEmptyState().state);
  const [movements, setMovements] = useState<Movement[]>(() => newEmptyState().movements);
  const [selectedLocationId, setSelectedLocationId] = useState<Id | null>(null);
  const [status, setStatus] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(() => hasSupabaseEnv());
  const [movementQuery, setMovementQuery] = useState('');
  const [isManualOpen, setIsManualOpen] = useState(false);
  const [manualFrom, setManualFrom] = useState<Id>('incoming');
  const [manualTo, setManualTo] = useState<Id>('');
  const [manualLabel, setManualLabel] = useState('');
  const [manualQty, setManualQty] = useState<number>(1);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    floor: false,
    processing: false,
    pod: false,
    storage: false,
    shopifyRacks: false,
    waste: false,
    other: false,
  });

  const syncTimer = useRef<number | null>(null);
  const isOnlineRef = useRef<boolean>(hasSupabaseEnv());
  const activeItemDrag = useRef<DragPayloadV2 | null>(null);

  const selectedLocation = useMemo(
    () => (selectedLocationId ? findLocationById(state, selectedLocationId) : undefined),
    [selectedLocationId, state],
  );

  const selectedItems = useMemo(() => {
    if (!selectedLocationId) return [];
    const itemIds = state.locationItemIds[selectedLocationId] ?? [];
    return itemIds.map((id) => state.itemsById[id]).filter(Boolean);
  }, [selectedLocationId, state]);

  const totalsReport = useMemo(() => {
    const groupsOrder = [
      { key: 'floor', title: 'FLOOR' },
      { key: 'processing', title: 'PROCESSING' },
      { key: 'pod', title: 'POD' },
      { key: 'storage', title: 'STORAGE' },
      { key: 'shopifyRacks', title: 'SHOPIFY RACKS' },
      { key: 'waste', title: 'WASTE' },
      { key: 'other', title: 'OTHER' },
    ] as const;

    const perLocation = state.locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      group: groupForLocation(loc),
      total: locationTotal(loc.id, state),
    }));

    const perGroup: Record<string, number> = {};
    for (const g of groupsOrder) perGroup[g.key] = 0;
    for (const loc of perLocation) perGroup[loc.group] = (perGroup[loc.group] ?? 0) + loc.total;

    const grandTotal = Object.values(perGroup).reduce((a, b) => a + (b || 0), 0);

    const byItem: Record<string, { label: string; qty: number; color?: string }> = {};
    for (const loc of state.locations) {
      const itemIds = state.locationItemIds[loc.id] ?? [];
      for (const id of itemIds) {
        const it = state.itemsById[id];
        if (!it) continue;
        const key = it.label.trim().toLowerCase();
        if (!key) continue;
        if (!byItem[key]) byItem[key] = { label: it.label, qty: 0, color: it.color };
        byItem[key].qty += it.qty;
      }
    }
    const topItems = Object.values(byItem).sort((a, b) => b.qty - a.qty).slice(0, 25);

    return {
      groupsOrder,
      perGroup,
      perLocation: perLocation.sort((a, b) => b.total - a.total),
      grandTotal,
      topItems,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, state.locations, state.locationItemIds, state.itemsById, state.locationGroupById]);

  function setStatusFlash(msg: string) {
    setStatus(msg);
    window.setTimeout(() => setStatus((s) => (s === msg ? '' : s)), 1800);
  }

  function persist(nextState: LocationState, nextMovements: Movement[]) {
    const payload: RemotePayload = { v: 1, state: nextState, movements: nextMovements.slice(-500) };
    saveLocal(payload);

    if (!isOnlineRef.current) {
      return;
    }
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(async () => {
      try {
        setIsSyncing(true);
        await saveRemote(payload);
        setStatusFlash('Synced');
      } catch {
        setStatusFlash('Sync failed');
      } finally {
        setIsSyncing(false);
      }
    }, 250);
  }

  useEffect(() => {
    const online = hasSupabaseEnv();
    setIsOnline(online);
    isOnlineRef.current = online;
    const local = loadLocal();
    if (local) {
      setState(local.state);
      setMovements(local.movements ?? []);
    }
    // Load remote once (if configured) and prefer it if it has data.
    (async () => {
      const remote = await loadRemote();
      if (!remote) return;
      const hasRemoteData =
        (remote.state?.locations?.length ?? 0) > 0 ||
        Object.keys(remote.state?.itemsById ?? {}).length > 0 ||
        (remote.movements?.length ?? 0) > 0;
      if (!hasRemoteData) return;
      setState(remote.state);
      setMovements(remote.movements ?? []);
      saveLocal(remote);
    })();
  }, []);

  // Ensure legacy/manual overrides don't keep Receiving/Shipping out of FLOOR.
  useEffect(() => {
    if (!state.locations.length) return;
    const map = { ...(state.locationGroupById ?? {}) };
    let changed = false;
    for (const loc of state.locations) {
      const n = normName(loc.name);
      const shouldBeFloor =
        /\bfloor\b/.test(n) || /\bship/.test(n) || /\bexpedit/.test(n) || /\breceiv/.test(n) || /\brecev/.test(n);
      if (!shouldBeFloor) continue;
      if (map[loc.id] !== 'floor') {
        map[loc.id] = 'floor';
        changed = true;
      }
    }
    if (!changed) return;
    const nextState: LocationState = { ...state, locationGroupById: map };
    setState(nextState);
    persist(nextState, movements);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.locations]);

  // Ensure Rack 1/2/3 always live in SHOPIFY RACKS.
  useEffect(() => {
    if (!state.locations.length) return;
    const map = { ...(state.locationGroupById ?? {}) };
    let changed = false;
    for (const loc of state.locations) {
      const n = normName(loc.name);
      const isRack = /\bracks?\s*0*[123]\b/.test(n) || /^racks?\s*0*[123]\b/.test(n);
      if (!isRack) continue;
      if (map[loc.id] !== 'shopifyRacks') {
        map[loc.id] = 'shopifyRacks';
        changed = true;
      }
    }
    if (!changed) return;
    const nextState: LocationState = { ...state, locationGroupById: map };
    setState(nextState);
    persist(nextState, movements);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.locations]);

  // Ensure SHL*/SHR* locations always live in STORAGE (unless they are forced to FLOOR/SHOPIFY RACKS).
  useEffect(() => {
    if (!state.locations.length) return;
    const map = { ...(state.locationGroupById ?? {}) };
    let changed = false;
    for (const loc of state.locations) {
      const n = normName(loc.name);
      const shouldBeFloor =
        /\bfloor\b/.test(n) || /\bship/.test(n) || /\bexpedit/.test(n) || /\breceiv/.test(n) || /\brecev/.test(n);
      const isRack = /\bracks?\s*0*[123]\b/.test(n) || /^racks?\s*0*[123]\b/.test(n);
      if (shouldBeFloor || isRack) continue;
      const isStorageCode = /\bshl\w*\b/.test(n) || /\bshr\w*\b/.test(n);
      if (!isStorageCode) continue;
      if (map[loc.id] !== 'storage') {
        map[loc.id] = 'storage';
        changed = true;
      }
    }
    if (!changed) return;
    const nextState: LocationState = { ...state, locationGroupById: map };
    setState(nextState);
    persist(nextState, movements);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.locations]);

  // Ensure POD locations always live in POD group (unless forced elsewhere).
  useEffect(() => {
    if (!state.locations.length) return;
    const map = { ...(state.locationGroupById ?? {}) };
    let changed = false;
    for (const loc of state.locations) {
      const n = normName(loc.name);
      const shouldBeFloor =
        /\bfloor\b/.test(n) || /\bship/.test(n) || /\bexpedit/.test(n) || /\breceiv/.test(n) || /\brecev/.test(n);
      const isRack = /\bracks?\s*0*[123]\b/.test(n) || /^racks?\s*0*[123]\b/.test(n);
      if (shouldBeFloor || isRack) continue;
      const shouldBePod = /\bpod\b/.test(n) || /\bfeeder\b/.test(n);
      if (!shouldBePod) continue;
      if (map[loc.id] !== 'pod') {
        map[loc.id] = 'pod';
        changed = true;
      }
    }
    if (!changed) return;
    const nextState: LocationState = { ...state, locationGroupById: map };
    setState(nextState);
    persist(nextState, movements);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.locations]);

  // Ensure processing locations always live in PROCESSING group.
  useEffect(() => {
    if (!state.locations.length) return;
    const map = { ...(state.locationGroupById ?? {}) };
    let changed = false;
    for (const loc of state.locations) {
      const n = normName(loc.name);
      const shouldBeFloor =
        /\bfloor\b/.test(n) || /\bship/.test(n) || /\bexpedit/.test(n) || /\breceiv/.test(n) || /\brecev/.test(n);
      const isRack = /\bracks?\s*0*[123]\b/.test(n) || /^racks?\s*0*[123]\b/.test(n);
      if (shouldBeFloor || isRack) continue;
      const isProcessing =
        (/\bready\b/.test(n) && /\bproduction\b/.test(n)) ||
        /\bin production\b/.test(n) ||
        (/\bproduction\b/.test(n) && (/\bfinished\b/.test(n) || /\bdone\b/.test(n))) ||
        /\bproductioin\b/.test(n) ||
        n === 'production' ||
        n === 'prod' ||
        /^production\b/.test(n);
      if (!isProcessing) continue;
      if (map[loc.id] !== 'processing') {
        map[loc.id] = 'processing';
        changed = true;
      }
    }
    if (!changed) return;
    const nextState: LocationState = { ...state, locationGroupById: map };
    setState(nextState);
    persist(nextState, movements);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.locations]);

  // Ensure redo/rejected always live in WASTE group.
  useEffect(() => {
    if (!state.locations.length) return;
    const map = { ...(state.locationGroupById ?? {}) };
    let changed = false;
    for (const loc of state.locations) {
      const n = normName(loc.name);
      const shouldBeFloor =
        /\bfloor\b/.test(n) || /\bship/.test(n) || /\bexpedit/.test(n) || /\breceiv/.test(n) || /\brecev/.test(n);
      const isRack = /\bracks?\s*0*[123]\b/.test(n) || /^racks?\s*0*[123]\b/.test(n);
      if (shouldBeFloor || isRack) continue;
      const isWaste = /\brejected\b/.test(n) || /\breject\b/.test(n) || /\bredo\b/.test(n);
      if (!isWaste) continue;
      if (map[loc.id] !== 'waste') {
        map[loc.id] = 'waste';
        changed = true;
      }
    }
    if (!changed) return;
    const nextState: LocationState = { ...state, locationGroupById: map };
    setState(nextState);
    persist(nextState, movements);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.locations]);

  // Fill missing colors on legacy items (older local/remote data).
  useEffect(() => {
    const needs = Object.values(state.itemsById).some((it) => it && !(it as any).color);
    if (!needs) return;
    const nextItemsById: Record<Id, ItemCard> = { ...state.itemsById } as any;
    for (const [k, it] of Object.entries(state.itemsById)) {
      if (!it) continue;
      if (!(it as any).color) {
        nextItemsById[k] = { ...(it as any), color: colorForLabel((it as any).label ?? '') };
      }
    }
    const nextState: LocationState = { ...state, itemsById: nextItemsById };
    setState(nextState);
    persist(nextState, movements);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.itemsById]);

  function createLocation() {
    const name = window.prompt('Location name?')?.trim();
    if (!name) return;
    setState((prev) => {
      const id = uid('loc');
      const loc: Location = { id, name, createdAt: new Date().toISOString() };
      const next: LocationState = {
        ...prev,
        locations: [...prev.locations, loc],
        locationItemIds: { ...prev.locationItemIds, [id]: [] },
      };
      persist(next, movements);
      return next;
    });
    setStatusFlash('Location created');
  }

  function promptMoveQty(maxQty: number): number | null {
    if (maxQty <= 1) return 1;
    const raw = window.prompt(`How many do you want to move? (1–${maxQty})`, String(maxQty));
    if (raw === null) return null;
    const q = clampQty(Number(raw));
    if (q < 1 || q > maxQty) return null;
    return q;
  }

  function deleteLocation(locId: Id) {
    const loc = findLocationById(state, locId);
    if (!loc) return;
    const ok = window.confirm(`Delete location "${loc.name}"? Items will be lost.`);
    if (!ok) return;

    const itemIds = state.locationItemIds[locId] ?? [];
    const nextItemsById = { ...state.itemsById };
    for (const id of itemIds) delete nextItemsById[id];

    const nextState: LocationState = {
      locations: state.locations.filter((l) => l.id !== locId),
      locationItemIds: Object.fromEntries(Object.entries(state.locationItemIds).filter(([k]) => k !== locId)),
      itemsById: nextItemsById,
    };
    setState(nextState);
    if (selectedLocationId === locId) setSelectedLocationId(null);
    persist(nextState, movements);
    setStatusFlash('Location deleted');
  }

  function addItemToLocation(locId: Id) {
    const label = window.prompt('Item name / label?')?.trim();
    if (!label) return;
    const qtyRaw = window.prompt('Quantity?', '1')?.trim() ?? '';
    const qty = clampQty(Number(qtyRaw));
    if (qty <= 0) return;

    const loc = findLocationById(state, locId);
    if (!loc) return;

    const color = colorForLabel(label);
    const item: ItemCard = { id: uid('item'), label, qty, color, createdAt: new Date().toISOString() };
    const nextState: LocationState = {
      ...state,
      itemsById: { ...state.itemsById, [item.id]: item },
      locationItemIds: {
        ...state.locationItemIds,
        [locId]: [...(state.locationItemIds[locId] ?? []), item.id],
      },
    };
    const mv: Movement = {
      id: uid('mv'),
      ts: new Date().toISOString(),
      fromLocationId: 'incoming',
      fromLocationName: 'Incoming',
      toLocationId: locId,
      toLocationName: loc.name,
      itemId: item.id,
      itemLabel: item.label,
      qty: item.qty,
    };
    const nextMovements = [...movements, mv].slice(-500);
    setState(nextState);
    setMovements(nextMovements);
    persist(nextState, nextMovements);
    setStatusFlash('Item added');
  }

  function removeItem(itemId: Id) {
    if (!selectedLocationId || !selectedLocation) return;
    const item = state.itemsById[itemId];
    if (!item) return;
    const ok = window.confirm(`Remove "${item.label}" from "${selectedLocation.name}"?`);
    if (!ok) return;

    const nextItemsById = { ...state.itemsById };
    delete nextItemsById[itemId];
    const nextLocItemIds = (state.locationItemIds[selectedLocationId] ?? []).filter((id) => id !== itemId);
    const nextState: LocationState = {
      ...state,
      itemsById: nextItemsById,
      locationItemIds: { ...state.locationItemIds, [selectedLocationId]: nextLocItemIds },
    };
    const mv: Movement = {
      id: uid('mv'),
      ts: new Date().toISOString(),
      fromLocationId: selectedLocationId,
      fromLocationName: selectedLocation.name,
      toLocationId: 'shipped',
      toLocationName: 'Removed',
      itemId,
      itemLabel: item.label,
      qty: item.qty,
    };
    const nextMovements = [...movements, mv].slice(-500);
    setState(nextState);
    setMovements(nextMovements);
    persist(nextState, nextMovements);
    setStatusFlash('Item removed');
  }

  function sameKind(a: ItemCard, b: ItemCard): boolean {
    return a.label.trim().toLowerCase() === b.label.trim().toLowerCase();
  }

  function mergeIntoTarget(payload: DragPayload, targetLocationId: Id, targetItemId: Id) {
    const source = state.itemsById[payload.itemId];
    const target = state.itemsById[targetItemId];
    if (!source || !target) return;
    if (payload.itemId === targetItemId) return;
    if (!sameKind(source, target)) return;

    const fromLoc = findLocationById(state, payload.fromLocationId);
    const toLoc = findLocationById(state, targetLocationId);
    if (!fromLoc || !toLoc) return;

    const qtyToMove = promptMoveQty(source.qty);
    if (!qtyToMove) return;

    const nextItemsById: Record<Id, ItemCard> = { ...state.itemsById };
    const nextLocationItemIds: Record<Id, Id[]> = { ...state.locationItemIds };

    // Add qty into target
    nextItemsById[targetItemId] = { ...target, qty: target.qty + qtyToMove };

    if (qtyToMove === source.qty) {
      // remove source item completely
      delete nextItemsById[payload.itemId];
      nextLocationItemIds[payload.fromLocationId] = (state.locationItemIds[payload.fromLocationId] ?? []).filter(
        (id) => id !== payload.itemId,
      );
      if (payload.fromLocationId !== targetLocationId) {
        // already removed from fromLocation; no need to add anywhere
      }
    } else {
      // reduce source qty
      nextItemsById[payload.itemId] = { ...source, qty: source.qty - qtyToMove };
    }

    // If source item is in a different location and we only moved part, we do not create a new item card;
    // we just "transfer qty" into the target card.
    const nextState: LocationState = {
      ...state,
      itemsById: nextItemsById,
      locationItemIds: nextLocationItemIds,
    };

    const mv: Movement = {
      id: uid('mv'),
      ts: new Date().toISOString(),
      fromLocationId: fromLoc.id,
      fromLocationName: fromLoc.name,
      toLocationId: toLoc.id,
      toLocationName: toLoc.name,
      itemId: targetItemId,
      itemLabel: target.label,
      qty: qtyToMove,
    };

    const nextMovements = [...movements, mv].slice(-500);
    setState(nextState);
    setMovements(nextMovements);
    persist(nextState, nextMovements);
    setStatusFlash('Merged');
  }

  function moveItem(payload: DragPayload, toLocationId: Id) {
    if (payload.fromLocationId === toLocationId) return;
    const item = state.itemsById[payload.itemId];
    if (!item) return;
    const fromLoc = findLocationById(state, payload.fromLocationId);
    const toLoc = findLocationById(state, toLocationId);
    if (!fromLoc || !toLoc) return;

    const qtyToMove = promptMoveQty(item.qty);
    if (!qtyToMove) return;

    let nextState: LocationState = state;
    if (qtyToMove === item.qty) {
      const fromIds = (state.locationItemIds[payload.fromLocationId] ?? []).filter((id) => id !== payload.itemId);
      const toIds = [...(state.locationItemIds[toLocationId] ?? []), payload.itemId];
      nextState = {
        ...state,
        locationItemIds: {
          ...state.locationItemIds,
          [payload.fromLocationId]: fromIds,
          [toLocationId]: toIds,
        },
      };
    } else {
      const remaining = item.qty - qtyToMove;
      const newItemId = uid('item');
      const newItem: ItemCard = {
        ...item,
        id: newItemId,
        qty: qtyToMove,
        createdAt: new Date().toISOString(),
      };
      const fromIds = (state.locationItemIds[payload.fromLocationId] ?? []).slice();
      const toIds = [...(state.locationItemIds[toLocationId] ?? []), newItemId];
      const nextItemsById: Record<Id, ItemCard> = {
        ...state.itemsById,
        [payload.itemId]: { ...item, qty: remaining },
        [newItemId]: newItem,
      };
      nextState = {
        ...state,
        itemsById: nextItemsById,
        locationItemIds: {
          ...state.locationItemIds,
          [payload.fromLocationId]: fromIds,
          [toLocationId]: toIds,
        },
      };
    }
    const mv: Movement = {
      id: uid('mv'),
      ts: new Date().toISOString(),
      fromLocationId: fromLoc.id,
      fromLocationName: fromLoc.name,
      toLocationId: toLoc.id,
      toLocationName: toLoc.name,
      itemId: item.id,
      itemLabel: item.label,
      qty: qtyToMove,
    };
    const nextMovements = [...movements, mv].slice(-500);
    setState(nextState);
    setMovements(nextMovements);
    persist(nextState, nextMovements);
    setStatusFlash('Moved');
  }

  function reorderItemInLocation(locationId: Id, itemId: Id, toIndex: number) {
    const ids = state.locationItemIds[locationId] ?? [];
    const fromIndex = ids.indexOf(itemId);
    if (fromIndex < 0) return;
    const nextIds = ids.slice();
    nextIds.splice(fromIndex, 1);
    const safeIndex = Math.max(0, Math.min(nextIds.length, toIndex));
    nextIds.splice(safeIndex, 0, itemId);
    const nextState: LocationState = {
      ...state,
      locationItemIds: { ...state.locationItemIds, [locationId]: nextIds },
    };
    setState(nextState);
    persist(nextState, movements);
    setStatusFlash('Reordered');
  }

  function parseDragPayload(raw: string): DragPayloadV2 | null {
    try {
      const p = JSON.parse(raw) as any;
      if (!p || p.type !== 'item') return null;
      if (typeof p.itemId !== 'string' || typeof p.fromLocationId !== 'string') return null;
      return p as DragPayloadV2;
    } catch {
      return null;
    }
  }

  function normName(s: string): string {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function autoGroupForLocationName(name: string): string {
    const n = normName(name);
    // Floor: receiving/shipping/floor
    if (/\bfloor\b/.test(n)) return 'floor';
    if (/\breceiv/.test(n) || /\brecev/.test(n)) return 'floor';
    if (/\bship/.test(n) || /\bexpedit/.test(n)) return 'floor';
    // Waste
    if (/\brejected\b/.test(n) || /\breject\b/.test(n) || /\bredo\b/.test(n) || /\bwaste\b/.test(n)) return 'waste';
    // Processing
    if (/\bready\b/.test(n) && /\bproduction\b/.test(n)) return 'processing';
    if (/\bin production\b/.test(n) || (/\bproduction\b/.test(n) && /\bin\b/.test(n))) return 'processing';
    if (/\bproduction\b/.test(n) && (/\bfinished\b/.test(n) || /\bdone\b/.test(n))) return 'processing';
    if (/\bproductioin\b/.test(n)) return 'processing';
    if (n === 'production' || n === 'prod' || /^production\b/.test(n)) return 'processing';
    // Pods
    if (/\bpod\b/.test(n)) return 'pod';
    if (/\bfeeder\b/.test(n)) return 'pod';
    // Shopify racks: "rack 1/2/3" (accept "racks", "rack01", etc.)
    if (/^racks?\s*0*[123]\b/.test(n) || /\bracks?\s*0*[123]\b/.test(n)) return 'shopifyRacks';
    // Storage: SHRB/SHRA/SHLA/SHRA left/right variants etc (tolerant)
    if (/\bshl\w*\b/.test(n) || /\bshr\w*\b/.test(n)) return 'storage';
    return 'other';
  }

  function groupForLocation(loc: Location): string {
    const overrides = state.locationGroupById ?? {};
    const ov = overrides[loc.id];
    return ov || autoGroupForLocationName(loc.name);
  }

  const groups = useMemo(() => {
    const byGroup: Record<string, Location[]> = {
      floor: [],
      processing: [],
      pod: [],
      storage: [],
      shopifyRacks: [],
      waste: [],
      other: [],
    };
    for (const loc of state.locations) {
      const g = groupForLocation(loc);
      (byGroup[g] ?? (byGroup[g] = [])).push(loc);
    }
    return byGroup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.locations, state.locationGroupById]);

  // Location arranging intentionally removed (grouping is auto/forced).

  function colorForLabel(label: string): string {
    const s = (label || '').trim().toLowerCase();
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const palette = [
      '#60a5fa', // blue
      '#34d399', // green
      '#fbbf24', // amber
      '#f87171', // red
      '#a78bfa', // violet
      '#22d3ee', // cyan
      '#fb7185', // rose
      '#f97316', // orange
    ];
    return palette[h % palette.length];
  }

  return (
    <div className="ib-wrap">
      <div className="ib-topbar">
        <div className="ib-title">Inventory board</div>
        <div className="ib-actions">
          <button className="ib-btn" onClick={createLocation}>
            + Create location
          </button>
          <button className="ib-btn" onClick={() => setIsManualOpen(true)}>
            + Manual movement
          </button>
          <span className="ib-status">
            {isOnline ? (isSyncing ? 'Syncing…' : status ? status : '') : status ? status : 'Offline'}
          </span>
        </div>
      </div>

      <div className="ib-grid">
        <div className="ib-locations">
          {state.locations.length === 0 ? (
            <div className="ib-empty">
              No locations yet. Click <strong>Create location</strong>.
            </div>
          ) : (
            ([
              { key: 'floor', title: 'FLOOR' },
              { key: 'processing', title: 'PROCESSING' },
              { key: 'pod', title: 'POD' },
              { key: 'storage', title: 'STORAGE' },
              { key: 'shopifyRacks', title: 'SHOPIFY RACKS' },
              { key: 'waste', title: 'WASTE' },
              { key: 'other', title: 'OTHER' },
            ] as const).map((g) => {
              const list = groups[g.key] ?? [];
              const collapsed = !!collapsedGroups[g.key];
              return (
                <div key={g.key} className="ib-group">
                  <div
                    className="ib-group-head"
                    role="button"
                    tabIndex={0}
                    onClick={() => setCollapsedGroups((p) => ({ ...p, [g.key]: !p[g.key] }))}
                  >
                    <div className="ib-group-title">{g.title}</div>
                    <div className="ib-group-meta">
                      {list.length} location(s) · {collapsed ? 'Show' : 'Hide'}
                    </div>
                  </div>
                  {!collapsed ? (
                    <div className="ib-group-body">
                      {list.map((loc) => {
                        const total = locationTotal(loc.id, state);
                        const itemIds = state.locationItemIds[loc.id] ?? [];
                        return (
                          <div
                            key={loc.id}
                            className={`ib-loc ${selectedLocationId === loc.id ? 'is-selected' : ''}`}
                            onClick={() => setSelectedLocationId(loc.id)}
                            onDragOver={(e) => {
                              if (activeItemDrag.current) e.preventDefault();
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const p = activeItemDrag.current;
                              if (!p) return;
                              moveItem(p, loc.id);
                            }}
                          >
                            <div className="ib-loc-head">
                              <div className="ib-loc-name">{loc.name}</div>
                              <div className="ib-loc-total">{total}</div>
                            </div>
                            <div className="ib-loc-sub">{itemIds.length} item(s)</div>
                            <div className="ib-cards">
                              {itemIds.map((itemId) => {
                                const item = state.itemsById[itemId];
                                if (!item) return null;
                                const index = itemIds.indexOf(itemId);
                                return (
                                  <div
                                    key={item.id}
                                    className="ib-card"
                                    draggable
                                    data-item-id={item.id}
                                    onDragStart={(e) => {
                                      const payload: DragPayloadV2 = { type: 'item', itemId: item.id, fromLocationId: loc.id };
                                      e.dataTransfer.setData('application/json', JSON.stringify(payload));
                                      e.dataTransfer.effectAllowed = 'move';
                                      activeItemDrag.current = payload;
                                    }}
                                    onDragEnd={() => {
                                      activeItemDrag.current = null;
                                    }}
                                    onDragOver={(e) => {
                                      if (activeItemDrag.current) e.preventDefault();
                                    }}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      const p = activeItemDrag.current;
                                      if (!p) return;
                                      const source = state.itemsById[p.itemId];
                                      const target = state.itemsById[item.id];
                                      if (source && target && sameKind(source, target)) {
                                        mergeIntoTarget(p, loc.id, item.id);
                                        return;
                                      }
                                      if (p.fromLocationId === loc.id) {
                                        reorderItemInLocation(loc.id, p.itemId, index);
                                        return;
                                      }
                                      moveItem(p, loc.id);
                                    }}
                                    title="Drag to another location"
                                    style={{ borderLeftColor: item.color || '#c9a962' }}
                                  >
                                    <div className="ib-card-label">{item.label}</div>
                                    <div className="ib-card-qty">{item.qty}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <div className="ib-side">
          <div className="ib-panel">
            <div className="ib-panel-title">Location details</div>
            {!selectedLocation ? (
              <div className="ib-panel-muted">Click a location to manage items.</div>
            ) : (
              <>
                <div className="ib-panel-row">
                  <div className="ib-panel-label">Name</div>
                  <div className="ib-panel-value">{selectedLocation.name}</div>
                </div>
                <div className="ib-panel-row">
                  <div className="ib-panel-label">Total</div>
                  <div className="ib-panel-value">{locationTotal(selectedLocation.id, state)}</div>
                </div>
                <div className="ib-panel-actions">
                  <button className="ib-btn" onClick={() => addItemToLocation(selectedLocation.id)}>
                    + Add item
                  </button>
                  <button className="ib-btn ib-btn-danger" onClick={() => deleteLocation(selectedLocation.id)}>
                    Delete location
                  </button>
                </div>

                <div className="ib-items-title">Items</div>
                {selectedItems.length === 0 ? (
                  <div className="ib-panel-muted">No items in this location.</div>
                ) : (
                  <div className="ib-items">
                    {selectedItems.map((it) => (
                      <div key={it.id} className="ib-item-row">
                        <div className="ib-item-main">
                          <div className="ib-item-label">{it.label}</div>
                          <div className="ib-item-qty">{it.qty}</div>
                        </div>
                        <button className="ib-mini-btn" onClick={() => removeItem(it.id)}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="ib-panel">
            <div className="ib-panel-title">Movements chronology</div>
            <div className="ib-move-search">
              <input
                className="ib-input"
                value={movementQuery}
                onChange={(e) => setMovementQuery(e.target.value)}
                placeholder="Search item / from / to…"
              />
            </div>
            {movements.length === 0 ? (
              <div className="ib-panel-muted">No movements yet.</div>
            ) : (
              <div className="ib-moves">
                {movements
                  .slice()
                  .sort(sortMovementsDesc)
                  .filter((m) => {
                    const q = movementQuery.trim().toLowerCase();
                    if (!q) return true;
                    const hay =
                      `${m.itemLabel} ${m.fromLocationName} ${m.toLocationName}`.toLowerCase();
                    return hay.includes(q);
                  })
                  .slice(0, 150)
                  .map((m) => {
                    const d = new Date(m.ts);
                    const ds = Number.isFinite(d.getTime()) ? d.toLocaleString() : m.ts;
                    return (
                      <div key={m.id} className="ib-move">
                        <div className="ib-move-top">
                          <div className="ib-move-qty">{m.qty}</div>
                          <div className="ib-move-label">{m.itemLabel}</div>
                          <button
                            className="ib-mini-btn"
                            onClick={() => {
                              const ok = window.confirm('Delete this movement record? (This will not change totals.)');
                              if (!ok) return;
                              const next = movements.filter((x) => x.id !== m.id);
                              setMovements(next);
                              persist(state, next);
                              setStatusFlash('Movement deleted');
                            }}
                            title="Delete movement record"
                          >
                            Delete
                          </button>
                        </div>
                        <div className="ib-move-sub">
                          <span className="ib-move-from">{m.fromLocationName}</span>
                          <span className="ib-move-arrow">→</span>
                          <span className="ib-move-to">{m.toLocationName}</span>
                          <span className="ib-move-time">{ds}</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          <div className="ib-panel">
            <div className="ib-panel-title">Totals report</div>
            <div className="ib-kpis">
              <div className="ib-kpi">
                <div className="ib-kpi-label">Total items</div>
                <div className="ib-kpi-value">{totalsReport.grandTotal}</div>
              </div>
              <div className="ib-kpi">
                <div className="ib-kpi-label">Locations</div>
                <div className="ib-kpi-value">{state.locations.length}</div>
              </div>
              <div className="ib-kpi">
                <div className="ib-kpi-label">Unique items</div>
                <div className="ib-kpi-value">{totalsReport.topItems.length}</div>
              </div>
            </div>

            <div className="ib-report-section">
              <div className="ib-report-title">By group</div>
              <div className="ib-report-grid">
                {totalsReport.groupsOrder.map((g) => (
                  <div key={g.key} className="ib-report-row">
                    <div className="ib-report-name">{g.title}</div>
                    <div className="ib-report-val">{totalsReport.perGroup[g.key] ?? 0}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="ib-report-section">
              <div className="ib-report-title">Top locations</div>
              <div className="ib-report-grid">
                {totalsReport.perLocation.slice(0, 12).map((l) => (
                  <div key={l.id} className="ib-report-row">
                    <div className="ib-report-name">{l.name}</div>
                    <div className="ib-report-val">{l.total}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="ib-report-section">
              <div className="ib-report-title">Top items</div>
              <div className="ib-report-grid">
                {totalsReport.topItems.slice(0, 12).map((it) => (
                  <div key={it.label} className="ib-report-row">
                    <div className="ib-report-name">
                      <span className="ib-dot" style={{ background: it.color || '#c9a962' }} />
                      {it.label}
                    </div>
                    <div className="ib-report-val">{it.qty}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {isManualOpen ? (
        <div className="ib-modal" onClick={() => setIsManualOpen(false)}>
          <div className="ib-modal-inner" onClick={(e) => e.stopPropagation()}>
            <div className="ib-modal-head">
              <div className="ib-panel-title">Manual movement</div>
              <button className="ib-mini-btn" onClick={() => setIsManualOpen(false)}>
                Close
              </button>
            </div>
            <div className="ib-form">
              <div className="ib-form-row">
                <label className="ib-form-label">From</label>
                <select className="ib-select" value={manualFrom} onChange={(e) => setManualFrom(e.target.value)}>
                  <option value="incoming">Incoming</option>
                  {state.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ib-form-row">
                <label className="ib-form-label">To</label>
                <select className="ib-select" value={manualTo} onChange={(e) => setManualTo(e.target.value)}>
                  <option value="">Select…</option>
                  <option value="removed">Removed</option>
                  {state.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ib-form-row">
                <label className="ib-form-label">Item</label>
                <input className="ib-input" value={manualLabel} onChange={(e) => setManualLabel(e.target.value)} />
              </div>
              <div className="ib-form-row">
                <label className="ib-form-label">Qty</label>
                <input
                  className="ib-input"
                  type="number"
                  min={1}
                  value={manualQty}
                  onChange={(e) => setManualQty(clampQty(Number(e.target.value)) || 1)}
                />
              </div>
              <div className="ib-panel-actions">
                <button
                  className="ib-btn"
                  onClick={() => {
                    const label = manualLabel.trim();
                    const qty = clampQty(manualQty);
                    if (!label) return setStatusFlash('Enter item');
                    if (!qty) return setStatusFlash('Enter qty');
                    if (!manualTo) return setStatusFlash('Select destination');

                    const toIsRemoved = manualTo === 'removed';
                    const fromIsIncoming = manualFrom === 'incoming';
                    if (fromIsIncoming && toIsRemoved) return setStatusFlash('Invalid move');

                    const toLoc = state.locations.find((l) => l.id === manualTo);
                    const fromLoc = state.locations.find((l) => l.id === manualFrom);

                    // Find a matching item in from location (by label) if not incoming.
                    let nextState = state;
                    let movedItemId = uid('item');
                    let movedColor = colorForLabel(label);
                    if (!fromIsIncoming && fromLoc) {
                      const ids = state.locationItemIds[fromLoc.id] ?? [];
                      const matchId = ids.find((id) => state.itemsById[id]?.label.toLowerCase() === label.toLowerCase());
                      if (!matchId) return setStatusFlash('Item not found in FROM location');
                      const it = state.itemsById[matchId];
                      if (!it) return setStatusFlash('Item missing');
                      if (qty > it.qty) return setStatusFlash('Not enough qty in FROM');
                      movedColor = it.color;
                      if (qty === it.qty) {
                        movedItemId = it.id;
                        if (toIsRemoved) {
                          const nextItems = { ...state.itemsById };
                          delete nextItems[it.id];
                          nextState = {
                            ...state,
                            itemsById: nextItems,
                            locationItemIds: {
                              ...state.locationItemIds,
                              [fromLoc.id]: ids.filter((x) => x !== it.id),
                            },
                          };
                        } else if (toLoc) {
                          nextState = {
                            ...state,
                            locationItemIds: {
                              ...state.locationItemIds,
                              [fromLoc.id]: ids.filter((x) => x !== it.id),
                              [toLoc.id]: [...(state.locationItemIds[toLoc.id] ?? []), it.id],
                            },
                          };
                        }
                      } else {
                        // split
                        const remaining = it.qty - qty;
                        const newItemId = uid('item');
                        movedItemId = newItemId;
                        const nextItems: Record<Id, ItemCard> = {
                          ...state.itemsById,
                          [it.id]: { ...it, qty: remaining },
                          [newItemId]: { ...it, id: newItemId, qty, createdAt: new Date().toISOString() },
                        };
                        if (toIsRemoved) {
                          // just reduce from; new split item is "removed" so do not add anywhere
                          nextState = { ...state, itemsById: nextItems };
                        } else if (toLoc) {
                          nextState = {
                            ...state,
                            itemsById: nextItems,
                            locationItemIds: {
                              ...state.locationItemIds,
                              [toLoc.id]: [...(state.locationItemIds[toLoc.id] ?? []), newItemId],
                            },
                          };
                        }
                      }
                    } else {
                      // incoming -> location creates item
                      if (!toLoc) return setStatusFlash('Select a real destination');
                      const item: ItemCard = {
                        id: movedItemId,
                        label,
                        qty,
                        color: movedColor,
                        createdAt: new Date().toISOString(),
                      };
                      nextState = {
                        ...state,
                        itemsById: { ...state.itemsById, [item.id]: item },
                        locationItemIds: {
                          ...state.locationItemIds,
                          [toLoc.id]: [...(state.locationItemIds[toLoc.id] ?? []), item.id],
                        },
                      };
                    }

                    const mv: Movement = {
                      id: uid('mv'),
                      ts: new Date().toISOString(),
                      fromLocationId: fromIsIncoming ? 'incoming' : fromLoc?.id ?? 'unknown',
                      fromLocationName: fromIsIncoming ? 'Incoming' : fromLoc?.name ?? 'Unknown',
                      toLocationId: toIsRemoved ? 'removed' : toLoc?.id ?? 'unknown',
                      toLocationName: toIsRemoved ? 'Removed' : toLoc?.name ?? 'Unknown',
                      itemId: movedItemId,
                      itemLabel: label,
                      qty,
                    };

                    const nextMovements = [...movements, mv].slice(-500);
                    setState(nextState);
                    setMovements(nextMovements);
                    persist(nextState, nextMovements);
                    setIsManualOpen(false);
                    setManualLabel('');
                    setManualQty(1);
                    setStatusFlash('Saved');
                  }}
                >
                  Save movement
                </button>
              </div>
              <div className="ib-panel-muted">
                Manual movements update totals. Deleting movement records does not change totals.
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

