export default async function browserSmoke({ chromium, baseUrl }) {
 const browser = await chromium.launch({headless:true});
 try {
  const page=await browser.newPage(); page.setDefaultTimeout(1000);
  await page.goto(baseUrl);
  for (const value of ['https://example.invalid/publication', 'Pub URL', '<Pub URL>']) {
   await page.getByRole('button',{name:'Raw',exact:true}).click();
   await page.locator('#rawEditor').fill(`---\nhvy_version: 0.1\ncomponent_defs:\n  - name: fake-link\n    baseType: text\n    template:\n      text: "[Read ↗]({% url %})"\n      schema:\n        component: text\n        placeholder: Publication URL\n---\n\n#! Fake body\n`);
   await page.getByRole('button',{name:'Apply',exact:true}).click();
   await page.evaluate(async()=>{
    const {state}=await import('/src/state.ts');
    const {openReusableTemplateModalIfNeeded}=await import('/src/bind/actions/reusable-template.ts');
    openReusableTemplateModalIfNeeded('fake-link',{kind:'section',sectionKey:state.document.sections[0].key});
   });
   await page.locator('[data-template-variable="url"]').fill(value);
   await page.locator('[data-modal-action="insert-reusable-template"]').click();
   const snapshot=()=>page.evaluate(async()=>{
    const {state}=await import('/src/state.ts');
    return {body:state.document.sections[0].blocks.map(b=>b.text), definition:state.document.meta.component_defs};
   });
   console.log('AFTER ADD',value,JSON.stringify(await snapshot()));
   await page.getByRole('button',{name:'Raw',exact:true}).click();
   console.log('AFTER EXIT',value,JSON.stringify(await snapshot()));
   await page.getByRole('button',{name:'Apply',exact:true}).click();
  }
 } finally {await browser.close();}
}
