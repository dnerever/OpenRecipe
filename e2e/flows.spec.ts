import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * The three flows docs/ARCHITECTURE.md §6 names — sign up → create → view, fork →
 * edit, propose → merge — driven through the browser the way a person would.
 * The API suites already cover the rules underneath; these cover the wiring:
 * that each button reaches the endpoint it should and the page that follows
 * shows the result.
 *
 * Every run signs up fresh cooks, so the flows never depend on what a
 * database already holds and can run side by side.
 */

const run = Date.now().toString(36);
const PASSWORD = 'e2e-password-long-enough';

type Cook = { handle: string; page: Page };

async function signUp(browser: Browser, name: string): Promise<Cook> {
  const handle = `e2e-${name}-${run}-${Math.random().toString(36).slice(2, 6)}`;
  const page = await (await browser.newContext()).newPage();

  // The form's own sign-up is emailed-code verified, and a test can't read
  // that inbox — so the account is made through the API, and the form is used
  // to sign in, which is what the rest of each flow needs.
  const email = `${handle}@example.test`;
  const created = await page.request.post('/api/auth/sign-up/email', {
    data: { email, password: PASSWORD, name, handle },
  });
  expect(created.ok()).toBe(true);
  await page.context().clearCookies();

  await page.goto('/signin');
  await page.getByRole('tab', { name: 'Sign in' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();

  // A signed-in visit to /signin moves on to your own profile.
  await expect(page).toHaveURL(`/${handle}`);
  return { handle, page };
}

/** Publishes the editor's starter recipe — "My First Loaf" — as-is. */
async function publishStarter({ page, handle }: Cook): Promise<string> {
  await page.goto('/new');
  await page.getByRole('button', { name: 'Publish recipe' }).click();
  await expect(page).toHaveURL(new RegExp(`^.*/${handle}/[a-z0-9-]+$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My First Loaf');
  return new URL(page.url()).pathname;
}

/** Appends a line to the end of the open recipe editor. */
async function appendToEditor(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(`\n\n${text}`);
}

test('sign up, publish a recipe, and read it back', async ({ browser }) => {
  const cook = await signUp(browser, 'author');
  const path = await publishStarter(cook);

  // Signed out, from a fresh context: a public recipe is public.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(path);
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('My First Loaf');
  await expect(visitor.getByText(`@${cook.handle}`).first()).toBeVisible();
});

test('fork someone else’s recipe and edit the copy', async ({ browser }) => {
  const author = await signUp(browser, 'author');
  const source = await publishStarter(author);

  const forker = await signUp(browser, 'forker');
  const { page } = forker;
  await page.goto(source);
  await page.getByText('More', { exact: true }).click();
  await page.getByRole('button', { name: 'Fork' }).click();
  await expect(page).toHaveURL(new RegExp(`/${forker.handle}/`));
  await expect(page.getByText(`@${author.handle}`).first()).toBeVisible();

  await page.getByRole('link', { name: 'Edit' }).click();
  await appendToEditor(page, 'Rest the loaf an hour before slicing.');
  await page.getByLabel('What changed?').fill('Let it cool');
  await page.getByRole('button', { name: 'Save version' }).click();

  await expect(page.getByText('Rest the loaf an hour before slicing.')).toBeVisible();
  // The original is untouched.
  await page.goto(source);
  await expect(page.getByText('Rest the loaf an hour before slicing.')).toHaveCount(0);
});

test('propose a change, and the owner merges it', async ({ browser }) => {
  const owner = await signUp(browser, 'owner');
  const source = await publishStarter(owner);

  const proposer = await signUp(browser, 'proposer');
  const { page } = proposer;
  await page.goto(source);
  await page.getByRole('button', { name: 'Propose a change' }).click();
  await appendToEditor(page, 'Bake until it sounds hollow when tapped.');
  await page.getByLabel('What changed?').fill('Add a doneness test');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByLabel('Title')).toHaveValue('Add a doneness test');
  await page.getByRole('button', { name: 'Open proposal' }).click();
  await expect(page).toHaveURL(new RegExp(`${source}/proposals/\\d+$`));
  const proposal = new URL(page.url()).pathname;

  // Only the owner may merge, so the proposer is not offered the button.
  await expect(page.getByRole('button', { name: 'Merge proposal' })).toHaveCount(0);

  await owner.page.goto(proposal);
  await owner.page.getByRole('button', { name: 'Merge proposal' }).click();
  await expect(owner.page.getByText(/^Merged as version/)).toBeVisible();

  await owner.page.goto(source);
  await expect(owner.page.getByText('Bake until it sounds hollow when tapped.')).toBeVisible();
});
