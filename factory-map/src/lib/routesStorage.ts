import type { ProductRoute } from '../types/routes';

const ROUTES_KEY = 'cristal_product_routes';
const ROUTES_V2_KEY = 'cristal_product_routes_v2';

function loadRoutes(key: string): ProductRoute[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is ProductRoute =>
        r && typeof r === 'object' && typeof r.id === 'string' && Array.isArray((r as ProductRoute).points)
    );
  } catch {
    return [];
  }
}

export function getRoutes(): ProductRoute[] {
  return loadRoutes(ROUTES_KEY);
}

export function saveRoutes(routes: ProductRoute[]): void {
  localStorage.setItem(ROUTES_KEY, JSON.stringify(routes));
}

export function getRoutesV2(): ProductRoute[] {
  return loadRoutes(ROUTES_V2_KEY);
}

export function saveRoutesV2(routes: ProductRoute[]): void {
  localStorage.setItem(ROUTES_V2_KEY, JSON.stringify(routes));
}
