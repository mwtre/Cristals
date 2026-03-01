import { useState } from 'react';
import type { ProductRoute, RoutePoint } from '../types/routes';

const TRAVEL_SCALE = 0.05;

export const ROUTE_COLORS = [
  '#c9a962', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
];

function routeLength(points: RoutePoint[]): number {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    len += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  }
  return len;
}

export function totalTimeMin(routes: ProductRoute[]): number {
  return routes.reduce((sum, r) => sum + routeLength(r.points) * TRAVEL_SCALE, 0);
}

interface RoutesPanelProps {
  viewMode: 'main' | 'v2';
  onViewModeChange: (mode: 'main' | 'v2') => void;
  routes: ProductRoute[];
  routesMain: ProductRoute[];
  routesV2: ProductRoute[];
  onRoutesChange: (routes: ProductRoute[]) => void;
  isDrawing?: boolean;
  drawingPointCount?: number;
  onStartDrawing?: () => void;
  onSaveDrawing?: (name: string) => void;
  onCancelDrawing?: () => void;
  savedFeedback?: boolean;
  hiddenRouteIds?: string[];
  onToggleRouteVisibility?: (routeId: string) => void;
}

export function RoutesPanel({
  viewMode,
  onViewModeChange,
  routes,
  routesMain = [],
  routesV2 = [],
  onRoutesChange,
  isDrawing = false,
  drawingPointCount = 0,
  onStartDrawing,
  onSaveDrawing,
  onCancelDrawing,
  savedFeedback = false,
  hiddenRouteIds = [],
  onToggleRouteVisibility,
}: RoutesPanelProps) {
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [newRouteName, setNewRouteName] = useState('');

  const main = Array.isArray(routesMain) ? routesMain : [];
  const v2 = Array.isArray(routesV2) ? routesV2 : [];
  const totalMain = totalTimeMin(main);
  const totalV2 = totalTimeMin(v2);
  const currentList = Array.isArray(routes) ? routes : [];

  const persist = (next: ProductRoute[]) => onRoutesChange(next);

  const handleDelete = (id: string) => {
    persist(currentList.filter((r) => r.id !== id));
    if (editingNameId === id) setEditingNameId(null);
  };

  const handleSaveRename = (id: string) => {
    const name = editingName.trim() || 'Route';
    persist(currentList.map((r) => (r.id === id ? { ...r, name } : r)));
    setEditingNameId(null);
  };

  const startRename = (r: ProductRoute) => {
    setEditingNameId(r.id);
    setEditingName(r.name || '');
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-[#c9a962] px-1">Routes</div>
        <div className="flex rounded overflow-hidden border border-[#2d2d2d]">
          <button
            type="button"
            onClick={() => onViewModeChange('main')}
            className={`px-2 py-1 text-xs font-medium ${viewMode === 'main' ? 'bg-[#c9a962] text-[#0d0d0d]' : 'bg-[#2d2d2d] text-gray-400 hover:bg-[#3d3d3d]'}`}
          >
            Main
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('v2')}
            className={`px-2 py-1 text-xs font-medium ${viewMode === 'v2' ? 'bg-[#c9a962] text-[#0d0d0d]' : 'bg-[#2d2d2d] text-gray-400 hover:bg-[#3d3d3d]'}`}
          >
            v2 Compare
          </button>
        </div>
      </div>
      <div className="rounded-lg border border-[#2d2d2d] bg-[#1a1a1a] px-2 py-1.5 flex flex-col gap-0.5">
        <div className="text-xs font-semibold text-white">
          Total time: {totalTimeMin(currentList).toFixed(1)} min
          {viewMode === 'main' && main.length > 0 && ` (${main.length} route${main.length !== 1 ? 's' : ''})`}
          {viewMode === 'v2' && v2.length > 0 && ` (${v2.length} route${v2.length !== 1 ? 's' : ''})`}
        </div>
        {viewMode === 'v2' && (main.length > 0 || v2.length > 0) && (
          <div className="text-[10px] text-gray-500">
            Main: {totalMain.toFixed(1)} min · v2: {totalV2.toFixed(1)} min
          </div>
        )}
      </div>
      {savedFeedback && (
        <div className="rounded-lg border border-[#10b981] bg-[#10b981]/20 px-2 py-1.5 text-xs font-medium text-[#10b981]">
          Saved!
        </div>
      )}
      <p className="text-xs text-gray-500 px-1">
        {viewMode === 'v2' ? 'v2 starts with no routes. Draw new routes to compare total time.' : 'Click + New route, then click the map to add points. Drag a route to move it.'}
      </p>

      {isDrawing ? (
        <div className="flex flex-col gap-2 rounded-lg border border-[#c9a962]/50 bg-[#1a1a1a] p-2">
          <div className="text-xs font-medium text-[#c9a962]">
            Drawing… {drawingPointCount} point{drawingPointCount !== 1 ? 's' : ''}. Click the map to add more.
          </div>
          <input
            type="text"
            value={newRouteName}
            onChange={(e) => setNewRouteName(e.target.value)}
            placeholder="Route name"
            className="w-full px-2 py-1.5 rounded bg-[#0d0d0d] border border-[#2d2d2d] text-sm text-white placeholder-gray-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onSaveDrawing?.(newRouteName.trim() || 'Route')}
              disabled={drawingPointCount < 2}
              className="flex-1 px-3 py-1.5 rounded text-sm font-medium bg-[#c9a962] text-[#0d0d0d] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save route
            </button>
            <button
              type="button"
              onClick={() => onCancelDrawing?.()}
              className="px-3 py-1.5 rounded text-sm font-medium bg-[#2d2d2d] text-gray-300 hover:bg-[#3d3d3d]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onStartDrawing?.()}
            className="w-full px-3 py-2 rounded text-sm font-medium bg-[#c9a962] text-[#0d0d0d] hover:opacity-90"
          >
            + New route
          </button>
          {currentList.length === 0 && (
            <p className="text-xs text-gray-500 px-2 py-1">No routes yet. Click + New route and draw on the map.</p>
          )}
          <ul className="space-y-1 overflow-auto max-h-48">
            {currentList.map((r) => {
              if (editingNameId === r.id) {
                return (
                  <li
                    key={r.id}
                    className="flex flex-col gap-1.5 py-1.5 px-2 rounded bg-[#252525] border border-[#2d2d2d]"
                  >
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="w-full px-2 py-1 rounded bg-[#0d0d0d] border border-[#2d2d2d] text-sm text-white"
                      placeholder="Route name"
                      autoFocus
                    />
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => handleSaveRename(r.id)}
                        className="px-2 py-1 rounded text-xs bg-[#c9a962] text-[#0d0d0d] hover:opacity-90"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingNameId(null)}
                        className="px-2 py-1 rounded text-xs bg-[#2d2d2d] text-gray-400 hover:bg-[#3d3d3d]"
                      >
                        Cancel
                      </button>
                    </div>
                  </li>
                );
              }
              const len = routeLength(r.points);
              const timeMin = len * TRAVEL_SCALE;
              return (
                <li
                  key={r.id}
                  className={`flex items-center justify-between gap-2 py-1.5 px-2 rounded border border-[#2d2d2d] ${hiddenRouteIds.includes(r.id) ? 'bg-[#1a1a1a] opacity-70' : 'bg-[#252525]'}`}
                >
                  <div
                    className="shrink-0 w-3 h-3 rounded-full border border-[#0d0d0d]"
                    style={{ backgroundColor: ROUTE_COLORS[currentList.indexOf(r) % ROUTE_COLORS.length] }}
                    title="Route color on map"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-white truncate">{r.name || 'Unnamed'}</div>
                    <div className="text-xs text-gray-500">
                      {hiddenRouteIds.includes(r.id) ? 'Hidden' : `${r.points.length - 1} segment(s) · ${timeMin.toFixed(1)} min`}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {onToggleRouteVisibility && (
                      <button
                        type="button"
                        onClick={() => onToggleRouteVisibility(r.id)}
                        className="px-2 py-1 rounded text-xs bg-[#2d2d2d] text-gray-400 hover:bg-[#3d3d3d]"
                        title={hiddenRouteIds.includes(r.id) ? 'Show on map' : 'Hide on map'}
                      >
                        {hiddenRouteIds.includes(r.id) ? 'Show' : 'Hide'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startRename(r)}
                      className="px-2 py-1 rounded text-xs bg-[#2d2d2d] text-[#c9a962] hover:bg-[#3d3d3d]"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(r.id)}
                      className="px-2 py-1 rounded text-xs bg-[#2d2d2d] text-gray-400 hover:bg-red-900/50"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
