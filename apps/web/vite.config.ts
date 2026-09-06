import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        /**
         * Pin the libraries every route needs into their own chunks so shipping
         * app changes doesn't invalidate them — together they are most of the
         * payload, and they change only when we upgrade a dependency.
         *
         * Deliberately narrow: anything not named here falls through to
         * Rollup's automatic splitting, which is what keeps yaml, zod and the
         * auth client inside the lazy route chunks that actually use them.
         * A blanket `node_modules -> vendor` rule would drag them back into the
         * initial load and undo the route splitting entirely.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (id.includes('@tanstack')) return 'tanstack';
          /**
           * CodeMirror is only ever reachable from the two lazy editor routes,
           * so naming it here does not pull it into the initial load — it just
           * stops the largest dependency in the app from being re-downloaded
           * every time the editor's own code changes.
           */
          if (/[\\/]node_modules[\\/]@(codemirror|lezer)[\\/]/.test(id)) return 'codemirror';
          return undefined;
        },
      },
    },
  },
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
