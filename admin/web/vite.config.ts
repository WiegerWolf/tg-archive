import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const devApiBase = process.env.VITE_API_BASE || 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, '../shared'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    host: process.env.VITE_HOST || '0.0.0.0',
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: true,
    proxy: {
      '/login': {
        target: devApiBase,
        changeOrigin: true,
      },
      '/logout': {
        target: devApiBase,
        changeOrigin: true,
      },
      '/api': {
        target: devApiBase,
        changeOrigin: true,
      },
      '/media': {
        target: devApiBase,
        changeOrigin: true,
      },
    },
  },
});
