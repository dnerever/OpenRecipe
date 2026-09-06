import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    /**
     * Same-origin in the browser, so session cookies just work — and
     * deliberately NOT rewriting the `/api` prefix away. better-auth derives
     * OAuth callback URLs from the browser-visible path, so the path the
     * browser uses and the path the API serves have to be the same one.
     */
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
});
