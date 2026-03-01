import { useState, useEffect, useRef } from 'react';
import { FactoryArea } from './types/database';
import type { ProductRoute, RoutePoint } from './types/routes';
import { supabase } from './lib/supabase';
import { getRoutes, getRoutesV2, saveRoutes, saveRoutesV2 } from './lib/routesStorage';
import { fetchRoutesFromSupabase, saveRoutesToSupabase } from './lib/routesSupabase';
import { FactoryMap } from './components/FactoryMap';
import { AreaDetails } from './components/AreaDetails';
import { RoutesPanel } from './components/RoutesPanel';
import { DEFAULT_AREAS, toFactoryAreas } from './data/defaultAreas';

const isEmbedded = () =>
  typeof document !== 'undefined' && !!document.getElementById('factory-map-root');

export default function App() {
  const [viewMode, setViewMode] = useState<'main' | 'v2'>('main');
  const [areas, setAreas] = useState<FactoryArea[]>([]);
  const [areasV2, setAreasV2] = useState<FactoryArea[]>([]);
  const [selectedArea, setSelectedArea] = useState<FactoryArea | null>(null);
  const [routes, setRoutes] = useState<ProductRoute[]>([]);
  const [routesV2, setRoutesV2] = useState<ProductRoute[]>([]);
  const [routesLoaded, setRoutesLoaded] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState<RoutePoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingDemo, setUsingDemo] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);

  const currentRoutes = viewMode === 'main' ? routes : routesV2;
  const currentAreas = viewMode === 'main' ? areas : areasV2;

  const HIDDEN_IDS_KEY = 'cristal_hidden_route_ids';
  const [hiddenRouteIds, setHiddenRouteIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_IDS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  const visibleRoutes = currentRoutes.filter((r) => !hiddenRouteIds.includes(r.id));

  const toggleRouteVisibility = (id: string) => {
    setHiddenRouteIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(HIDDEN_IDS_KEY, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  };

  const handleRoutesChange = async (next: ProductRoute[]) => {
    if (viewMode === 'main') {
      setRoutes(next);
      saveRoutes(next);
      const ok = await saveRoutesToSupabase('main', next);
      if (ok) {
        const fromDb = await fetchRoutesFromSupabase('main');
        if (fromDb.length > 0) setRoutes(fromDb);
      }
    } else {
      setRoutesV2(next);
      saveRoutesV2(next);
      const ok = await saveRoutesToSupabase('v2', next);
      if (ok) {
        const fromDb = await fetchRoutesFromSupabase('v2');
        if (fromDb.length > 0) setRoutesV2(fromDb);
      }
    }
  };

  const handleStartDrawing = () => setDrawingPoints([]);
  const handleDrawingPointAdd = (p: RoutePoint) => {
    setDrawingPoints((prev) => (prev ? [...prev, { x: p.x, y: p.y }] : [{ x: p.x, y: p.y }]));
  };

  const handleSaveDrawing = async (name: string) => {
    if (!drawingPoints || drawingPoints.length < 2) return;
    const newRoute: ProductRoute = {
      id: 'r-' + Date.now(),
      name: name.trim() || 'Route',
      points: drawingPoints.map((p) => ({ x: p.x, y: p.y })),
    };
    const next = [...currentRoutes, newRoute];
    await handleRoutesChange(next);
    setDrawingPoints(null);
    setSavedFeedback(true);
  };
  const handleCancelDrawing = () => setDrawingPoints(null);

  useEffect(() => {
    if (!savedFeedback) return;
    const t = setTimeout(() => setSavedFeedback(false), 2500);
    return () => clearTimeout(t);
  }, [savedFeedback]);

  const fetchAreas = async (): Promise<FactoryArea[]> => {
    setLoading(true);
    try {
      const { data, error: e } = await supabase
        .from('factory_areas')
        .select('*')
        .order('name');
      if (e) throw e;
      const list = (data as FactoryArea[]) ?? [];
      if (list.length > 0) {
        setAreas(list);
        setError(null);
        setUsingDemo(false);
        return list;
      }
      const demo = toFactoryAreas(DEFAULT_AREAS);
      setAreas(demo);
      setUsingDemo(true);
      setError(
        'factory_areas table is empty. Run the full supabase-factory-areas.sql (including the INSERT lines) in Supabase SQL Editor, then click Retry.'
      );
      return demo;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('Factory map: using demo areas', e);
      const demo = toFactoryAreas(DEFAULT_AREAS);
      setAreas(demo);
      setError(
        `Could not load from database: ${msg}. Use the same Supabase project as Production Stats, run supabase-factory-areas.sql in SQL Editor, then click Retry.`
      );
      setUsingDemo(true);
      return demo;
    } finally {
      setLoading(false);
    }
  };

  const fetchAreasV2 = async (): Promise<FactoryArea[]> => {
    try {
      const { data, error: e } = await supabase
        .from('factory_areas_v2')
        .select('*')
        .order('name');
      if (e) throw e;
      const list = (data as FactoryArea[]) ?? [];
      setAreasV2(list);
      return list;
    } catch (e) {
      console.warn('Factory map v2: could not load', e);
      setAreasV2([]);
      return [];
    }
  };

  const copyMainToV2 = async () => {
    if (areas.length === 0 || usingDemo) return;
    try {
      for (const a of areas) {
        if (a.id.startsWith('demo-')) continue;
        await supabase.from('factory_areas_v2').insert({
          name: a.name,
          x: a.x,
          y: a.y,
          width: a.width,
          height: a.height,
          color: a.color,
          status: a.status,
          area_type: a.area_type,
          current_load: 0,
          capacity: a.capacity,
        });
      }
      await fetchAreasV2();
    } catch (e) {
      console.error('Copy main to v2 failed:', e);
    }
  };

  useEffect(() => {
    fetchAreas().then(() => fetchAreasV2());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [mainR, v2R] = await Promise.all([
        fetchRoutesFromSupabase('main'),
        fetchRoutesFromSupabase('v2'),
      ]);
      if (cancelled) return;
      if (mainR.length > 0 || v2R.length > 0) {
        setRoutes(mainR);
        setRoutesV2(v2R);
      } else {
        setRoutes(getRoutes());
        setRoutesV2(getRoutesV2());
      }
      setRoutesLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // When switching to v2 and v2 has no areas, auto-copy main layout once so v2 has squares
  const didAutoCopyV2 = useRef(false);
  useEffect(() => {
    if (viewMode !== 'v2' || didAutoCopyV2.current || areasV2.length > 0 || areas.length === 0 || usingDemo) return;
    didAutoCopyV2.current = true;
    copyMainToV2();
  }, [viewMode, areasV2.length, areas.length, usingDemo]);

  const refetchCurrentAreas = async (): Promise<FactoryArea[]> => {
    return viewMode === 'main' ? fetchAreas() : fetchAreasV2();
  };

  const handleCloneArea = async (source: FactoryArea) => {
    if (source.id.startsWith('demo-')) return;
    const table = viewMode === 'main' ? 'factory_areas' : 'factory_areas_v2';
    const copyName = source.name.replace(/\s*\(copy(?:\s*\d*)?\)\s*$/i, '').trim() + ' (copy)';
    const offset = 40;
    const { data: inserted, error } = await supabase
      .from(table)
      .insert({
        name: copyName,
        x: Math.min(1100, source.x + source.width + offset),
        y: source.y,
        width: source.width,
        height: source.height,
        color: source.color,
        status: source.status,
        area_type: source.area_type,
        current_load: 0,
        capacity: source.capacity,
      })
      .select()
      .single();
    if (error) {
      console.error('Clone failed:', error);
      return;
    }
    await refetchCurrentAreas();
    setSelectedArea(inserted as FactoryArea);
  };

  if (loading) {
    return (
      <div
        className={
          isEmbedded()
            ? 'flex items-center justify-center min-h-[400px] bg-[#1a1a1a] rounded-xl border border-[#2d2d2d]'
            : 'min-h-screen flex items-center justify-center bg-gray-100'
        }
      >
        <div className="flex flex-col items-center gap-3 text-[#888]">
          <div className="w-8 h-8 border-2 border-[var(--accent,#c9a962)] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading factory map…</span>
        </div>
      </div>
    );
  }

  const embedded = isEmbedded();
  const containerClass = embedded
    ? 'factory-map-embedded h-full flex flex-col gap-3'
    : 'min-h-screen bg-gray-100 p-4';

  return (
    <div className={containerClass}>
      {!embedded && (
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Factory Map – Digital Twin</h1>
      )}
      {error && (
        <div
          className="mb-2 px-4 py-2 rounded-lg text-sm flex items-center gap-2 flex-wrap"
          style={{
            background: 'rgba(201, 169, 98, 0.12)',
            border: '1px solid rgba(201, 169, 98, 0.35)',
            color: 'var(--text, #f0f0f0)',
          }}
        >
          <span className="shrink-0">ℹ</span>
          <span className="flex-1 min-w-0">{error}</span>
          <button
            type="button"
            onClick={() => fetchAreas()}
            className="shrink-0 px-3 py-1 rounded font-medium text-[#0d0d0d] hover:opacity-90"
            style={{ backgroundColor: '#c9a962' }}
          >
            Retry
          </button>
        </div>
      )}
      <div
        className="flex-1 flex flex-nowrap gap-4 min-h-0 overflow-visible"
        style={embedded ? { minHeight: '60vh' } : { height: 'calc(100vh - 8rem)' }}
      >
        <div className="flex-1 min-w-[300px] min-h-[400px] flex flex-col gap-2" style={{ minHeight: embedded ? '65vh' : 400 }}>
          {viewMode === 'v2' && areasV2.length === 0 && !usingDemo && areas.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#2d2d2d]">
              <span className="text-sm text-gray-400">v2 has no areas yet.</span>
              <button
                type="button"
                onClick={copyMainToV2}
                className="px-3 py-1.5 rounded text-sm font-medium bg-[#c9a962] text-[#0d0d0d] hover:opacity-90"
              >
                Copy main layout to v2
              </button>
            </div>
          )}
          <FactoryMap
            areas={currentAreas}
            selectedArea={selectedArea}
            onSelectArea={setSelectedArea}
            onUpdate={refetchCurrentAreas}
            routes={visibleRoutes}
            onRoutesChange={handleRoutesChange}
            drawingRoutePoints={drawingPoints}
            onDrawingPointAdd={handleDrawingPointAdd}
            mapVariant={viewMode}
          />
        </div>
        <div className="flex-shrink-0 w-80 sm:w-96 min-w-[280px] flex flex-col gap-4 overflow-auto">
          <RoutesPanel
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            routes={currentRoutes}
            routesMain={routes}
            routesV2={routesV2}
            onRoutesChange={handleRoutesChange}
            hiddenRouteIds={hiddenRouteIds}
            onToggleRouteVisibility={toggleRouteVisibility}
            isDrawing={drawingPoints !== null}
            drawingPointCount={drawingPoints?.length ?? 0}
            onStartDrawing={handleStartDrawing}
            onSaveDrawing={handleSaveDrawing}
            onCancelDrawing={handleCancelDrawing}
            savedFeedback={savedFeedback}
          />
          {selectedArea && (
            <AreaDetails
              area={selectedArea}
              readOnly={usingDemo}
              onClose={() => setSelectedArea(null)}
              onUpdate={async () => {
                const list = await refetchCurrentAreas();
                const updated = list.find((a) => a.id === selectedArea.id);
                if (updated) setSelectedArea(updated);
              }}
              onClone={handleCloneArea}
              mapVariant={viewMode}
            />
          )}
        </div>
      </div>
    </div>
  );
}
