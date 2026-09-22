import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { env } from './env.ts';
import { captureException, initSentry } from './services/sentry.ts';

initSentry();

// A safety net for anything outside a request's own try/catch — Hono's own
// error handling in app.ts covers everything thrown while serving a request.
process.on('uncaughtException', (err) => {
  captureException(err);
  console.error(err);
});
process.on('unhandledRejection', (err) => {
  captureException(err);
  console.error(err);
});

serve({ fetch: createApp().fetch, port: env.PORT }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
