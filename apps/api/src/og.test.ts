import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { cleanupRun } from './test-support.ts';
import { metaForPath, renderPage } from './og.ts';
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
    <title>OpenSkillet</title>
    <meta name="description" content="Generic OpenSkillet description." />
    <meta property="og:title" content="OpenSkillet" />
    <meta property="og:description" content="Generic OpenSkillet description." />
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

const render = (path: string, viewer: { id: string } | null = null) =>
  renderPage(SHELL, db, path, viewer);

const RECIPE = (title: string, extra = '') => `---
schema: 1
title: ${title}
${extra}ingredients:
  - { qty: 500, unit: g, item: bread flour }
  - { qty: null, item: salt, note: to taste }
---

## Mix
Mix it.

## Bake
Bake it for 40 minutes.
`;

describe('renderPage', () => {
  before(async () => {
    owner = await newUser('owner');
  });

  after(() => cleanupRun(`og-${run}-`));

  it('splices escaped title, description and og tags in for a public recipe', async () => {
    const { recipe } = await create(
      owner,
      RECIPE(
        '<b>Sourdough</b> & Rye',
        'description: A loaf with "character" & a long ferment.\nimage: https://example.test/loaf.jpg\n',
      ),
      { slug: `og-public-${run}` },
    );

    const { status, html } = await render(`/${owner.handle}/${recipe.slug}`);

    assert.equal(status, 200);
    assert.ok(
      html.includes('<title>&lt;b&gt;Sourdough&lt;/b&gt; &amp; Rye · OpenSkillet</title>'),
      html,
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

  it('names the canonical URL without the query, so ?scale=2 is the same page', async () => {
    const { recipe } = await create(owner, RECIPE('Canonical Loaf'), { slug: `og-canon-${run}` });
    const { html } = await render(`/${owner.handle}/${recipe.slug}`);
    assert.ok(
      html.includes(
        `<link rel="canonical" href="http://localhost:5173/${owner.handle}/${recipe.slug}" />`,
      ),
    );

    // Cook mode is the recipe again: canonical to it, and kept out of search.
    const cook = await render(`/${owner.handle}/${recipe.slug}/cook`);
    assert.ok(cook.html.includes('<title>Cooking: Canonical Loaf · OpenSkillet</title>'));
    assert.ok(cook.html.includes(`href="http://localhost:5173/${owner.handle}/${recipe.slug}"`));
    assert.ok(cook.html.includes('name="robots" content="noindex"'));
  });

  it('describes a recipe in schema.org terms, steps grouped by phase', async () => {
    const { recipe } = await create(
      owner,
      RECIPE(
        'Structured Loaf',
        'yield: { count: 2, unit: loaves }\ntime: { prep: 45m, total: 25h }\n',
      ),
      { slug: `og-ld-${run}` },
    );
    const meta = await metaForPath(db, `/${owner.handle}/${recipe.slug}`, null);
    const ld = meta.jsonLd as Record<string, unknown>;

    assert.equal(ld['@type'], 'Recipe');
    assert.equal(ld['name'], 'Structured Loaf');
    assert.equal(ld['recipeYield'], '2 loaves');
    assert.equal(ld['prepTime'], 'PT45M');
    assert.equal(ld['totalTime'], 'P1DT1H');
    assert.deepEqual(ld['recipeIngredient'], ['500 g bread flour', 'salt, to taste']);
    assert.deepEqual(
      (ld['recipeInstructions'] as { name: string }[]).map((s) => s.name),
      ['Mix', 'Bake'],
    );
    assert.equal(ld['license'], 'https://creativecommons.org/licenses/by-sa/4.0/');
  });

  it('cannot be broken out of: a title with </script> stays inside the JSON', async () => {
    const { recipe } = await create(owner, RECIPE('"</script><script>alert(1)</script>"'), {
      slug: `og-xss-${run}`,
    });
    const { html } = await render(`/${owner.handle}/${recipe.slug}`);
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
    assert.ok(ld);
    assert.ok(!ld.includes('<'));
    assert.equal((JSON.parse(ld) as { name: string }).name, '</script><script>alert(1)</script>');
  });

  it('is a 404 for a private recipe the viewer cannot read, and noindex for its owner', async () => {
    const { recipe } = await create(owner, RECIPE('Secret Loaf'), {
      slug: `og-private-${run}`,
      visibility: 'private',
    });
    const path = `/${owner.handle}/${recipe.slug}`;

    const anonymous = await render(path);
    assert.equal(anonymous.status, 404);
    assert.ok(!anonymous.html.includes('Secret Loaf'));
    assert.ok(anonymous.html.includes('<title>Not found · OpenSkillet</title>'));

    const asOwner = await render(path, { id: owner.id });
    assert.equal(asOwner.status, 200);
    assert.ok(asOwner.html.includes('Secret Loaf'));
    assert.ok(asOwner.html.includes('name="robots" content="noindex"'));
    assert.ok(!asOwner.html.includes('application/ld+json'));
  });

  it('is a 404 for paths that name nothing', async () => {
    for (const path of [
      `/${owner.handle}/does-not-exist`,
      '/nobody-has-this-handle-xyz',
      `/${owner.handle}/lists/no-such-list`,
      `/${owner.handle}/does-not-exist/history`,
      '/a/b/c/d/e',
    ]) {
      assert.equal((await render(path)).status, 404, path);
    }
  });

  it('gives profiles and static pages their own title and canonical', async () => {
    const profile = await render(`/${owner.handle}`);
    assert.equal(profile.status, 200);
    assert.ok(profile.html.includes(`<title>@${owner.handle} · OpenSkillet</title>`));
    assert.ok(profile.html.includes(`href="http://localhost:5173/${owner.handle}"`));

    const terms = await render('/terms');
    assert.ok(terms.html.includes('<title>Terms of Service · OpenSkillet</title>'));

    const settings = await render('/settings');
    assert.equal(settings.status, 200);
    assert.ok(settings.html.includes('name="robots" content="noindex"'));
  });
});

describe('response headers', () => {
  it('carry HSTS, nosniff and a framing ban on every response', async () => {
    const res = await app.request('/api/health');
    assert.match(res.headers.get('strict-transport-security') ?? '', /max-age=\d+/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
  });

  it('publish a security.txt that has not expired', async () => {
    const res = await app.request('/.well-known/security.txt');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /^Contact: https:\/\//m);
    const expires = /^Expires: (.+)$/m.exec(text)?.[1];
    assert.ok(expires && new Date(expires) > new Date());
  });
});
