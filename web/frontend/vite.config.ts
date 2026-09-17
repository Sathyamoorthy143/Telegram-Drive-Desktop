import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    // Split the big third-party deps into their own chunks so app-code
    // deploys don't bust caches for vendor bytes (and vice versa).
    rollupOptions: {
      output: {
        manualChunks: {
          vendor_react: ['react', 'react-dom'],
          vendor_motion: ['framer-motion'],
          vendor_query: ['@tanstack/react-query'],
        },
      },
    },
  },
  test: {
    globals: true,
    setupFiles: ['./src/testSetup.ts'],
  },
});
