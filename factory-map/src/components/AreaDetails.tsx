import { useState, useEffect } from 'react';
import { FactoryArea } from '../types/database';
import { supabase } from '../lib/supabase';
import {
  Package,
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  Copy,
  TrendingUp,
  X,
} from 'lucide-react';

interface AreaDetailsProps {
  area: FactoryArea;
  readOnly?: boolean;
  onClose: () => void;
  onUpdate: () => void;
  onClone?: (area: FactoryArea) => void;
  /** 'main' | 'v2' — which Supabase table to use when saving */
  mapVariant?: 'main' | 'v2';
}

const ACCENT = '#c9a962';

const clampNum = (v: number, min: number, max: number) =>
  Math.round(Math.max(min, Math.min(max, v)));

export function AreaDetails({
  area,
  readOnly = false,
  onClose,
  onUpdate,
  onClone,
  mapVariant = 'main',
}: AreaDetailsProps) {
  const areasTable = mapVariant === 'v2' ? 'factory_areas_v2' : 'factory_areas';
  const [isUpdating, setIsUpdating] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [name, setName] = useState(area.name);
  const [currentLoad, setCurrentLoad] = useState(area.current_load);
  const [status, setStatus] = useState(area.status);
  const [x, setX] = useState(area.x);
  const [y, setY] = useState(area.y);
  const [width, setWidth] = useState(area.width);
  const [height, setHeight] = useState(area.height);

  useEffect(() => {
    setName(area.name);
    setCurrentLoad(area.current_load);
    setStatus(area.status);
    setX(area.x);
    setY(area.y);
    setWidth(area.width);
    setHeight(area.height);
  }, [area.id, area.name, area.current_load, area.status, area.x, area.y, area.width, area.height]);

  const loadPercentage =
    area.capacity > 0 ? (currentLoad / area.capacity) * 100 : 0;

  const hasChanges =
    (name.trim() !== area.name) ||
    x !== area.x ||
    y !== area.y ||
    width !== area.width ||
    height !== area.height ||
    currentLoad !== area.current_load ||
    status !== area.status;

  const handleSave = async () => {
    if (readOnly || area.id.startsWith('demo-')) return;
    setIsUpdating(true);
    try {
      const payload = {
        name: name.trim() || area.name,
        x: clampNum(x, 0, 1200),
        y: clampNum(y, 0, 920),
        width: clampNum(width, 20, 800),
        height: clampNum(height, 20, 800),
        current_load: clampNum(currentLoad, 0, area.capacity),
        status,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from(areasTable)
        .update(payload)
        .eq('id', area.id);
      if (error) throw error;
      onUpdate();
    } catch (err) {
      console.error('Error saving area:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'active':
        return <CheckCircle className="w-5 h-5 text-emerald-500" />;
      case 'maintenance':
        return <AlertCircle className="w-5 h-5 text-amber-500" />;
      case 'idle':
        return <Clock className="w-5 h-5 text-gray-500" />;
      default:
        return <Activity className="w-5 h-5" />;
    }
  };

  const getAreaTypeIcon = () => {
    switch (area.area_type) {
      case 'storage':
        return <Package className="w-5 h-5" />;
      case 'production':
        return <Activity className="w-5 h-5" />;
      default:
        return <TrendingUp className="w-5 h-5" />;
    }
  };

  const barColor =
    loadPercentage > 90
      ? '#ef4444'
      : loadPercentage > 70
      ? '#f59e0b'
      : '#10b981';

  return (
    <div className="w-80 sm:w-96 bg-[#1a1a1a] rounded-xl shadow-2xl overflow-hidden border border-[#2d2d2d] flex-shrink-0 flex flex-col max-h-[85vh]">
      <div
        className="p-5 text-white shrink-0"
        style={{ backgroundColor: area.color }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold mb-1 truncate" title="Editable in the form below">{name || area.name}</h2>
            <div className="flex items-center gap-2 text-white/90 text-sm">
              {getAreaTypeIcon()}
              <span className="capitalize">{area.area_type}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/20 transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5 min-h-0">
        {readOnly && (
          <div
            className="text-xs px-3 py-2 rounded-lg"
            style={{
              background: 'rgba(201, 169, 98, 0.12)',
              border: '1px solid rgba(201, 169, 98, 0.3)',
              color: '#c9a962',
            }}
          >
            Demo mode — database not connected or table empty. Use the same Supabase project as Production Stats, run <code className="text-[10px]">supabase-factory-areas.sql</code> in SQL Editor, then click Retry on the Factory map.
          </div>
        )}

        {!readOnly && (
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#2d2d2d] border border-[#374151] text-gray-200 focus:border-[#c9a962] focus:ring-1 focus:ring-[#c9a962] outline-none"
              placeholder="Area name"
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">
            Status
          </label>
          <div className="flex gap-2">
            {(['active', 'maintenance', 'idle'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => !readOnly && setStatus(s)}
                disabled={readOnly}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  status === s
                    ? 'text-[#0d0d0d] shadow-md'
                    : 'bg-[#2d2d2d] text-gray-400 hover:bg-[#374151]'
                }`}
                style={
                  status === s
                    ? { backgroundColor: ACCENT }
                    : undefined
                }
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">
            Current load
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={currentLoad}
              onChange={(e) =>
                setCurrentLoad(
                  Math.max(0, Math.min(area.capacity, Number(e.target.value)))
                )
              }
              disabled={readOnly}
              className="flex-1 px-3 py-2 rounded-lg bg-[#2d2d2d] border border-[#374151] text-gray-200 focus:border-[#c9a962] focus:ring-1 focus:ring-[#c9a962] outline-none disabled:opacity-50"
              min={0}
              max={area.capacity}
            />
            <span className="text-sm text-gray-500">/ {area.capacity}</span>
          </div>
          <div className="mt-2">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Capacity</span>
              <span className="font-medium text-gray-400">
                {loadPercentage.toFixed(1)}%
              </span>
            </div>
            <div className="w-full bg-[#2d2d2d] rounded-full h-2 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, loadPercentage)}%`,
                  backgroundColor: barColor,
                }}
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">
            Position & dimensions
          </label>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <div className="text-[10px] text-gray-500 mb-0.5">X</div>
              <input
                type="number"
                value={x}
                onChange={(e) => setX(Number(e.target.value))}
                disabled={readOnly}
                className="w-full px-2 py-1.5 rounded bg-[#2d2d2d] border border-[#374151] text-gray-200 text-sm focus:border-[#c9a962] focus:ring-1 focus:ring-[#c9a962] outline-none disabled:opacity-50"
                min={0}
                max={1200}
              />
            </div>
            <div>
              <div className="text-[10px] text-gray-500 mb-0.5">Y</div>
              <input
                type="number"
                value={y}
                onChange={(e) => setY(Number(e.target.value))}
                disabled={readOnly}
                className="w-full px-2 py-1.5 rounded bg-[#2d2d2d] border border-[#374151] text-gray-200 text-sm focus:border-[#c9a962] focus:ring-1 focus:ring-[#c9a962] outline-none disabled:opacity-50"
                min={0}
                max={920}
              />
            </div>
            <div>
              <div className="text-[10px] text-gray-500 mb-0.5">W</div>
              <input
                type="number"
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                disabled={readOnly}
                className="w-full px-2 py-1.5 rounded bg-[#2d2d2d] border border-[#374151] text-gray-200 text-sm focus:border-[#c9a962] focus:ring-1 focus:ring-[#c9a962] outline-none disabled:opacity-50"
                min={20}
                max={800}
              />
            </div>
            <div>
              <div className="text-[10px] text-gray-500 mb-0.5">H</div>
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                disabled={readOnly}
                className="w-full px-2 py-1.5 rounded bg-[#2d2d2d] border border-[#374151] text-gray-200 text-sm focus:border-[#c9a962] focus:ring-1 focus:ring-[#c9a962] outline-none disabled:opacity-50"
                min={20}
                max={800}
              />
            </div>
          </div>
          <p className="text-[10px] text-gray-500 mt-1">
            X,Y = top-left. W,H = width × height. Or drag handles on map to resize.
          </p>
        </div>

        <div className="pt-3 border-t border-[#2d2d2d] text-xs text-gray-500">
          Last updated: {new Date(area.updated_at).toLocaleString()}
        </div>
      </div>

      {!readOnly && (
        <div className="p-4 pt-0 shrink-0 border-t border-[#2d2d2d] bg-[#1a1a1a] space-y-2">
          {onClone && !area.id.startsWith('demo-') && (
            <button
              type="button"
              onClick={async () => {
                if (!onClone) return;
                setIsCloning(true);
                try {
                  onClone(area);
                } finally {
                  setIsCloning(false);
                }
              }}
              disabled={isCloning}
              className="w-full py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2 bg-[#2d2d2d] text-gray-200 hover:bg-[#374151] border border-[#374151]"
            >
              <Copy className="w-4 h-4" />
              {isCloning ? 'Cloning…' : 'Clone this area'}
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={isUpdating || !hasChanges}
            className="w-full py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[#0d0d0d] hover:opacity-95"
            style={{ backgroundColor: ACCENT }}
          >
            {isUpdating ? 'Saving…' : 'Save position & dimensions'}
          </button>
        </div>
      )}
    </div>
  );
}
