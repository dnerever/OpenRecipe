import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { env } from './env.ts';

serve({ fetch: createApp().fetch, port: env.PORT }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
