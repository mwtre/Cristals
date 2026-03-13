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
  const activeWoDrag = useRef<{ woId: string } | null>(null);
  const [scanValue, setScanValue] = useState('');
  const [isWoCreateOpen, setIsWoCreateOpen] = useState(false);
  const [woDraftId, setWoDraftId] = useState('');
  const [woDraftItems, setWoDraftItems] = useState<Array<{ label: string; qty: number }>>([]);

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
    const woById = state.woById ?? {};
    const isArchivedWo = (label: string) => {
      const wo = extractWoId(label);
      return !!(wo && woById[wo]?.status === 'archived');
    };
    const isArchiveLocation = (locName: string) => normName(locName) === 'archive';
    const groupsOrder = [
      { key: 'floor', title: 'FLOOR' },
      { key: 'processing', title: 'PROCESSING' },
      { key: 'pod', title: 'SHOPIFY W/ KIT' },
      { key: 'storage', title: 'STORAGE' },
      { key: 'shopifyRacks', title: 'SHOPIFY W/ FEEDER' },
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

    // Quantities currently inside WOs (allocated, not archived)
    let woTotal = 0;
    const woByItem: Record<string, { label: string; qty: number }> = {};
    for (const wo of Object.values(woById)) {
      if (wo.status === 'archived') continue;
      for (const r of wo.requirements ?? []) {
        const required = r.required ?? (r as any).qty ?? 0;
        const filled = r.filled ?? 0;
        const used = Math.max(0, Math.min(required, filled));
        if (used <= 0) continue;
        woTotal += used;
        const key = r.label.trim().toLowerCase();
        if (!key) continue;
        if (!woByItem[key]) woByItem[key] = { label: r.label, qty: 0 };
        woByItem[key].qty += used;
      }
    }

    const stockTotal = Object.values(perGroup).reduce((a, b) => a + (b || 0), 0);
    const grandTotal = stockTotal + woTotal;

    const byItem: Record<string, { label: string; qty: number; color?: string }> = {};
    for (const loc of state.locations) {
      if (isArchiveLocation(loc.name)) continue;
      const itemIds = state.locationItemIds[loc.id] ?? [];
      for (const id of itemIds) {
        const it = state.itemsById[id];
        if (!it) continue;
        if (isArchivedWo(it.label)) continue;
        const key = it.label.trim().toLowerCase();
        if (!key) continue;
        if (!byItem[key]) byItem[key] = { label: it.label, qty: 0, color: it.color };
        byItem[key].qty += it.qty;
      }
    }
    // Merge WO allocations into top items
    for (const [key, v] of Object.entries(woByItem)) {
      if (!byItem[key]) byItem[key] = { label: v.label, qty: 0 };
      byItem[key].qty += v.qty;
    }
    const topItems = Object.values(byItem).sort((a, b) => b.qty - a.qty).slice(0, 25);

    return {
      groupsOrder,
      perGroup,
      perLocation: perLocation.sort((a, b) => b.total - a.total),
      grandTotal,
      topItems,
      woTotal,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, state.locations, state.locationItemIds, state.itemsById, state.locationGroupById]);

  function normalizeWoId(v: string): string {
    return (v || '').trim().toUpperCase();
  }

  function extractWoId(label: string): string | '' {
    const s = (label || '').trim().toUpperCase();
    // expected "CX1234-0023" or "CX1234"
    const m = s.match(/^([A-Z]{1,4}\d{2,})\b/);
    return m ? m[1] : '';
  }

  function parseScan(code: string): { woId: string; line: string } | null {
    const raw = (code || '').trim().toUpperCase();
    const m = raw.match(/^([A-Z]{1,4}\d{2,})-(\d{1,6})$/);
    if (!m) return null;
    return { woId: m[1], line: m[2].padStart(4, '0') };
  }

  function ensureLocationByName(name: string): Id {
    const n = name.trim();
    const existing = state.locations.find((l) => l.name.trim().toLowerCase() === n.toLowerCase());
    if (existing) return existing.id;
    const id = uid('loc');
    const loc: Location = { id, name: n, createdAt: new Date().toISOString() };
    const nextState: LocationState = {
      ...state,
      locations: [...state.locations, loc],
      locationItemIds: { ...state.locationItemIds, [id]: [] },
      locationGroupById: { ...(state.locationGroupById ?? {}), [id]: 'floor' },
    };
    setState(nextState);
    persist(nextState, movements);
    return id;
  }

  useEffect(() => {
    // Always keep these two FLOOR buckets.
    if (!state.locations.length) return;
    const hasNewWo = state.locations.some((l) => l.name.trim().toLowerCase() === 'new wo');
    const hasArchive = state.locations.some((l) => l.name.trim().toLowerCase() === 'archive');
    if (hasNewWo && hasArchive) return;
    const nextLocations = state.locations.slice();
    const nextLocationItemIds = { ...state.locationItemIds };
    const nextGroupMap = { ...(state.locationGroupById ?? {}) };
    function addIfMissing(nm: string) {
      const ex = nextLocations.find((l) => l.name.trim().toLowerCase() === nm.toLowerCase());
      if (ex) { nextGroupMap[ex.id] = 'floor'; return; }
      const id = uid('loc');
      nextLocations.push({ id, name: nm, createdAt: new Date().toISOString() });
      nextLocationItemIds[id] = nextLocationItemIds[id] ?? [];
      nextGroupMap[id] = 'floor';
    }
    addIfMissing('NEW WO');
    addIfMissing('ARCHIVE');
    const nextState: LocationState = { ...state, locations: nextLocations, locationItemIds: nextLocationItemIds, locationGroupById: nextGroupMap };
    setState(nextState);
    persist(nextState, movements);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.locations]);

  type WoStatus = 'incoming' | 'inProduction' | 'finished' | 'shipping' | 'archived';

  function ensureWo(woId: string, status: WoStatus = 'incoming') {
    const id = normalizeWoId(woId);
    const woById = { ...(state.woById ?? {}) };
    if (!woById[id]) {
      woById[id] = { id, status, createdAt: new Date().toISOString() };
      const nextState: LocationState = { ...state, woById };
      setState(nextState);
      persist(nextState, movements);
    }
  }

  function setWoStatus(woId: string, status: WoStatus) {
    const id = normalizeWoId(woId);
    const woById = { ...(state.woById ?? {}) };
    if (!woById[id]) woById[id] = { id, status, createdAt: new Date().toISOString() };
    woById[id] = { ...woById[id], status };
    const nextState: LocationState = { ...state, woById };
    setState(nextState);
    persist(nextState, movements);
  }

  function getStockPoolLocationIds(): Id[] {
    // Only allow pulling items from "stored inventory" groups.
    const allowedGroups = new Set(['storage', 'shopifyRacks', 'pod']);
    return state.locations.filter((l) => allowedGroups.has(groupForLocation(l))).map((l) => l.id);
  }

  function consumeStock(label: string, qty: number): { ok: boolean; nextState: LocationState } {
    const want = clampQty(qty);
    if (want <= 0) return { ok: false, nextState: state };
    const targetLabel = label.trim().toLowerCase();
    let remaining = want;
    const nextItemsById: Record<Id, ItemCard> = { ...state.itemsById };
    const nextLocItemIds: Record<Id, Id[]> = { ...state.locationItemIds };

    for (const locId of getStockPoolLocationIds()) {
      if (remaining <= 0) break;
      const ids = (nextLocItemIds[locId] ?? []).slice();
      const out: Id[] = [];
      for (const itemId of ids) {
        if (remaining <= 0) { out.push(itemId); continue; }
        const it = nextItemsById[itemId];
        if (!it) continue;
        // Do not consume WO-tracked items.
        if (extractWoId(it.label)) { out.push(itemId); continue; }
        if (it.label.trim().toLowerCase() !== targetLabel) { out.push(itemId); continue; }

        if (it.qty <= remaining) {
          remaining -= it.qty;
          delete nextItemsById[itemId];
          // remove from location
        } else {
          nextItemsById[itemId] = { ...it, qty: it.qty - remaining };
          remaining = 0;
          out.push(itemId);
        }
      }
      nextLocItemIds[locId] = out;
    }

    if (remaining > 0) return { ok: false, nextState: state };
    return { ok: true, nextState: { ...state, itemsById: nextItemsById, locationItemIds: nextLocItemIds } };
  }

  function addWoMaterialLine(woId: string, locId: Id, materialLabel: string, qty: number, baseState: LocationState): LocationState {
    const loc = findLocationById(baseState, locId);
    if (!loc) return baseState;
    const label = `${normalizeWoId(woId)}: ${materialLabel.trim()}`;
    const item: ItemCard = { id: uid('item'), label, qty: clampQty(qty), color: colorForLabel(label), createdAt: new Date().toISOString() };
    return {
      ...baseState,
      itemsById: { ...baseState.itemsById, [item.id]: item },
      locationItemIds: { ...baseState.locationItemIds, [locId]: [...(baseState.locationItemIds[locId] ?? []), item.id] },
      woById: { ...(baseState.woById ?? {}), [normalizeWoId(woId)]: (baseState.woById ?? {})[normalizeWoId(woId)] ?? { id: normalizeWoId(woId), status: 'incoming', createdAt: new Date().toISOString() } },
    };
  }

  function addScannedLineToLocation(locId: Id, woId: string, line: string) {
    const loc = findLocationById(state, locId);
    if (!loc) return;
    const qtyRaw = window.prompt('Qty to add for this line?', '1');
    if (qtyRaw === null) return;
    const qty = clampQty(Number(qtyRaw));
    if (qty <= 0) return;
    const label = `${normalizeWoId(woId)}-${line}`;
    const color = colorForLabel(label);
    const item: ItemCard = { id: uid('item'), label, qty, color, createdAt: new Date().toISOString() };
    const nextState: LocationState = {
      ...state,
      itemsById: { ...state.itemsById, [item.id]: item },
      locationItemIds: { ...state.locationItemIds, [locId]: [...(state.locationItemIds[locId] ?? []), item.id] },
      woById: {
        ...(state.woById ?? {}),
        [normalizeWoId(woId)]: (state.woById ?? {})[normalizeWoId(woId)] ?? {
          id: normalizeWoId(woId),
          status: 'inProduction',
          createdAt: new Date().toISOString(),
        },
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
    setStatusFlash('Scanned');
  }

  function moveWoAllItems(woId: string, toLocId: Id) {
    const id = normalizeWoId(woId);
    const toLoc = findLocationById(state, toLocId);
    if (!toLoc) return;
    const nextLocationItemIds: Record<Id, Id[]> = { ...state.locationItemIds };
    const movedItemIds: { itemId: Id; fromLocId: Id }[] = [];
    for (const loc of state.locations) {
      const ids = nextLocationItemIds[loc.id] ?? [];
      const remain: Id[] = [];
      for (const itemId of ids) {
        const it = state.itemsById[itemId];
        const w = it ? extractWoId(it.label) : '';
        if (w && w === id) {
          movedItemIds.push({ itemId, fromLocId: loc.id });
        } else {
          remain.push(itemId);
        }
      }
      nextLocationItemIds[loc.id] = remain;
    }
    if (movedItemIds.length === 0) {
      setStatusFlash('No items for this WO');
      return;
    }
    nextLocationItemIds[toLocId] = [...(nextLocationItemIds[toLocId] ?? []), ...movedItemIds.map((x) => x.itemId)];
    const nextState: LocationState = { ...state, locationItemIds: nextLocationItemIds };
    const newMoves: Movement[] = [];
    for (const m of movedItemIds) {
      const fromLoc = findLocationById(state, m.fromLocId);
      const it = state.itemsById[m.itemId];
      if (!it) continue;
      newMoves.push({
        id: uid('mv'),
        ts: new Date().toISOString(),
        fromLocationId: m.fromLocId,
        fromLocationName: fromLoc?.name ?? 'Unknown',
        toLocationId: toLocId,
        toLocationName: toLoc.name,
        itemId: it.id,
        itemLabel: it.label,
        qty: it.qty,
      });
    }
    const nextMovements = [...movements, ...newMoves].slice(-500);
    const woById = { ...(nextState.woById ?? {}) };
    const existing = woById[id] ?? { id, status: 'inProduction', createdAt: new Date().toISOString() };
    woById[id] = { ...existing, status: 'inProduction', locationId: toLocId };
    const withWo: LocationState = { ...nextState, woById };
    setState(withWo);
    setMovements(nextMovements);
    persist(withWo, nextMovements);
    setStatusFlash('WO moved');
  }

  function archiveWoAndMoveToArchive(woId: string) {
    const archiveLoc =
      state.locations.find((l) => l.name.trim().toLowerCase() === 'archive') ??
      state.locations.find((l) => l.name.trim().toLowerCase() === 'archive');
    const archiveId = archiveLoc ? archiveLoc.id : ensureLocationByName('ARCHIVE');
    moveWoAllItems(woId, archiveId);
    const id = normalizeWoId(woId);
    const woById = { ...(state.woById ?? {}) };
    const existing = woById[id] ?? { id, status: 'archived', createdAt: new Date().toISOString() };
    woById[id] = { ...existing, status: 'archived', locationId: archiveId };
    const nextState: LocationState = { ...state, woById };
    setState(nextState);
    persist(nextState, movements);
  }

  function assignItemToWo(woId: string) {
    const payload = activeItemDrag.current;
    if (!payload) return;
    const item = state.itemsById[payload.itemId];
    if (!item) return;
    const maxQty = item.qty;
    if (maxQty <= 0) return;

    let qtyStr = window.prompt(
      `Quantity from "${item.label}" to assign to WO ${woId}? (max ${maxQty})`,
      String(maxQty),
    );
    if (!qtyStr) return;
    let qty = Number(qtyStr);
    if (!Number.isFinite(qty) || qty <= 0) return;
    if (qty > maxQty) qty = maxQty;

    // Consume from stock: update items and locationItemIds
    const fromLocId = payload.fromLocationId;
    const fromLoc = findLocationById(state, fromLocId);
    const nextItemsById = { ...state.itemsById };
    const nextLocationItemIds: Record<Id, Id[]> = { ...state.locationItemIds };

    if (qty === maxQty) {
      delete nextItemsById[payload.itemId];
      const ids = (nextLocationItemIds[fromLocId] ?? []).filter((id) => id !== payload.itemId);
      nextLocationItemIds[fromLocId] = ids;
    } else {
      nextItemsById[payload.itemId] = { ...item, qty: item.qty - qty };
    }

    // Record movement into virtual WO location for chronology
    const move: Movement = {
      id: uid('mv'),
      ts: new Date().toISOString(),
      fromLocationId: fromLocId,
      fromLocationName: fromLoc?.name ?? 'Unknown',
      toLocationId: (`wo-${woId}`) as Id,
      toLocationName: `WO ${woId}`,
      itemId: item.id,
      itemLabel: item.label,
      qty,
    };
    const nextMovements = [...movements, move].slice(-500);

    const woById = { ...(state.woById ?? {}) };
    const currentWo = woById[woId];
    if (!currentWo) return;
    const newReqs = (currentWo.requirements ?? []).map((r: any) => {
      const required = r.required ?? r.qty ?? 0;
      const filled = r.filled ?? 0;
      if (r.label === item.label) {
        return { label: r.label, required, filled: filled + qty };
      }
      return { label: r.label, required, filled };
    });

    const allFull = newReqs.length > 0 && newReqs.every((r) => r.filled >= r.required && r.required > 0);

    woById[woId] = {
      ...currentWo,
      requirements: newReqs,
                              status: allFull ? 'inProduction' : currentWo.status,
    };

    const nextState: LocationState = {
      ...state,
      itemsById: nextItemsById,
      locationItemIds: nextLocationItemIds,
      woById,
    };
    setState(nextState);
    setMovements(nextMovements);
    persist(nextState, nextMovements);
    activeItemDrag.current = null;
    setStatusFlash(`Assigned ${qty} of ${item.label} to WO ${woId}`);
  }

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
          <input
            className="ib-input"
            style={{ maxWidth: 220 }}
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            placeholder="Scan CX1234-0023"
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const parsed = parseScan(scanValue);
              if (!parsed) {
                setStatusFlash('Invalid scan');
                return;
              }
              const woId = normalizeWoId(parsed.woId);
              ensureWo(woId, 'inProduction');
              const locId = selectedLocationId || (state.locations[0]?.id ?? '');
              if (!locId) {
                setStatusFlash('Create a location first');
                return;
              }
              addScannedLineToLocation(locId, woId, parsed.line);
              setScanValue('');
            }}
          />
          <button className="ib-btn" onClick={createLocation}>
            + Create location
          </button>
          <button
            className="ib-btn"
            onClick={() => {
              setWoDraftId('');
              setWoDraftItems([]);
              setIsWoCreateOpen(true);
            }}
          >
            + New WO
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
        <div className="ib-wo-pipeline">
          <div className="ib-wo-pipeline-title">Work order timeline</div>
          <div className="ib-wo-stages">
            {[
              { key: 'incoming', title: 'INCOMING', status: 'incoming' as WoStatus },
              { key: 'inProd', title: 'IN PRODUCTION', status: 'inProduction' as WoStatus },
              { key: 'finished', title: 'PRODUCTION FINISHED', status: 'finished' as WoStatus },
              { key: 'shipping', title: 'SHIPPING', status: 'shipping' as WoStatus },
            ].map((stage) => {
              const list = Object.values(state.woById ?? {}).filter((w) => w.status === stage.status);
              return (
                <div
                  key={stage.key}
                  className="ib-wo-stage"
                  onDragOver={(e) => {
                    if (activeWoDrag.current) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!activeWoDrag.current) return;
                    const woId = activeWoDrag.current.woId;
                    activeWoDrag.current = null;
                    // Move WO between timeline stages
                    setWoStatus(woId, stage.status);
                  }}
                >
                  <div className="ib-wo-stage-title">
                    {stage.title} {list.length ? `(${list.length})` : ''}
                  </div>
                  <div
                    className="ib-wo-stage-body"
                    onDragOver={(e) => {
                      if (activeItemDrag.current) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (activeItemDrag.current && list.length === 1) {
                        assignItemToWo(list[0].id);
                      }
                    }}
                  >
                    {list.length === 0 ? (
                      <div className="ib-panel-muted" style={{ fontSize: '0.8rem' }}>
                        –
                      </div>
                    ) : (
                      list.map((wo) => {
                        const reqs = (wo.requirements ?? []).map((r: any) => ({
                          label: r.label,
                          required: r.required ?? r.qty ?? 0,
                          filled: r.filled ?? 0,
                        }));
                        const isFull = reqs.length > 0 && reqs.every((r) => r.filled >= r.required && r.required > 0);
                        return (
                          <div
                            key={wo.id}
                            className={`ib-wo-card ib-wo-card-${wo.status}`}
                            draggable
                            onDragStart={() => {
                              activeWoDrag.current = { woId: wo.id };
                            }}
                            onDragEnd={() => {
                              activeWoDrag.current = null;
                            }}
                            title={`WO ${wo.id}`}
                            onDragOver={(e) => {
                              if (activeItemDrag.current) {
                                e.preventDefault();
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (activeItemDrag.current) assignItemToWo(wo.id);
                            }}
                          >
                            <div className="ib-wo-id">
                              {wo.id}
                              {isFull ? ' ✓' : ''}
                            </div>
                            {reqs.length > 0 ? (
                              <div className="ib-wo-req">
                                {reqs
                                  .slice(0, 2)
                                  .map((r) => `${r.label} ${r.filled}/${r.required}`)
                                  .join(' · ')}
                                {reqs.length > 2 ? ' …' : ''}
                              </div>
                            ) : (
                              <div className="ib-wo-req ib-wo-req-empty">No recipe set</div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="ib-locations">
          {state.locations.length === 0 ? (
            <div className="ib-empty">
              No locations yet. Click <strong>Create location</strong>.
            </div>
          ) : (
            ([
              { key: 'floor', title: 'FLOOR' },
              { key: 'processing', title: 'PROCESSING' },
              { key: 'pod', title: 'SHOPIFY W/ KIT' },
              { key: 'storage', title: 'STORAGE' },
              { key: 'shopifyRacks', title: 'SHOPIFY W/ FEEDER' },
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
                              if (activeItemDrag.current || activeWoDrag.current) e.preventDefault();
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (activeWoDrag.current) {
                                const woId = activeWoDrag.current.woId;
                                activeWoDrag.current = null;
                                const isArchive = loc.name.trim().toLowerCase() === 'archive';
                                if (isArchive) {
                                  archiveWoAndMoveToArchive(woId);
                                } else {
                                  moveWoAllItems(woId, loc.id);
                                }
                                return;
                              }
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
                <div className="ib-kpi-label">Total items (stock + WO)</div>
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
                <div className="ib-report-row">
                  <div className="ib-report-name">WO (allocated)</div>
                  <div className="ib-report-val">{totalsReport.woTotal}</div>
                </div>
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

          <div className="ib-panel">
            <div className="ib-panel-title">Work orders</div>
            {Object.keys(state.woById ?? {}).length === 0 ? (
              <div className="ib-panel-muted">No work orders yet. Use “New WO” or scan `CX1234-0023`.</div>
            ) : (
              <>
                {(
                  [
                    { key: 'incoming', label: 'Incoming (NEW WO)', status: 'incoming' as WoStatus },
                    { key: 'inProduction', label: 'In production', status: 'inProduction' as WoStatus },
                    { key: 'finished', label: 'Production finished', status: 'finished' as WoStatus },
                    { key: 'shipping', label: 'Shipping', status: 'shipping' as WoStatus },
                    { key: 'archived', label: 'Archived', status: 'archived' as WoStatus },
                  ] as const
                ).map((group) => {
                  const list = Object.values(state.woById ?? {})
                    .filter((w) => w.status === group.status)
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
                  return (
                    <div key={group.key} className="ib-report-section">
                      <div className="ib-report-title">{group.label}</div>
                      {list.length === 0 ? (
                        <div className="ib-panel-muted">None.</div>
                      ) : (
                        <div className="ib-report-grid">
                          {list.slice(0, 20).map((wo) => (
                            <div key={wo.id} className="ib-report-row">
                              <div className="ib-report-name">{wo.id}</div>
                              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                                {group.status !== 'archived' ? (
                                  <button
                                    className="ib-mini-btn"
                                    onClick={() => {
                                      const to = window.prompt('Move WO to location name? (must exist)');
                                      if (!to) return;
                                      const match = state.locations.find(
                                        (l) => l.name.trim().toLowerCase() === to.trim().toLowerCase(),
                                      );
                                      if (!match) {
                                        setStatusFlash('Location not found');
                                        return;
                                      }
                                      moveWoAllItems(wo.id, match.id);
                                    }}
                                  >
                                    Move
                                  </button>
                                ) : null}
                                {group.status !== 'archived' ? (
                                  <button className="ib-mini-btn" onClick={() => archiveWoAndMoveToArchive(wo.id)}>
                                    Archive
                                  </button>
                                ) : (
                                  <button className="ib-mini-btn" onClick={() => setWoStatus(wo.id, 'inProduction')}>
                                    Restore
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="ib-panel-muted" style={{ marginTop: '0.6rem' }}>
                  Archived WOs are excluded from totals (treated as used/shipped).
                </div>
              </>
            )}
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

      {isWoCreateOpen ? (
        <div className="ib-modal" onClick={() => setIsWoCreateOpen(false)}>
          <div className="ib-modal-inner" onClick={(e) => e.stopPropagation()}>
            <div className="ib-modal-head">
              <div className="ib-panel-title">New work order (Incoming)</div>
              <button className="ib-mini-btn" onClick={() => setIsWoCreateOpen(false)}>
                Close
              </button>
            </div>

            <div className="ib-form">
              <div className="ib-form-row">
                <label className="ib-form-label">WO</label>
                <input
                  className="ib-input"
                  value={woDraftId}
                  onChange={(e) => setWoDraftId(e.target.value)}
                  autoFocus
                  placeholder="CX1234"
                />
              </div>

              <div className="ib-report-section" style={{ marginTop: 0 }}>
                <div className="ib-report-title">Items needed for production (from stock)</div>
                <div className="ib-panel-muted">
                  Select items that already exist in inventory stock (Storage / Shopify W/ KIT / Shopify W/ FEEDER).
                </div>

                <div className="ib-wo-stock-wrap">
                  <div className="ib-wo-stock">
                    <div className="ib-report-title">Stock items</div>
                    <div className="ib-report-grid">
                      {(() => {
                        const pool: Record<string, number> = {};
                        for (const locId of getStockPoolLocationIds()) {
                          const ids = state.locationItemIds[locId] ?? [];
                          for (const id of ids) {
                            const it = state.itemsById[id];
                            if (!it) continue;
                            if (extractWoId(it.label)) continue;
                            const k = it.label.trim();
                            if (!k) continue;
                            pool[k] = (pool[k] ?? 0) + it.qty;
                          }
                        }
                        const labels = Object.keys(pool).sort();
                        if (labels.length === 0) {
                          return (
                            <div className="ib-panel-muted" style={{ marginTop: '0.3rem' }}>
                              No stock items available.
                            </div>
                          );
                        }
                        return labels.map((label) => (
                          <div
                            key={label}
                            className="ib-report-row"
                            style={{ cursor: 'pointer' }}
                            onClick={() => {
                              setWoDraftItems((prev) => {
                                const existingIdx = prev.findIndex((p) => p.label === label);
                                if (existingIdx >= 0) {
                                  const next = prev.slice();
                                  next[existingIdx] = { ...next[existingIdx], qty: next[existingIdx].qty + 1 };
                                  return next;
                                }
                                return [...prev, { label, qty: 1 }];
                              });
                            }}
                          >
                            <div className="ib-report-name">{label}</div>
                            <div className="ib-report-val">{pool[label]}</div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>

                  <div className="ib-wo-draft">
                    <div className="ib-report-title">Required for this WO</div>
                    {woDraftItems.length === 0 ? (
                      <div className="ib-panel-muted" style={{ marginTop: '0.3rem' }}>
                        Click a stock item to add it here.
                      </div>
                    ) : (
                      <div className="ib-report-grid" style={{ marginTop: '0.3rem' }}>
                        {woDraftItems.map((it, idx) => (
                          <div key={idx} className="ib-report-row">
                            <div className="ib-report-name">{it.label}</div>
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                              <input
                                className="ib-input ib-input-qty"
                                type="number"
                                min={1}
                                value={it.qty}
                                onChange={(e) => {
                                  const q = clampQty(Number(e.target.value));
                                  setWoDraftItems((prev) => {
                                    const next = prev.slice();
                                    next[idx] = { ...next[idx], qty: q || 1 };
                                    return next;
                                  });
                                }}
                                style={{ maxWidth: '70px' }}
                              />
                              <button
                                className="ib-mini-btn"
                                onClick={() => setWoDraftItems((p) => p.filter((_, i) => i !== idx))}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="ib-panel-actions">
                <button
                  className="ib-btn"
                  onClick={() => {
                    const wo = normalizeWoId(woDraftId);
                    if (!wo) { setStatusFlash('Enter WO'); return; }

                    // Ensure locations
                    const newWoLoc = state.locations.find((l) => l.name.trim().toLowerCase() === 'new wo') ?? state.locations.find((l) => l.name.trim().toLowerCase() === 'new wo');
                    const newWoLocId = newWoLoc ? newWoLoc.id : ensureLocationByName('NEW WO');

                    // Do NOT consume stock here; just record recipe and initial location (NEW WO).
                    const woById = { ...(state.woById ?? {}) };
                    const existing = woById[wo] ?? { id: wo, status: 'incoming', createdAt: new Date().toISOString() };
                    woById[wo] = {
                      ...existing,
                      status: 'incoming',
                      locationId: newWoLocId,
                      requirements: woDraftItems.map((it) => ({
                        label: it.label,
                        required: it.qty,
                        filled: 0,
                      })),
                    };
                    const nextState: LocationState = { ...state, woById };

                    setState(nextState);
                    persist(nextState, movements);
                    setIsWoCreateOpen(false);
                    setWoDraftId('');
                    setWoDraftItems([]);
                    setStatusFlash('WO created');
                  }}
                >
                  Create WO
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

