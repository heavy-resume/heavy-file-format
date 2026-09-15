import { expect } from '@playwright/test';
export default async function browserSmoke({ chromium, baseUrl }) {
 const browser = await chromium.launch({headless:true});
 try {
  const page=await browser.newPage(); page.setDefaultTimeout(1000);
  page.on('pageerror', error=>console.log('PAGE ERROR',error.message));
  await page.goto(baseUrl);
  await page.locator('#fileInput').setInputFiles('examples/resume.hvy');
  await page.getByRole('button',{name:'Advanced',exact:true}).click();
  await page.getByRole('button',{name:'Document Meta',exact:true}).click();
  await page.locator('.template-def-row').filter({has:page.getByText('history-linear-record',{exact:true})}).getByRole('button',{name:'Edit Template',exact:true}).click();
  const modal=page.locator('.reusable-definition-modal');
  await modal.locator('.editor-block-passive').first().click();
  await modal.locator('[data-action="toggle-expandable-editor-panel"][data-expandable-panel="expanded"]').first().click();
  await modal.getByText('Accomplishments',{exact:true}).click();
  const editor=modal.locator('.rich-editor[data-field="block-rich"]');
  await expect.poll(()=>page.evaluate(async ()=>(await import('/src/state.ts')).state.pendingEditorActivation)).toBeNull();
  await editor.fill('Accomplishments!!!');
  console.log('HEADING BEFORE UNDO',await editor.innerText());
  await editor.press('Meta+z');
  console.log('HEADING AFTER UNDO',await editor.innerText());
 } finally {await browser.close();}
}
