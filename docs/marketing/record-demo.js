// Captures the README visuals from the real docs UI of a running NestJS app:
// screenshots (docs/assets/*.png, 2x) and the demo GIF frames
// (docs/marketing/frames/*.png → assemble with make-gif.py).
//
//   node docs/marketing/record-demo.js http://localhost:3100/api/docs
//
// Uses this repository's @playwright/test; set SPECSCRIBE_CHROMIUM to use a
// local Chromium instead of Playwright's download.
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const DOCS = process.argv[2] || 'http://localhost:3100/api/docs';
const ROOT = path.resolve(__dirname, '..', '..');
const ASSETS = path.join(ROOT, 'docs', 'assets');
const FRAMES = path.join(__dirname, 'frames');
fs.mkdirSync(ASSETS, { recursive: true });
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const launch = () => chromium.launch(process.env.SPECSCRIBE_CHROMIUM ? { executablePath: process.env.SPECSCRIBE_CHROMIUM } : {});

async function fresh(page, opts = {}) {
  await page.goto(DOCS);
  await page.evaluate((layout) => { localStorage.clear(); if (layout) localStorage.setItem('specscribe-layout', layout); }, opts.layout || 'split');
  await page.goto(DOCS);
  await page.waitForSelector('.hero');
  await sleep(1200);
}
const item = (page, text) => page.locator('aside .nav-item', { hasText: text }).first();
const send = async (page) => { await page.locator('.send-btn').click(); await page.waitForSelector('.resp-card .status-pill'); await sleep(700); };
const top = (page) => page.evaluate(() => document.querySelector('main')?.scrollTo(0, 0));

async function screenshots(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const shot = async (name) => { await top(page); await sleep(300); await page.screenshot({ path: path.join(ASSETS, name) }); console.log('  ', name); };
  await fresh(page);
  await shot('overview.png');

  // A working session: login (token captured), a few tabs, a real response.
  await item(page, /login/i).click(); await send(page);
  await item(page, /create a new user/i).click();
  await item(page, /list products/i).click(); await send(page);
  await item(page, /list all users/i).click(); await send(page);
  await page.locator('.jv', { hasText: 'alice@example.com' }).click();
  await shot('workspace.png');

  await page.locator('.resp-search input').fill('bob');
  await sleep(300);
  await shot('response-search.png');
  await page.locator('.resp-search input').fill('');

  await page.keyboard.press('Control+k');
  await page.locator('.palette input').fill('prod');
  await sleep(400);
  await shot('command-palette.png');
  await page.keyboard.press('Escape');

  await item(page, /subscribeOrder/).click();
  await page.locator('.send-btn').click();
  await page.waitForSelector('.conn.connected');
  await page.locator('.composer textarea').fill('"42"');
  await page.locator('.composer .btn.primary').click();
  await sleep(900);
  await shot('websocket.png');

  await page.locator('aside .nav-item:has(.m-query)').first().click();
  await page.locator('.send-btn').click();
  await sleep(1200);
  await shot('graphql.png');

  await page.locator('aside .nav-item:has(.m-flow)').first().click();
  await page.locator('.send-btn').click();
  await page.waitForSelector('.run-summary .pass', { timeout: 30000 });
  await sleep(600);
  await shot('scenarios.png');

  // Light theme + Arabic (RTL), once the last toast has faded.
  await sleep(4500);
  await page.locator('.theme-btn').click();
  await page.locator('.tb-icon:has(.lang-glyph)').click();
  await item(page, /list all users/i).click();
  await sleep(500);
  await shot('light-rtl.png');
  await page.close();

  // Phone.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await fresh(phone);
  await item(phone, /login/i).evaluate((el) => el.scrollIntoView());
  await phone.locator('.menu-btn').click(); await sleep(300);
  await item(phone, /login/i).click(); await sleep(400);
  await phone.locator('.send-btn').click(); await phone.waitForSelector('.resp-card .status-pill'); await sleep(800);
  await phone.screenshot({ path: path.join(ASSETS, 'mobile.png') });
  console.log('   mobile.png');
  await phone.close();
}

async function gif(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
  const frames = [];
  let n = 0;
  const frame = async (hold = 1) => {
    const file = path.join(FRAMES, `f${String(n++).padStart(3, '0')}.png`);
    await page.screenshot({ path: file });
    frames.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), hold });
  };
  const type = async (selector, text, hold = 1) => {
    for (let i = 1; i <= text.length; i++) {
      await page.locator(selector).fill(text.slice(0, i));
      await sleep(60);
      if (i % 2 === 0 || i === text.length) await frame(hold);
    }
  };

  await fresh(page);
  await frame(6);                                           // the overview, generated from code

  await page.keyboard.press('Control+k'); await sleep(250); await frame(2);
  await type('.palette input', 'login');
  await page.keyboard.press('Enter'); await sleep(600); await frame(3);
  await page.locator('.send-btn').click(); await sleep(120); await frame(1);
  await page.waitForSelector('.resp-card .status-pill'); await sleep(500); await frame(6); // 200 + "token captured"

  await item(page, /list all users/i).click(); await sleep(500); await frame(2);
  await page.locator('.send-btn').click(); await page.waitForSelector('.resp-card .status-pill'); await sleep(500); await frame(5);
  await type('.resp-search input', 'alice', 1);
  await sleep(200); await frame(4);
  await page.locator('.resp-search input').fill('');
  await page.locator('.jv', { hasText: 'alice@example.com' }).click(); await sleep(300); await frame(4);

  await item(page, /subscribeOrder/).click(); await sleep(500); await frame(2);
  await page.locator('.send-btn').click(); await page.waitForSelector('.conn.connected'); await sleep(300); await frame(2);
  await page.locator('.composer textarea').fill('"42"');
  await page.locator('.composer .btn.primary').click(); await sleep(800); await top(page); await frame(6);

  await page.locator('aside .nav-item:has(.m-query)').first().click(); await sleep(400); await frame(2);
  await page.locator('.send-btn').click(); await sleep(1100); await frame(5);

  await page.locator('aside .nav-item:has(.m-flow)').first().click(); await sleep(400); await frame(2);
  await page.locator('.send-btn').click();
  await page.waitForSelector('.run-summary .pass', { timeout: 30000 }); await sleep(500); await frame(7);

  fs.writeFileSync(path.join(FRAMES, 'frames.json'), JSON.stringify(frames, null, 2));
  console.log(`   ${frames.length} GIF frames`);
  await page.close();
}

(async () => {
  const browser = await launch();
  try {
    console.log('screenshots →', path.relative(ROOT, ASSETS));
    await screenshots(browser);
    console.log('GIF frames →', path.relative(ROOT, FRAMES));
    await gif(browser);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
