const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/brython@3.14.0/brython.min.js' });
  const result = await page.evaluate(async () => {
    window.brython({debug: 0});
    try {
      window.__BRYTHON__.run_script(document.createElement('script'), "print(1/0)", 'foo', 'http://hvy', true);
      return "did not throw";
    } catch(e) {
      if (typeof window.__BRYTHON__.error_trace === 'function') {
        return window.__BRYTHON__.error_trace(e);
      }
      return Object.keys(window.__BRYTHON__).filter(k => k.includes('err') || k.includes('trace'));
    }
  });
  console.log(result);
  await browser.close();
})();
