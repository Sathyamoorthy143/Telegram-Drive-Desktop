import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: ['.monkeycode-ai.live'],
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    // Split the big third-party deps into their own chunks so app-code
    // deploys don't bust caches for vendor bytes (and vice versa).
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Heavy libraries get stable, separately-cacheable chunks so app
          // deploys never re-download them and the main bundle stays small.
          // (Function form: only matches real module files, never synthesizes
          // empty chunks for barrel-less packages like pdfjs-dist.)
          if (id.includes('node_modules/three') || id.includes('node_modules/@react-three')) return 'vendor_three';
          if (id.includes('node_modules/pdfjs-dist')) return 'vendor_pdf';
          if (
            id.includes('node_modules/xlsx') ||
            id.includes('node_modules/mammoth') ||
            id.includes('node_modules/jszip') ||
            id.includes('node_modules/docx') ||
            id.includes('node_modules/pptxgenjs')
          ) return 'vendor_office';
          if (
            id.includes('node_modules/@univerjs') ||
            id.includes('node_modules/@tiptap') ||
            id.includes('node_modules/prosemirror') ||
            id.includes('node_modules/tiptap-markdown')
          ) return 'vendor_editor';
          if (id.includes('node_modules/lucide-react')) return 'vendor_icons';
          if (id.includes('node_modules/framer-motion')) return 'vendor_motion';
          if (id.includes('node_modules/@tanstack/react-query')) return 'vendor_query';
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          ) return 'vendor_react';
        },
      },
    },
  },
  test: {
    globals: true,
    setupFiles: ['./src/testSetup.ts'],
  },
});
