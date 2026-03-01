import { useState, useEffect, useRef } from 'react';
import { FactoryArea } from '../types/database';
import type { ProductRoute, RoutePoint } from '../types/routes';
import { supabase } from '../lib/supabase';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface FactoryMapProps {
  areas: FactoryArea[];
  selectedArea: FactoryArea | null;
  onSelectArea: (area: FactoryArea | null) => void;
  onUpdate?: () => void | Promise<void>;
  routes?: ProductRoute[];
  onRoutesChange?: (routes: ProductRoute[]) => void;
  drawingRoutePoints?: RoutePoint[] | null;
  onDrawingPointAdd?: (point: RoutePoint) => void;
  /** 'main' | 'v2' — which Supabase table to use when saving area position/size */
  mapVariant?: 'main' | 'v2';
}

interface DraggedArea extends FactoryArea {
  offsetX: number;
  offsetY: number;
}

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

interface ResizingArea {
  area: FactoryArea;
  handle: ResizeHandle;
  startBounds: { x: number; y: number; w: number; h: number };
  currentBounds: { x: number; y: number; width: number; height: number };
}

const HANDLE_SIZE = 18;
const HANDLE_HIT = 24;
const MIN_SIZE = 30;

const MAP_WIDTH = 1200;
const MAP_HEIGHT = 920;

const ROUTE_COLORS = [
  '#c9a962', // gold (accent)
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

// Building bounds (two main rects) for constraining area drag
const BUILDING_BOUNDS = [
  { x: 68, y: 98, w: 502, h: 775 },
  { x: 571, y: 98, w: 501, h: 775 },
];

function clampPosition(
  x: number,
  y: number,
  w: number,
  h: number
): { x: number; y: number } {
  let outX = x;
  let outY = y;
  for (const b of BUILDING_BOUNDS) {
    if (
      x + w <= b.x + b.w &&
      x >= b.x &&
      y + h <= b.y + b.h &&
      y >= b.y
    ) {
      return { x, y };
    }
  }
  // Snap to nearest building
  let best = { x: BUILDING_BOUNDS[0].x, y: BUILDING_BOUNDS[0].y };
  let bestDist = Infinity;
  for (const b of BUILDING_BOUNDS) {
    const nx = Math.max(b.x, Math.min(b.x + b.w - w, x));
    const ny = Math.max(b.y, Math.min(b.y + b.h - h, y));
    const dist = (nx - x) ** 2 + (ny - y) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = { x: nx, y: ny };
    }
  }
  return best;
}

function resizeBounds(
  handle: ResizeHandle,
  start: { x: number; y: number; w: number; h: number },
  mouseX: number,
  mouseY: number
): { x: number; y: number; width: number; height: number } {
  let x = start.x;
  let y = start.y;
  let w = start.w;
  let h = start.h;
  if (handle.includes('e')) w = Math.max(MIN_SIZE, mouseX - x);
  if (handle.includes('w')) {
    const newW = Math.max(MIN_SIZE, start.x + start.w - mouseX);
    x = start.x + start.w - newW;
    w = newW;
  }
  if (handle.includes('s')) h = Math.max(MIN_SIZE, mouseY - y);
  if (handle.includes('n')) {
    const newH = Math.max(MIN_SIZE, start.y + start.h - mouseY);
    y = start.y + start.h - newH;
    h = newH;
  }
  return {
    x: Math.max(0, Math.min(MAP_WIDTH - w, x)),
    y: Math.max(0, Math.min(MAP_HEIGHT - h, y)),
    width: Math.max(MIN_SIZE, Math.min(800, w)),
    height: Math.max(MIN_SIZE, Math.min(800, h)),
  };
}

export function FactoryMap({
  areas,
  selectedArea,
  onSelectArea,
  onUpdate,
  routes = [],
  onRoutesChange,
  drawingRoutePoints = null,
  onDrawingPointAdd,
  mapVariant = 'main',
}: FactoryMapProps) {
  const isDrawing = drawingRoutePoints != null;
  const areasTable = mapVariant === 'v2' ? 'factory_areas_v2' : 'factory_areas';
  const [hoveredArea, setHoveredArea] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanDragging, setIsPanDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [draggedArea, setDraggedArea] = useState<DraggedArea | null>(null);
  const [pendingDrag, setPendingDrag] = useState<{ area: FactoryArea; clientX: number; clientY: number } | null>(null);
  const [resizing, setResizing] = useState<ResizingArea | null>(null);
  const [draggingRouteId, setDraggingRouteId] = useState<string | null>(null);
  const [draggingRouteStart, setDraggingRouteStart] = useState<{ x: number; y: number; points: RoutePoint[] } | null>(null);
  const [draggingRoutePoints, setDraggingRoutePoints] = useState<RoutePoint[] | null>(null);
  const [drawPreviewPoint, setDrawPreviewPoint] = useState<RoutePoint | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const DRAG_THRESHOLD = 6;
  const svgRef = useRef<SVGSVGElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  panRef.current = pan;
  zoomRef.current = zoom;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!containerRef.current || !svgRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const p = panRef.current;
      const z = zoomRef.current;
      const cx = (e.clientX - rect.left - p.x) / z;
      const cy = (e.clientY - rect.top - p.y) / z;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const nextZoom = Math.max(0.5, Math.min(3, z * delta));
      setPan({
        x: e.clientX - rect.left - cx * nextZoom,
        y: e.clientY - rect.top - cy * nextZoom,
      });
      setZoom(nextZoom);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const getMouseCoordinates = (e: React.MouseEvent | MouseEvent) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const svg = svgRef.current;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(ctm.inverse());
    return {
      x: Math.max(0, Math.min(MAP_WIDTH, svgPt.x)),
      y: Math.max(0, Math.min(MAP_HEIGHT, svgPt.y)),
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (isDrawing && onDrawingPointAdd) {
      const areaOrHandle = (e.target as SVGElement).closest('[data-area-id], [data-resize-handle], [data-route-id]');
      if (!areaOrHandle) {
        const coords = getMouseCoordinates(e);
        onDrawingPointAdd({ x: coords.x, y: coords.y });
        e.stopPropagation();
        e.preventDefault();
        return;
      }
    }
    const routeHit = (e.target as SVGElement).closest('[data-route-id]');
    if (routeHit && onRoutesChange && routes.length > 0) {
      const routeId = routeHit.getAttribute('data-route-id');
      const route = routes.find((r) => r.id === routeId);
      if (route && route.points.length > 0) {
        e.stopPropagation();
        const coords = getMouseCoordinates(e);
        setDraggingRouteId(routeId);
        setDraggingRouteStart({ x: coords.x, y: coords.y, points: route.points.map((p) => ({ x: p.x, y: p.y })) });
        setDraggingRoutePoints(route.points.map((p) => ({ x: p.x, y: p.y })));
        return;
      }
    }
    const resizeHandle = (e.target as SVGElement).closest('[data-resize-handle]');
    if (resizeHandle) {
      const handle = resizeHandle.getAttribute('data-resize-handle') as ResizeHandle;
      const areaId = resizeHandle.getAttribute('data-area-id');
      const area = areas.find((a) => a.id === areaId);
      if (area && handle) {
        e.stopPropagation();
        setResizing({
          area,
          handle,
          startBounds: { x: area.x, y: area.y, w: area.width, h: area.height },
          currentBounds: { x: area.x, y: area.y, width: area.width, height: area.height },
        });
      }
      return;
    }
    const areaElement = (e.target as SVGElement).closest('[data-area-id]');
    if (areaElement && !(e.target as SVGElement).closest('[data-resize-handle]')) {
      const areaId = areaElement.getAttribute('data-area-id');
      const area = areas.find((a) => a.id === areaId);
      if (area) {
        setPendingDrag({ area, clientX: e.clientX, clientY: e.clientY });
      }
      return;
    }
    setIsPanDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDrawing && drawingRoutePoints && drawingRoutePoints.length > 0) {
      const coords = getMouseCoordinates(e);
      setDrawPreviewPoint({ x: coords.x, y: coords.y });
      return;
    }
    setDrawPreviewPoint(null);
    if (draggingRouteId && draggingRouteStart && draggingRoutePoints) {
      const coords = getMouseCoordinates(e);
      const dx = coords.x - draggingRouteStart.x;
      const dy = coords.y - draggingRouteStart.y;
      setDraggingRoutePoints(
        draggingRouteStart.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
      );
      return;
    }
    if (isPanDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    } else if (pendingDrag && !draggedArea) {
      const dx = e.clientX - pendingDrag.clientX;
      const dy = e.clientY - pendingDrag.clientY;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        const coords = getMouseCoordinates(e);
        setDraggedArea({
          ...pendingDrag.area,
          offsetX: coords.x - pendingDrag.area.x,
          offsetY: coords.y - pendingDrag.area.y,
        });
        setPendingDrag(null);
      }
    } else if (resizing) {
      const { x, y } = getMouseCoordinates(e);
      const next = resizeBounds(
        resizing.handle,
        resizing.startBounds,
        x,
        y
      );
      setResizing({
        ...resizing,
        currentBounds: next,
      });
    } else if (draggedArea) {
      const coords = getMouseCoordinates(e);
      let newX = coords.x - draggedArea.offsetX;
      let newY = coords.y - draggedArea.offsetY;
      const clamped = clampPosition(
        newX,
        newY,
        draggedArea.width,
        draggedArea.height
      );
      setDraggedArea({
        ...draggedArea,
        x: clamped.x,
        y: clamped.y,
      });
    }
  };

  const handleMouseUp = async () => {
    if (draggingRouteId && draggingRoutePoints && onRoutesChange) {
      const next = routes.map((r) =>
        r.id === draggingRouteId ? { ...r, points: draggingRoutePoints.map((p) => ({ x: p.x, y: p.y })) } : r
      );
      onRoutesChange(next);
      setDraggingRouteId(null);
      setDraggingRouteStart(null);
      setDraggingRoutePoints(null);
      return;
    }
    if (pendingDrag && !draggedArea) {
      onSelectArea(selectedArea?.id === pendingDrag.area.id ? null : pendingDrag.area);
      setPendingDrag(null);
      setIsPanDragging(false);
      return;
    }
    setPendingDrag(null);
    if (resizing) {
      if (!resizing.area.id.startsWith('demo-')) {
        setIsSaving(true);
        try {
          const { error } = await supabase
            .from(areasTable)
            .update({
              x: Math.round(resizing.currentBounds.x),
              y: Math.round(resizing.currentBounds.y),
              width: Math.round(resizing.currentBounds.width),
              height: Math.round(resizing.currentBounds.height),
              updated_at: new Date().toISOString(),
            })
            .eq('id', resizing.area.id);
          if (error) throw error;
          await onUpdate?.();
        } catch (err) {
          console.error('Error saving area size:', err);
        } finally {
          setIsSaving(false);
        }
      }
      setResizing(null);
      return;
    }
    if (draggedArea) {
      const clamped = clampPosition(
        draggedArea.x,
        draggedArea.y,
        draggedArea.width,
        draggedArea.height
      );
      if (draggedArea.id.startsWith('demo-')) {
        setDraggedArea(null);
        setIsPanDragging(false);
        return;
      }
      setIsSaving(true);
      try {
        const { error } = await supabase
          .from(areasTable)
          .update({
            x: Math.round(clamped.x),
            y: Math.round(clamped.y),
            updated_at: new Date().toISOString(),
          })
          .eq('id', draggedArea.id);
        if (error) throw error;
        await onUpdate?.();
      } catch (err) {
        console.error('Error saving area position:', err);
      } finally {
        setIsSaving(false);
      }
      setDraggedArea(null);
    }
    setIsPanDragging(false);
  };

  useEffect(() => {
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [draggedArea, resizing, pendingDrag, selectedArea, onUpdate, draggingRouteId, draggingRoutePoints]);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const zoomIn = () => setZoom((z) => Math.min(3, z * 1.2));
  const zoomOut = () => setZoom((z) => Math.max(0.5, z / 1.2));

  const getStatusOpacity = (status: string) => {
    switch (status) {
      case 'active':
        return 0.92;
      case 'maintenance':
        return 0.55;
      case 'idle':
        return 0.35;
      default:
        return 0.92;
    }
  };

  const getLoadPercentage = (area: FactoryArea) => {
    if (area.capacity === 0) return 0;
    return (area.current_load / area.capacity) * 100;
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden rounded-xl border-2 border-[#2d2d2d] bg-[#1a1a1a]"
    >
      <div
        className={`w-full h-full ${isDrawing ? 'cursor-crosshair' : draggedArea ? 'cursor-grabbing' : resizing ? 'cursor-grabbing' : 'cursor-grab'}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          setDrawPreviewPoint(null);
          handleMouseUp();
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          className="w-full h-full select-none"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            transition: isPanDragging || draggedArea || resizing ? 'none' : 'transform 0.15s ease-out',
          }}
        >
          <defs>
            <pattern
              id="grid"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke="#2d2d2d"
                strokeWidth="0.8"
              />
            </pattern>
          </defs>
          <rect
            width={MAP_WIDTH}
            height={MAP_HEIGHT}
            fill="url(#grid)"
          />
          <rect
            x={BUILDING_BOUNDS[0].x}
            y={BUILDING_BOUNDS[0].y}
            width={BUILDING_BOUNDS[0].w}
            height={BUILDING_BOUNDS[0].h}
            fill="rgba(201,169,98,0.04)"
            stroke="#c9a962"
            strokeWidth="2"
            rx="4"
          />
          <rect
            x={BUILDING_BOUNDS[1].x}
            y={BUILDING_BOUNDS[1].y}
            width={BUILDING_BOUNDS[1].w}
            height={BUILDING_BOUNDS[1].h}
            fill="rgba(201,169,98,0.04)"
            stroke="#c9a962"
            strokeWidth="2"
            rx="4"
          />

          {areas.map((area) => {
            const isResizing = resizing?.area.id === area.id;
            const displayArea = isResizing
              ? { ...area, ...resizing!.currentBounds }
              : draggedArea?.id === area.id
              ? draggedArea
              : area;
            const isSelected = selectedArea?.id === area.id;
            const isHovered = hoveredArea === area.id;
            const isDragging = draggedArea?.id === area.id;
            const loadPct = getLoadPercentage(displayArea);
            const rx = displayArea.x;
            const ry = displayArea.y;
            const rw = displayArea.width;
            const rh = displayArea.height;

            return (
              <g key={area.id} className="factory-area" data-area-id={area.id}>
                <rect
                  x={rx}
                  y={ry}
                  width={rw}
                  height={rh}
                  fill={displayArea.color}
                  opacity={getStatusOpacity(displayArea.status)}
                  stroke={isSelected ? '#c9a962' : isDragging ? '#ec4899' : '#374151'}
                  strokeWidth={isSelected ? 4 : isDragging ? 3 : 2}
                  rx="6"
                  className="transition-all"
                  style={{
                    filter:
                      isHovered && !isDragging
                        ? 'brightness(1.15)'
                        : isDragging
                        ? 'brightness(0.95)'
                        : 'none',
                    cursor: isDragging ? 'grabbing' : 'grab',
                  }}
                  onMouseEnter={() => setHoveredArea(area.id)}
                  onMouseLeave={() => setHoveredArea(null)}
                />
                {loadPct > 0 && (
                  <rect
                    x={rx}
                    y={ry + rh - 6}
                    width={(rw * loadPct) / 100}
                    height="6"
                    fill="#1f2937"
                    opacity="0.4"
                    rx="2"
                  />
                )}
                <text
                  x={rx + rw / 2}
                  y={ry + rh / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#fff"
                  fontSize="14"
                  fontWeight="600"
                  pointerEvents="none"
                  style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)', userSelect: 'none' }}
                >
                  {displayArea.name}
                </text>
                {displayArea.status !== 'active' && (
                  <text
                    x={rx + rw / 2}
                    y={ry + rh / 2 + 20}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#fca5a5"
                    fontSize="11"
                    fontWeight="600"
                    pointerEvents="none"
                    style={{ userSelect: 'none' }}
                  >
                    [{displayArea.status.toUpperCase()}]
                  </text>
                )}
                {isDragging && (
                  <text
                    x={rx + rw / 2}
                    y={ry - 12}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#ec4899"
                    fontSize="11"
                    fontWeight="600"
                    pointerEvents="none"
                    style={{ userSelect: 'none' }}
                  >
                    Moving… ({Math.round(rx)}, {Math.round(ry)})
                  </text>
                )}
                {isSelected && !isDragging && !isResizing && (
                  <>
                    {(['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'] as const).map((h) => {
                      let hx = rx;
                      let hy = ry;
                      if (h === 'n' || h === 'ne' || h === 'nw') hy = ry;
                      else if (h === 's' || h === 'se' || h === 'sw') hy = ry + rh - HANDLE_SIZE;
                      else hy = ry + rh / 2 - HANDLE_SIZE / 2;
                      if (h === 'w' || h === 'nw' || h === 'sw') hx = rx;
                      else if (h === 'e' || h === 'ne' || h === 'se') hx = rx + rw - HANDLE_SIZE;
                      else hx = rx + rw / 2 - HANDLE_SIZE / 2;
                      const cursor =
                        h === 'n' || h === 's' ? 'ns-resize' : h === 'e' || h === 'w' ? 'ew-resize' : h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize';
                      const hitOffset = (HANDLE_HIT - HANDLE_SIZE) / 2;
                      return (
                        <g
                          key={h}
                          data-resize-handle={h}
                          data-area-id={area.id}
                          style={{ cursor }}
                          onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            setPendingDrag(null);
                            setResizing({
                              area,
                              handle: h,
                              startBounds: { x: area.x, y: area.y, w: area.width, h: area.height },
                              currentBounds: { x: area.x, y: area.y, width: area.width, height: area.height },
                            });
                          }}
                        >
                          <rect
                            x={hx - hitOffset}
                            y={hy - hitOffset}
                            width={HANDLE_HIT}
                            height={HANDLE_HIT}
                            fill="transparent"
                            pointerEvents="all"
                          />
                          <rect
                            x={hx}
                            y={hy}
                            width={HANDLE_SIZE}
                            height={HANDLE_SIZE}
                            fill="#c9a962"
                            stroke="#1a1a1a"
                            strokeWidth="2"
                            rx="3"
                            pointerEvents="none"
                            style={{ opacity: 0.95 }}
                          />
                        </g>
                      );
                    })}
                  </>
                )}
              </g>
            );
          })}
          {routes.map((route, idx) => {
            const pts = route.id === draggingRouteId && draggingRoutePoints ? draggingRoutePoints : route.points;
            if (pts.length < 2) return null;
            const pointsStr = pts.map((p) => `${p.x},${p.y}`).join(' ');
            const routeColor = ROUTE_COLORS[idx % ROUTE_COLORS.length];
            return (
              <g key={route.id} data-route-id={route.id} style={{ cursor: draggingRouteId === route.id ? 'grabbing' : 'grab' }}>
                <polyline
                  points={pointsStr}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={24}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pointerEvents="stroke"
                />
                <polyline
                  points={pointsStr}
                  fill="none"
                  stroke={routeColor}
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pointerEvents="none"
                  opacity={draggingRouteId === route.id ? 0.9 : 0.85}
                />
              </g>
            );
          })}
          {isDrawing && drawingRoutePoints && drawingRoutePoints.length > 0 && (
            <g pointerEvents="none">
              <polyline
                points={drawingRoutePoints.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={ROUTE_COLORS[routes.length % ROUTE_COLORS.length]}
                strokeWidth={4}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="8 4"
                opacity={0.95}
              />
              {drawPreviewPoint && (
                <>
                  <line
                    x1={drawingRoutePoints[drawingRoutePoints.length - 1].x}
                    y1={drawingRoutePoints[drawingRoutePoints.length - 1].y}
                    x2={drawPreviewPoint.x}
                    y2={drawPreviewPoint.y}
                    stroke={ROUTE_COLORS[routes.length % ROUTE_COLORS.length]}
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeDasharray="6 4"
                    opacity={0.8}
                  />
                  <circle
                    cx={drawPreviewPoint.x}
                    cy={drawPreviewPoint.y}
                    r={5}
                    fill={ROUTE_COLORS[routes.length % ROUTE_COLORS.length]}
                    stroke="#0d0d0d"
                    strokeWidth={1.5}
                    opacity={0.9}
                  />
                </>
              )}
              {drawingRoutePoints.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={6}
                  fill={ROUTE_COLORS[routes.length % ROUTE_COLORS.length]}
                  stroke="#0d0d0d"
                  strokeWidth={2}
                />
              ))}
            </g>
          )}
        </svg>
      </div>

      <div className="absolute top-3 left-3 flex flex-col gap-1 bg-[#1a1a1a]/95 rounded-lg border border-[#2d2d2d] p-2 shadow-lg">
        <div className="text-xs font-semibold text-[#c9a962] px-1">Map</div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={zoomOut}
            className="p-1.5 rounded text-gray-400 hover:text-[#c9a962] hover:bg-white/5 transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-500 w-10 text-center">
            {(zoom * 100).toFixed(0)}%
          </span>
          <button
            type="button"
            onClick={zoomIn}
            className="p-1.5 rounded text-gray-400 hover:text-[#c9a962] hover:bg-white/5 transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={resetView}
          className="p-1.5 rounded text-gray-400 hover:text-[#c9a962] hover:bg-white/5 transition-colors"
          title="Reset view"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <div className="text-[10px] text-gray-500 border-t border-[#2d2d2d] pt-1.5 mt-1 px-1 max-w-[140px]">
          {isDrawing ? (
            <span className="text-[#c9a962] font-medium">Click on the map to add route points</span>
          ) : (
            'Click an area to select. Drag area to move, handles to resize. Drag routes to move. Scroll to zoom.'
          )}
        </div>
        {(draggedArea || resizing) && (
          <div className="text-[10px] text-pink-500 font-medium">
            {resizing ? 'Resizing…' : 'Moving…'}
          </div>
        )}
        {isSaving && (
          <div className="text-[10px] text-amber-500 font-medium">Saving…</div>
        )}
      </div>
    </div>
  );
}
