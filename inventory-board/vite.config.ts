import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Same project as root `index.html` — keeps standalone `cristals/inventory-board/` online sync working. */
const CRISTAL_SUPABASE = {
  url: 'https://gimzlqbodxnriaqieetm.supabase.co',
  anonKey: 'sb_publishable_fmHwMrvM6ccnMCJgFYpEAA_Pu-ydW5u',
};

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'inject-cristal-supabase-globals',
      transformIndexHtml(html) {
        const snippet = `\n    <script>window.CRISTAL_SUPABASE_URL='${CRISTAL_SUPABASE.url}';window.CRISTAL_SUPABASE_ANON_KEY='${CRISTAL_SUPABASE.anonKey}';</script>`;
        return html.replace('<head>', `<head>${snippet}`);
      },
    },
  ],
  base: './',
  build: {
    outDir: '../cristals/inventory-board',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'inventory-board.js',
        chunkFileNames: 'inventory-board-[name].js',
        assetFileNames: 'inventory-board.[ext]',
      },
    },
  },
});

