export interface FactoryArea {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  status: 'active' | 'maintenance' | 'idle';
  area_type: string;
  current_load: number;
  capacity: number;
  updated_at: string;
}
