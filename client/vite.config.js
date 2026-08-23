import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Recharts et React changent rarement : on les isole pour
        // qu ils restent en cache entre deux deploiements.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          graphiques: ['recharts'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
