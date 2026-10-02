// Renders the social sharing card (GitHub social preview, LinkedIn, X) from
// social-card.html, which embeds the real workspace screenshot.
//
//   node docs/marketing/screenshot-banner.js
//
// Set SPECSCRIBE_CHROMIUM to use a local Chromium instead of Playwright's download.
const path = require('path');
const { chromium } = require('@playwright/test');

(async () => {
  const htmlPath = path.resolve(__dirname, 'social-card.html');
  const outPath = path.resolve(__dirname, '..', 'assets', 'social-card.png');
  const browser = await chromium.launch(process.env.SPECSCRIBE_CHROMIUM ? { executablePath: process.env.SPECSCRIBE_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
  await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await page.screenshot({ path: outPath, type: 'png' });
  await browser.close();
  console.log('saved', outPath);
})();
