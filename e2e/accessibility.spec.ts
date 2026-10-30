import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const run = Date.now().toString(36);
const PASSWORD = 'e2e-password-long-enough';

async function checkAccessibility(page: Page, name: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  const details = violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `  ${node.target.join(', ')}: ${node.failureSummary?.trim() ?? ''}`)
        .join('\n');
      return `${violation.id} (${violation.impact}): ${violation.help}\n${nodes}`;
    })
    .join('\n');

  expect(violations, `${name} has WCAG accessibility violations:\n${details}`).toHaveLength(0);
}

test('the public landing page and sign-in form meet WCAG checks', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Every recipe, with its history.' }),
  ).toBeVisible();
  await checkAccessibility(page, 'Public landing page');

  await page.goto('/signin');
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await checkAccessibility(page, 'Sign-in page');
});

test('the recipe editor, recipe page, and cook mode meet WCAG checks', async ({ page }) => {
  const handle = `e2e-a11y-${run}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `${handle}@example.test`;
  const created = await page.request.post('/api/auth/sign-up/email', {
    data: { email, password: PASSWORD, name: 'Accessibility tester', handle },
  });
  expect(created.ok()).toBe(true);

  try {
    await page.context().clearCookies();
    await page.goto('/signin');
    await page.getByRole('tab', { name: 'Sign in' }).click();
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(`/${handle}`);

    await page.goto('/new');
    await expect(page.getByRole('heading', { name: 'New recipe' })).toBeVisible();
    await checkAccessibility(page, 'New recipe editor');

    await page.getByLabel('Title', { exact: true }).fill('Accessibility loaf');
    await page.getByLabel('Amount', { exact: true }).fill('500');
    await page.getByLabel('Unit', { exact: true }).fill('g');
    await page.getByLabel('Ingredient', { exact: true }).fill('bread flour');
    await page.getByLabel('Step 1', { exact: true }).fill('Mix the dough, then bake until golden.');
    await page.getByRole('button', { name: 'Publish recipe' }).click();
    await expect(page.getByRole('heading', { name: 'Accessibility loaf' })).toBeVisible();
    await checkAccessibility(page, 'Recipe page');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('link', { name: 'Cook', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Accessibility loaf' })).toBeVisible();
    await expect(page.getByText('Step 1 of 1')).toBeVisible();
    await checkAccessibility(page, 'Mobile cook mode');
  } finally {
    const signedIn = await page.request.post('/api/auth/delete-user', {
      data: { password: PASSWORD },
    });
    if (!signedIn.ok()) {
      const login = await page.request.post('/api/auth/sign-in/email', {
        data: { email, password: PASSWORD },
      });
      if (login.ok()) {
        await page.request.post('/api/auth/delete-user', { data: { password: PASSWORD } });
      }
    }
  }
});
