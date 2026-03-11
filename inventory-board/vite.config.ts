import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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

