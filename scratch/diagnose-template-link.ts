import { applyReusableTemplateValues } from '../src/reusable-template-values';
import { defaultBlockSchema } from '../src/document-factory';
import { markdownToReaderHtml, turndown } from '../src/markdown';
for (const url of ['https://example.invalid/publication', '<Pub URL>', 'Pub URL', '']) {
 const block = {id: 'diagnostic', text: '[Read ↗]({% url %})', schema: defaultBlockSchema('text'), schemaMode: false};
 applyReusableTemplateValues(block, {url}, [{name:'url',type:'text',label:'Pub URL'}]);
 const html = markdownToReaderHtml(block.text);
 console.log(JSON.stringify({url, substituted:block.text, html, roundTrip:turndown.turndown(html)}));
}
const html = markdownToReaderHtml('[Read ↗]({% url %})');
console.log(JSON.stringify({unresolvedHtml:html, roundTrip:turndown.turndown(html)}));
