export interface RoutePoint {
  x: number;
  y: number;
}

export interface ProductRoute {
  id: string;
  name: string;
  points: RoutePoint[];
}
