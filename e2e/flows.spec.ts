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

/** Writes "My First Loaf" into the form editor on /new and publishes it. */
async function publishStarter({ page, handle }: Cook): Promise<string> {
  await page.goto('/new');
  await page.getByLabel('Title', { exact: true }).fill('My First Loaf');
  await page.getByLabel('Amount', { exact: true }).fill('500');
  await page.getByLabel('Unit', { exact: true }).fill('g');
  await page.getByLabel('Ingredient', { exact: true }).fill('bread flour');
  await page
    .getByLabel('Step 1', { exact: true })
    .fill('Mix, prove and bake at 230°C for 40 minutes.');
  await page.getByRole('button', { name: 'Publish recipe' }).click();
  await expect(page).toHaveURL(new RegExp(`^.*/${handle}/[a-z0-9-]+$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My First Loaf');
  return new URL(page.url()).pathname;
}

/** Appends a line to the end of the open recipe editor, in its source view. */
async function appendToEditor(page: Page, text: string): Promise<void> {
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(`\n\n${text}`);
}

test('the form editor writes a recipe without any YAML', async ({ browser }) => {
  const { page, handle } = await signUp(browser, 'formcook');
  await page.goto('/new');

  // Nothing typed yet, nothing flagged yet.
  await expect(page.locator('.field-error')).toHaveCount(0);

  await page.getByLabel('Title', { exact: true }).fill('Pancakes');
  await page.getByLabel('How many it makes', { exact: true }).fill('8');
  await page.getByLabel('Of what', { exact: true }).fill('pancakes');
  await page.getByLabel('Prep', { exact: true }).fill('10');

  await page.getByLabel('Amount', { exact: true }).fill('a cup');
  await page.getByLabel('Unit', { exact: true }).focus();
  await expect(page.getByText('Write the amount as a number')).toBeVisible();
  await page.getByLabel('Amount', { exact: true }).fill('1 1/2');
  await expect(page.getByText('Write the amount as a number')).toHaveCount(0);
  await page.getByLabel('Unit', { exact: true }).fill('cup');
  await page.getByLabel('Ingredient', { exact: true }).fill('flour');
  // Enter starts the next ingredient, focused.
  await page.keyboard.press('Enter');
  await page.keyboard.type('2');
  await expect(page.getByLabel('Amount', { exact: true }).nth(1)).toHaveValue('2');
  await page.getByLabel('Ingredient', { exact: true }).nth(1).fill('eggs');

  await page.getByLabel('Step 1', { exact: true }).fill('Whisk everything together.');
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByLabel('Step 2', { exact: true }).fill('Cook 2 minutes a side.');

  // The source view is the same recipe as text.
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('title: Pancakes');
  await page.getByRole('button', { name: 'Form', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Pancakes');

  await page.getByRole('button', { name: 'Publish recipe' }).click();
  await expect(page).toHaveURL(new RegExp(`/${handle}/pancakes$`));
  await expect(page.getByRole('checkbox', { name: '1½ cups flour' })).toBeVisible();
  await expect(page.getByText('Cook 2 minutes a side.')).toBeVisible();
});

test('an unpublished recipe asks before leaving, and comes back if you do', async ({ browser }) => {
  const { page } = await signUp(browser, 'unsaved');
  await page.goto('/new');
  await page.getByLabel('Title', { exact: true }).fill('Half-written soup');
  await page.getByLabel('Ingredient', { exact: true }).fill('leeks');

  // Keep editing: still here, nothing lost. Escape answers the same way.
  await page.getByRole('link', { name: 'OpenSkillet' }).click();
  const leave = page.getByRole('dialog', { name: 'Leave this page?' });
  await leave.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await page.getByRole('link', { name: 'OpenSkillet' }).click();
  await page.keyboard.press('Escape');
  await expect(leave).toBeHidden();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Half-written soup');

  // Accept it: gone — and back again on return, from this browser.
  await page.getByRole('link', { name: 'OpenSkillet' }).click();
  await leave.getByRole('button', { name: 'Leave' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/new');
  await expect(page.getByText('Picked up where you left off')).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Half-written soup');
  await expect(page.getByLabel('Ingredient', { exact: true })).toHaveValue('leeks');

  // Discarding it is one tap, and it stays discarded.
  await page.getByRole('button', { name: 'Discard it' }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('');
  await page.reload();
  await expect(page.getByText('Picked up where you left off')).toHaveCount(0);
});

test('sign up, publish a recipe, and read it back', async ({ browser }) => {
  const cook = await signUp(browser, 'author');
  const path = await publishStarter(cook);

  // Signed out, from a fresh context: a public recipe is public.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(path);
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('My First Loaf');
  await expect(visitor.getByText(`@${cook.handle}`).first()).toBeVisible();

  // A licence on its own, with nothing to separate it from.
  await expect(visitor.locator('.source')).toHaveText('CC-BY-SA-4.0');
  await expect(visitor.getByText(/^Last changed just now/)).toBeVisible();

  // Each page names its tab, including after client-side navigation.
  await expect(visitor).toHaveTitle('My First Loaf · OpenSkillet');
  await visitor.getByRole('link', { name: 'Cook' }).first().click();
  await expect(visitor).toHaveTitle('Cooking: My First Loaf · OpenSkillet');
});

test('fork someone else’s recipe and edit the copy', async ({ browser }) => {
  const author = await signUp(browser, 'author');
  const source = await publishStarter(author);

  const forker = await signUp(browser, 'forker');
  const { page } = forker;
  await page.goto(source);

  // The menu closes the way menus do: Escape, or a press anywhere else.
  const fork = page.getByRole('button', { name: 'Fork to my recipes' });
  await page.getByText('More', { exact: true }).click();
  await expect(fork).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(fork).toBeHidden();
  await page.getByText('More', { exact: true }).click();
  await page.getByRole('heading', { level: 1 }).click();
  await expect(fork).toBeHidden();

  await page.getByText('More', { exact: true }).click();
  await fork.click();
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

  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Add a doneness test');
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

test('a page that names nothing is a real 404, with a page to match', async ({ page }) => {
  const response = await page.goto('/nobody-has-this-handle/no-such-recipe');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');
  await expect(page).toHaveTitle('Not found · OpenSkillet');
});

test('a recipe opened online can be opened, and cooked, offline', async ({ browser }) => {
  const author = await signUp(browser, 'offline');
  const path = await publishStarter(author);

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(path);
  // The worker installs on the first visit and controls the page from the next.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My First Loaf');

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My First Loaf');
  await expect(page.getByText('You’re offline.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Cook' }).first().click();
  await expect(page.getByText(/Step 1 of/)).toBeVisible();
  await context.close();
});
