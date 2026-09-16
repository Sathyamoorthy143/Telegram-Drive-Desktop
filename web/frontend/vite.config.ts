import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify('https://telegram-drive-web-1dvn.onrender.com'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhldnBhbHZ3ZnV3cmtlZHV6cHR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MDg2NTksImV4cCI6MjEwMzk4NDY1OX0.4d1vqdHxiUE5uELZAwXHi3vjmLYsPCycXfSFhMFkdrs'),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://hevpalvwfuwrkeduzptv.supabase.co'),
  },
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  test: {
    globals: true,
  },
});
