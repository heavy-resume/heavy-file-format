import { readFileSync } from 'node:fs';
export default async function ({ chromium, baseUrl }) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    await page.addScriptTag({ content: readFileSync('../heavy-resume/static/brython.js', 'utf8') });
    await page.addScriptTag({ content: readFileSync('../heavy-resume/static/brython_stdlib.js', 'utf8') });
    console.log(await page.evaluate(() => {
      brython({debug: 0});
      window.fakeMount = { findUnusedEmbeddedFiles: () => [{id:'image:one'}, {id:'image:two'}] };
      const source = `from browser import window
unused = window.fakeMount.findUnusedEmbeddedFiles()
unused_count = getattr(unused, "length", None)
window.bridgeResult = {"length": str(unused_count), "len": len(unused), "type": str(type(unused))}
`;
      const unused = __BRYTHON__.jsobj2pyobj(window.fakeMount.findUnusedEmbeddedFiles());
      return { length: __BRYTHON__.builtins.getattr(unused, 'length', null), len: __BRYTHON__.builtins.len(unused) };
    }));
  } finally { await browser.close(); }
}
