const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/brython@3.14.0/brython.min.js' });
  const result = await page.evaluate(() => {
    return window.__BRYTHON__.run_script.toString();
  });
  console.log(result);
  await browser.close();
})();
