import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { cleanupRun } from './test-support.ts';
import { renderShellWithRecipeMeta } from './og.ts';
import { db } from './db/index.ts';

const app = createApp();
const run = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'correct-horse-battery-staple';

// Mirrors apps/web/index.html's real shape: a default-meta block the recipe
// route must strip, so the test exercises the same dedup logic production hits.
const SHELL = `<!doctype html>
<html>
  <head>
    <!-- default-meta:start -->
    <title>OpenRecipe</title>
    <meta name="description" content="Generic OpenRecipe description." />
    <meta property="og:title" content="OpenRecipe" />
    <meta property="og:description" content="Generic OpenRecipe description." />
    <!-- default-meta:end -->
  </head>
  <body></body>
</html>
`;

type Session = { cookie: string; id: string; handle: string };

async function newUser(name: string): Promise<Session> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `og-${run}-${name}@example.test`, password: PASSWORD, name }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const cookie = res.headers.get('set-cookie') ?? '';

  const me = await app.request('/api/me', { headers: { Cookie: cookie } });
  const body = (await me.json()) as { user: { id: string; handle: string } };
  return { cookie, id: body.user.id, handle: body.user.handle };
}

async function create(
  session: Session,
  content: string,
  overrides: { slug?: string; visibility?: 'public' | 'private' } = {},
) {
  const res = await app.request('/api/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
    body: JSON.stringify({ content, ...overrides }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()) as { recipe: { slug: string } };
}

let owner: Session;

describe('renderShellWithRecipeMeta', () => {
  before(async () => {
    owner = await newUser('owner');
  });

  after(() => cleanupRun(`og-${run}-`));

  it('splices title, description and og tags in for a public recipe', async () => {
    const content = `---
schema: 1
title: <b>Sourdough</b> & Rye
description: A loaf with "character" & a long ferment.
image: https://example.test/loaf.jpg
ingredients:
  - { qty: 500, unit: g, item: bread flour }
---

## Bake
Bake it.
`;
    const { recipe } = await create(owner, content, { slug: `og-public-${run}` });

    const html = await renderShellWithRecipeMeta(SHELL, db, owner.handle, recipe.slug, null);

    assert.ok(
      html.includes('<title>&lt;b&gt;Sourdough&lt;/b&gt; &amp; Rye · OpenRecipe</title>'),
      html,
    );
    assert.ok(
      html.includes('property="og:title" content="&lt;b&gt;Sourdough&lt;/b&gt; &amp; Rye"'),
    );
    assert.ok(
      html.includes(
        'property="og:description" content="A loaf with &quot;character&quot; &amp; a long ferment."',
      ),
    );
    assert.ok(html.includes('property="og:image" content="https://example.test/loaf.jpg"'));
    assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
    // The static defaults are removed, not just superseded — a crawler that
    // takes the first of a duplicated tag must not see the generic one.
    assert.equal(html.match(/<title>/g)?.length, 1);
    assert.equal(html.match(/property="og:title"/g)?.length, 1);
    assert.equal(html.match(/property="og:description"/g)?.length, 1);
  });

  it('falls back to a generic description when the recipe has none', async () => {
    const content = `---
schema: 1
title: Plain Loaf
ingredients:
  - { qty: 500, unit: g, item: bread flour }
---

## Bake
Bake it.
`;
    const { recipe } = await create(owner, content, { slug: `og-no-desc-${run}` });

    const html = await renderShellWithRecipeMeta(SHELL, db, owner.handle, recipe.slug, null);

    assert.ok(html.includes(`A recipe by @${owner.handle} on OpenRecipe.`));
    assert.ok(!html.includes('og:image'));
    assert.ok(html.includes('name="twitter:card" content="summary"'));
  });

  it('resolves an uploaded image path against APP_URL', async () => {
    const content = `---
schema: 1
title: Uploaded Photo Loaf
image: /api/media/abc123
ingredients:
  - { qty: 500, unit: g, item: bread flour }
---

## Bake
Bake it.
`;
    const { recipe } = await create(owner, content, { slug: `og-uploaded-${run}` });

    const html = await renderShellWithRecipeMeta(SHELL, db, owner.handle, recipe.slug, null);

    assert.ok(
      html.includes('property="og:image" content="http://localhost:5173/api/media/abc123"'),
    );
  });

  it('falls back to the plain shell for a private recipe the viewer cannot read', async () => {
    const content = `---
schema: 1
title: Secret Loaf
ingredients:
  - { qty: 500, unit: g, item: bread flour }
---

## Bake
Bake it.
`;
    const { recipe } = await create(owner, content, {
      slug: `og-private-${run}`,
      visibility: 'private',
    });

    const anonymous = await renderShellWithRecipeMeta(SHELL, db, owner.handle, recipe.slug, null);
    assert.equal(anonymous, SHELL);

    const asOwner = await renderShellWithRecipeMeta(SHELL, db, owner.handle, recipe.slug, {
      id: owner.id,
    });
    assert.ok(asOwner.includes('Secret Loaf'));
  });

  it('falls back to the plain shell for a nonexistent recipe', async () => {
    const html = await renderShellWithRecipeMeta(SHELL, db, owner.handle, 'does-not-exist', null);
    assert.equal(html, SHELL);
  });
});
