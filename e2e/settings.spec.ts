import { expect, test, type Page } from '@playwright/test';

/**
 * Account settings through the browser: change the password, and manage
 * sessions. The accounts are made through the API because sign-up is
 * emailed-code verified; each test deletes the one it made.
 */

const run = Date.now().toString(36);
const PASSWORD = 'e2e-password-long-enough';
const NEW_PASSWORD = 'e2e-a-different-password';

async function createAndSignIn(page: Page, name: string) {
  const handle = `e2e-${name}-${run}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `${handle}@example.test`;
  const created = await page.request.post('/api/auth/sign-up/email', {
    data: { email, password: PASSWORD, name, handle },
  });
  expect(created.ok()).toBe(true);
  return { email, handle };
}

async function remove(page: Page, email: string, passwords: string[]) {
  for (const password of passwords) {
    const res = await page.request.post('/api/auth/sign-in/email', { data: { email, password } });
    if (!res.ok()) continue;
    await page.request.post('/api/auth/delete-user', { data: { password } });
    return;
  }
}

test('change your password from settings', async ({ page }) => {
  const { email } = await createAndSignIn(page, 'chpw');
  try {
    await page.goto('/settings');
    await page.getByLabel('Current password').fill('wrong-password-here');
    await page.getByLabel('New password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.locator('p.bad')).toBeVisible();

    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Password changed.')).toBeVisible();

    const old = await page.request.post('/api/auth/sign-in/email', {
      data: { email, password: PASSWORD },
    });
    expect(old.ok()).toBe(false);
    const fresh = await page.request.post('/api/auth/sign-in/email', {
      data: { email, password: NEW_PASSWORD },
    });
    expect(fresh.ok()).toBe(true);
  } finally {
    await remove(page, email, [NEW_PASSWORD, PASSWORD]);
  }
});

test('see active sessions and sign out the others', async ({ page, browser }) => {
  const { email } = await createAndSignIn(page, 'sess');
  const other = await (await browser.newContext()).newPage();
  try {
    const second = await other.request.post('/api/auth/sign-in/email', {
      data: { email, password: PASSWORD },
    });
    expect(second.ok()).toBe(true);

    await page.goto('/settings');
    await expect(page.getByText('this device')).toHaveCount(1);
    await expect(
      page.locator('section.panel', { hasText: 'Active sessions' }).locator('li'),
    ).toHaveCount(2);

    await page.getByRole('button', { name: 'Sign out everywhere else' }).click();
    await expect(page.getByText('Signed out everywhere else.')).toBeVisible();
    await expect(
      page.locator('section.panel', { hasText: 'Active sessions' }).locator('li'),
    ).toHaveCount(1);

    const me = await other.request.get('/api/me');
    expect((await me.json()).user).toBeNull();
  } finally {
    await remove(page, email, [PASSWORD]);
  }
});
