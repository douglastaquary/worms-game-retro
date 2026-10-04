import { chromium } from '@playwright/test';

// Usage: node scripts/capture-landscape.mjs [url] [screenshot-prefix]
// Captures level 1 (start + after a bazooka hit) and level 2 at 844x390 DPR 2,
// and prints FPS plus renderer diagnostics.
const url = process.argv[2] ?? 'http://127.0.0.1:5188/';
const prefix = process.argv[3] ?? 'docs/screenshots/v3';

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

const diagnostics = () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
const fps = async (ms = 3000) => {
  const a = await diagnostics();
  await page.waitForTimeout(ms);
  const b = await diagnostics();
  return ((b.frame - a.frame) / (ms / 1000)).toFixed(1);
};
const phase = (test) =>
  page.waitForFunction((source) => new Function('d', `return ${source}`)(window.__THREE_GAME_DIAGNOSTICS__), test.toString().replace(/^\(?d\)?\s*=>\s*/, ''), {
    timeout: 60000,
  });

await page.goto(url);
await page.locator('#play-button').waitFor({ state: 'visible' });
await page.waitForFunction(() => !document.querySelector('#play-button').disabled);
await page.click('#play-button');
await page.waitForTimeout(2200);
await page.screenshot({ path: `${prefix}-level1.png` });
console.log('fps:level1', await fps());
console.log('diagnostics:level1', JSON.stringify((await diagnostics()).renderer), JSON.stringify((await diagnostics()).canvas));

await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' })));
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' })));
await phase((d) => d.phase === 'fly');
await page.evaluate(
  () =>
    new Promise((resolve) => {
      const poll = () => {
        if (window.__THREE_GAME_DIAGNOSTICS__.phase !== 'fly') {
          setTimeout(() => {
            window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true);
            resolve();
          }, 60);
        } else requestAnimationFrame(poll);
      };
      poll();
    }),
);
await page.screenshot({ path: `${prefix}-explosion.png` });
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(false));
await page.waitForTimeout(1600);
await page.screenshot({ path: `${prefix}-crater.png` });

await page.evaluate(async () => {
  await window.__THREE_GAME_TEST_HOOKS__.setState('level-2');
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${prefix}-level2.png` });
console.log('fps:level2', await fps());
console.log('diagnostics:level2', JSON.stringify((await diagnostics()).renderer));
console.log('errors', JSON.stringify(errors));
await browser.close();
