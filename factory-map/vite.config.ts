import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../cristals/factory-map',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'factory-map.js',
        chunkFileNames: 'factory-map-[name].js',
        assetFileNames: 'factory-map.[ext]',
      },
    },
  },
});
