/**
 * End-to-end tests of the docs UI in a real browser, against the fixture
 * Express app (test/ui/fixture) through the standalone docs server.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

let pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto('/docs');
  await expect(page.locator('.hero h1')).toHaveText('UI Fixture');
});

test.afterEach(() => {
  expect(pageErrors, 'uncaught errors in the page').toEqual([]);
});

const openItem = (page: Page, text: string) => page.locator('aside .nav-item', { hasText: text }).first().click();
const status = (page: Page) => page.locator('.resp-card .status-pill');
const responseBody = (page: Page) => page.locator('.resp-card .code');

async function login(page: Page) {
  await openItem(page, 'Sign in');
  await page.locator('.send-btn').click();
  await expect(status(page)).toContainText('200 OK');
}

async function axeViolations(page: Page) {
  await page.waitForTimeout(350); // let entrance animations settle before measuring contrast
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const result = await (window as any).axe.run(document, { resultTypes: ['violations'] });
    return result.violations.map((v: any) => `${v.id}: ${v.nodes.map((n: any) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  });
}

test('overview lists endpoints, realtime events and scenarios with readable names', async ({ page }) => {
  await expect(page.locator('.stat').first()).toContainText('5');
  await expect(page.locator('aside')).toContainText('Sign in and receive an access token');
  await expect(page.locator('aside .nav-item:has(.m-ws)')).toHaveCount(1);
  await expect(page.locator('aside .nav-item:has(.m-flow)').first()).toBeVisible();
});

test('logging in captures the token and authorizes protected requests', async ({ page }) => {
  await openItem(page, 'Sign in');
  await expect(page.locator('.tab-panel textarea')).toHaveValue(/"username"/);
  await page.locator('.send-btn').click();
  await expect(status(page)).toContainText('200 OK');
  await expect(page.locator('.tb-btn.has-auth')).toBeVisible();
  await expect(page.locator('.toast')).toContainText('Bearer token captured');

  // Signing in again (this API hands out a fixed token) still confirms it.
  await page.locator('.send-btn').click();
  await expect(page.locator('.toast')).toContainText('already applied');

  await openItem(page, 'Get a user by id');
  await page.locator('.send-btn').click();
  await expect(status(page)).toContainText('200 OK');
  await expect(responseBody(page)).toContainText('Ada Lovelace');
});

test('a protected request without a token shows 401', async ({ page }) => {
  await openItem(page, 'List all users');
  await page.locator('.send-btn').click();
  await expect(status(page)).toContainText('401');
});

test('uploads a file as multipart/form-data', async ({ page }, testInfo) => {
  await login(page);
  await openItem(page, 'avatar');
  await page.locator('.tab', { hasText: 'Body' }).click();
  await expect(page.locator('.seg button[aria-checked="true"]')).toHaveText('Form data');
  const file = testInfo.outputPath('avatar.png');
  fs.writeFileSync(file, Buffer.alloc(2048, 7));
  await page.setInputFiles('.file-pick input[type=file]', file);
  await expect(page.locator('.file-chip')).toContainText('avatar.png');

  await page.locator('.send-btn').click();
  await expect(status(page)).toContainText('201');
  await expect(responseBody(page)).toContainText('"size": 2048');

  await page.locator('.tab', { hasText: 'Code' }).click();
  await expect(page.locator('.tab-panel .code')).toContainText("-F 'avatar=@avatar.png'");
});

test('mock mode answers from the documented schema', async ({ page }) => {
  await openItem(page, 'List all users');
  await page.locator('.mock-switch button', { hasText: 'Mock' }).click();
  await expect(page.locator('.url-bar .url-input')).toHaveValue(/\/specscribe-mock\/api\/users$/);
  await page.locator('.send-btn').click();
  await expect(status(page)).toContainText('200');
  await expect(page.locator('.mock-badge')).toBeVisible();
});

test('falls back to a clearly labelled mock when the API is unreachable', async ({ page }) => {
  await page.route('**/__specscribe_proxy/**', (route) =>
    route.fulfill({ status: 502, contentType: 'application/json', body: '{"message":"down"}' }));
  await openItem(page, 'List all users');
  await page.locator('.send-btn').click();
  await expect(page.locator('.mock-badge')).toBeVisible();
  await expect(page.locator('.mock-note')).toContainText('API unreachable');
});

test('runs a generated scenario end to end', async ({ page }) => {
  await page.locator('aside .nav-item:has(.m-flow)', { hasText: 'Users' }).first().click();
  await page.locator('.send-btn').click();
  await expect(page.locator('.run-summary .pass')).toBeVisible({ timeout: 20_000 });
  const failures = await page.locator('.step.fail .step-failures').allTextContents();
  expect(failures).toEqual([]);
  await expect(page.locator('.step.pass')).toHaveCount(await page.locator('.step').count());
});

test('detects a plain WebSocket server and round-trips a message', async ({ page }) => {
  await page.locator('aside .nav-item:has(.m-ws)').first().click();
  await expect(page.locator('.url-select')).toHaveValue('ws');
  await page.locator('.send-btn').click();
  await expect(page.locator('.conn.connected')).toBeVisible();
  await page.locator('.composer textarea').fill('"hello"');
  await page.locator('.composer .btn.primary').click();
  await expect(page.locator('.log-entry.in')).toContainText('pong');
});

test('the JSON viewer folds, captures a clicked value and searches', async ({ page }) => {
  await login(page);
  await openItem(page, 'List all users');
  await page.locator('.send-btn').click();
  await expect(page.locator('.jt')).toContainText('"name": "Ada Lovelace"');

  // Fold the first user, then unfold it from the inline placeholder.
  await page.locator('.jt-tog').nth(1).click();
  await expect(page.locator('.jt-sum').first()).toHaveText('3 keys');
  await page.locator('.jt-fold').first().click();
  await expect(page.locator('.jt-sum')).toHaveCount(0);

  // Clicking a value prepares the capture row with its path.
  await page.locator('.jv', { hasText: 'alan@example.com' }).click();
  await expect(page.locator('.capture input.mono')).toHaveValue('[1].email');
  await expect(page.locator('.capture input').first()).toHaveValue('email');
  await page.locator('.capture .btn').click();
  await expect(page.locator('.var-chip', { hasText: 'email' })).toBeVisible();

  await page.locator('.resp-search input').fill('ada');
  await expect(page.locator('.resp-count')).toHaveText('1/2');
  await page.locator('.resp-search input').press('Enter');
  await expect(page.locator('.resp-count')).toHaveText('2/2');
  await expect(page.locator('mark.hit.cur')).toHaveCount(1);
});

test('large responses render in pages instead of freezing the page', async ({ page }) => {
  const big = JSON.stringify(Array.from({ length: 20_000 }, (_, i) => ({ id: i, name: `User ${i}` })));
  await page.route('**/__specscribe_proxy/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: big, headers: { 'x-specscribe-proxied': '1' } }));
  await openItem(page, 'List all users');
  const started = Date.now();
  await page.locator('.send-btn').click();
  await expect(page.locator('.jt-more')).toContainText('19900');
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(await page.locator('.jt .jl').count()).toBeLessThan(800);
  await page.locator('.resp-search input').fill('User 19999');
  await expect(page.locator('.resp-count')).toHaveText('1/1');
});

test('a hanging request can be cancelled, times out, and can be retried', async ({ page }) => {
  await page.route('**/__specscribe_proxy/**', () => { /* never answers */ });
  await openItem(page, 'List all users');
  await page.locator('.send-btn').click();
  await page.locator('.send-btn.danger').click();
  await expect(page.locator('.empty-state.error')).toContainText('Request cancelled');

  await page.locator('.send-btn').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.empty-state.error')).toContainText('Request cancelled');

  await page.evaluate(() => localStorage.setItem('specscribe-timeout', '1'));
  await page.reload();
  await page.locator('.send-btn').click();
  await expect(page.locator('.empty-state.error')).toContainText('No response after 1 s');
  // A timed-out request is not reported as "API down": no mock stand-in.
  await expect(page.locator('.mock-badge')).toHaveCount(0);

  await page.unroute('**/__specscribe_proxy/**');
  await page.locator('.empty-state.error .btn').click();
  await expect(status(page)).toContainText('401');
});

test('keeps several requests open in tabs, each with its own state', async ({ page }) => {
  await login(page);
  await openItem(page, 'Create a user');
  // Views swap inside a view transition: wait for the new one before typing.
  await expect(page.locator('main h1')).toContainText('Create a user');
  await page.locator('.tab-panel textarea').fill('{ "name": "Tab Test", "email": "t@example.com" }');
  await openItem(page, 'List all users');
  await expect(page.locator('main h1')).toContainText('List all users');
  await page.locator('.send-btn').click();
  await expect(status(page)).toContainText('200');
  await expect(page.locator('.wtab')).toHaveCount(3);

  // Back to the first tab: the edited body is still there, the response area is its own.
  await page.locator('.wtab-main', { hasText: 'Create a user' }).click();
  await expect(page.locator('.tab-panel textarea')).toHaveValue(/Tab Test/);
  await expect(page.locator('.resp-card .status-pill')).toHaveCount(0);
  await page.locator('.wtab-main', { hasText: 'List all users' }).click();
  await expect(status(page)).toContainText('200');

  // Tabs and typed input survive a reload.
  await page.reload();
  await expect(page.locator('.wtab')).toHaveCount(3);
  await page.locator('.wtab-main', { hasText: 'Create a user' }).click();
  await expect(page.locator('.tab-panel textarea')).toHaveValue(/Tab Test/);

  // Closing the active tab moves to its neighbour.
  await page.locator('.wtab.on .wtab-close').click();
  await expect(page.locator('.wtab')).toHaveCount(2);
  await expect(page.locator('.wtab.on')).toHaveCount(1);
});

test('exports and imports environments (incl. Postman), credentials off on import', async ({ page }, testInfo) => {
  await page.locator('.tb-btn', { hasText: 'Environments' }).click();
  await page.locator('.pop input').first().fill('staging');
  await page.locator('.pop input.mono').fill('http://localhost:4510');
  await page.locator('.pop textarea').fill('userId=2');
  await page.locator('.pop .btn.primary').click();

  // The panel stays open after saving.
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.pop .btn', { hasText: 'Export' }).click()]);
  const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  expect(exported).toMatchObject({ format: 'specscribe-environments', environments: [{ name: 'staging', vars: { userId: '2' } }] });

  const postman = testInfo.outputPath('prod.postman_environment.json');
  fs.writeFileSync(postman, JSON.stringify({ name: 'Prod', values: [{ key: 'baseUrl', value: 'https://api.example.com', enabled: true }] }));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.pop .btn', { hasText: 'Import' }).click()]);
  await chooser.setFiles(postman);
  await expect(page.locator('.toast')).toContainText('credentials are off');
  await expect(page.locator('.env-chip', { hasText: 'Prod' })).toBeVisible();
  await expect(page.locator('.pop input.mono')).toHaveValue('https://api.example.com');
  await expect(page.locator('.pop .check-row input')).not.toBeChecked();
});

test('the command palette jumps to an endpoint', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await page.locator('.palette input').fill('avatar');
  await page.keyboard.press('Enter');
  await expect(page.locator('.req-title h1')).toHaveText("Upload a user's avatar");
});

test('can be driven by keyboard alone', async ({ page }) => {
  await page.keyboard.press('/');
  await expect(page.locator('#ss-search')).toBeFocused();
  await page.keyboard.type('sign in');
  let reached = false;
  for (let i = 0; i < 30 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => !!document.activeElement?.closest('aside .nav-item'));
  }
  expect(reached).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator('.req-title h1')).toHaveText('Sign in and receive an access token');
  await page.keyboard.press('Control+Enter');
  await expect(status(page)).toContainText('200 OK');
});

test('switches to Arabic (RTL) and the light theme', async ({ page }) => {
  await page.locator('.tb-icon:has(.lang-glyph)').click();
  await expect(page.locator('specscribe-docs')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.nav-overview')).toContainText('نظرة عامة');
  await page.locator('.theme-btn').click();
  await expect(page.locator('specscribe-docs')).toHaveClass(/classic/);
});

for (const theme of ['dark', 'light'] as const) {
  test(`has no accessibility violations (${theme} theme)`, async ({ page }) => {
    if (theme === 'light') await page.locator('.theme-btn').click();
    expect(await axeViolations(page), 'overview').toEqual([]);
    await login(page);
    expect(await axeViolations(page), 'request + response').toEqual([]);
    await openItem(page, 'avatar');
    await page.locator('.tab', { hasText: 'Body' }).click();
    expect(await axeViolations(page), 'form-data body').toEqual([]);
    await page.locator('aside .nav-item:has(.m-ws)').first().click();
    expect(await axeViolations(page), 'websocket').toEqual([]);
    await page.locator('aside .nav-item:has(.m-flow)').first().click();
    expect(await axeViolations(page), 'scenario').toEqual([]);
    await page.keyboard.press('Control+k');
    expect(await axeViolations(page), 'command palette').toEqual([]);
  });
}

test('fits a phone screen without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.locator('.menu-btn').click();
  await expect(page.locator('aside.open')).toBeVisible();
  await openItem(page, 'Sign in');
  await expect(page.locator('aside.open')).toHaveCount(0);
  await page.locator('.send-btn').click();
  await expect(status(page)).toContainText('200 OK');
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test('a static export works offline from disk', async ({ page }, testInfo) => {
  const { StaticDocsExporter } = require('../../dist/standalone/StaticDocsExporter');
  const spec = await (await page.request.get('/docs-json')).json();
  const dir = testInfo.outputPath('site');
  StaticDocsExporter.write(dir, { spec, title: 'Exported' });
  await page.goto('file:///' + path.join(dir, 'index.html').replace(/\\/g, '/'));
  await expect(page.locator('.hero h1')).toHaveText('UI Fixture');
  await expect(page.locator('aside')).toContainText('List all users');
  await expect(page.locator('aside .nav-item:has(.m-flow)').first()).toBeVisible();
});
