// Client options for new WO; images from src/img (Vite static imports)
import ooklaImg from '../img/ookla LG.png';
import sgoldImg from '../img/sgold.png';
import sgreyImg from '../img/sgrey.png';
import switheImg from '../img/swithe.png';

export type ClientKey = 'ookla' | 'shopify_gold' | 'shopify_silver' | 'shopify_white' | 'wetrack' | 'wpt';

export const CLIENT_OPTIONS: Array<{ key: ClientKey; label: string; img: string }> = [
  { key: 'ookla', label: 'OOKLA', img: ooklaImg },
  { key: 'shopify_gold', label: 'Shopify Gold', img: sgoldImg },
  { key: 'shopify_silver', label: 'Shopify Silver', img: sgreyImg },
  { key: 'shopify_white', label: 'Shopify White', img: switheImg },
  { key: 'wetrack', label: 'WeTrack', img: '' },
  { key: 'wpt', label: 'WPT', img: '' },
];

const clientToImg: Record<string, string> = {
  ookla: ooklaImg,
  shopify_gold: sgoldImg,
  shopify_silver: sgreyImg,
  shopify_white: switheImg,
};

/** Returns image URL for client, or null to use placeholder. */
export function getClientImage(client: string | undefined): string | null {
  if (!client) return null;
  return clientToImg[client] ?? null;
}

/** Placeholder SVG data URL for clients without an image (WPT, WeTrack, unknown). */
export const PLACEHOLDER_IMAGE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32" viewBox="0 0 48 32"><rect width="48" height="32" fill="#2d2d2d" rx="4"/><text x="24" y="20" font-family="sans-serif" font-size="12" font-weight="700" fill="#888" text-anchor="middle">WPT</text></svg>'
  );
