import { markdownToReaderHtml } from './markdown';
import { isSectionHiddenByTemplateMarker } from './template-hide';
import type { VisualBlock, VisualSection } from './editor/types';
import type { VisualDocument } from './types';

export interface RichTextCopyPayload {
  plainText: string;
  html: string;
}

export function buildDocumentRichTextCopyPayload(document: VisualDocument): RichTextCopyPayload {
  const parts = document.sections.flatMap(renderSection);
  const plainText = parts.map((part) => part.plainText).filter(Boolean).join('\n\n').trim();
  const html = parts.map((part) => part.html).filter(Boolean).join('\n').trim();
  return {
    plainText,
    html: html ? `<article>${html}</article>` : '',
  };
}

function renderSection(section: VisualSection): RichTextCopyPayload[] {
  if (section.isGhost || section.editorOnly || section.location === 'sidebar' || isSectionHiddenByTemplateMarker(section)) {
    return [];
  }
  const parts: RichTextCopyPayload[] = [];
  parts.push(...section.blocks.flatMap(renderBlock));
  parts.push(...section.children.flatMap(renderSection));
  return parts;
}

function renderBlock(block: VisualBlock): RichTextCopyPayload[] {
  if (block.schema.editorOnly) {
    return [];
  }
  switch (block.schema.kind) {
    case 'text':
      return [renderMarkdown(block.text)];
    case 'code':
      return [{
        plainText: block.text.trim(),
        html: `<pre><code>${escapeHtml(block.text)}</code></pre>`,
      }];
    case 'table':
      return [renderTable(block)];
    case 'image':
      return renderImage(block);
    case 'carousel':
      return renderCarousel(block);
    case 'container':
      return renderTitledNestedBlocks(block.schema.containerTitle, block.schema.containerBlocks);
    case 'component-list':
      return block.schema.componentListBlocks.flatMap(renderBlock);
    case 'grid':
      return block.schema.gridItems.flatMap((item) => renderBlock(item.block));
    case 'expandable':
      return [
        ...block.schema.expandableStubBlocks.children.flatMap(renderBlock),
        ...block.schema.expandableContentBlocks.children.flatMap(renderBlock),
      ];
    case 'encrypted':
      return block.schema.encryptedBlock ? renderBlock(block.schema.encryptedBlock) : [];
    default:
      return block.text.trim() ? [renderMarkdown(block.text)] : [];
  }
}

function renderTitledNestedBlocks(title: string, blocks: VisualBlock[]): RichTextCopyPayload[] {
  const parts: RichTextCopyPayload[] = [];
  const trimmedTitle = title.trim();
  if (trimmedTitle) {
    parts.push({
      plainText: trimmedTitle,
      html: `<p><strong>${escapeHtml(trimmedTitle)}</strong></p>`,
    });
  }
  parts.push(...blocks.flatMap(renderBlock));
  return parts;
}

function renderMarkdown(markdown: string): RichTextCopyPayload {
  const plainText = markdownToPlainText(markdown);
  return {
    plainText,
    html: markdownToReaderHtml(markdown).trim(),
  };
}

function renderTable(block: VisualBlock): RichTextCopyPayload {
  const columns = block.schema.tableColumns.length > 0
    ? block.schema.tableColumns
    : Array.from({ length: Math.max(1, ...block.schema.tableRows.map((row) => row.cells.length)) }, (_value, index) => `Column ${index + 1}`);
  const plainRows: string[] = [];
  const head = block.schema.tableShowHeader ? `<thead><tr>${columns.map((column) => `<th>${renderInlineMarkdown(column)}</th>`).join('')}</tr></thead>` : '';
  if (block.schema.tableShowHeader) {
    plainRows.push(columns.map(markdownToPlainText).join('\t'));
  }
  const bodyRows = block.schema.tableRows.map((row) => {
    const cells = columns.map((_column, index) => row.cells[index] ?? '');
    plainRows.push(cells.map(markdownToPlainText).join('\t'));
    return `<tr>${cells.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`;
  });
  return {
    plainText: plainRows.join('\n').trim(),
    html: `<table>${head}<tbody>${bodyRows.join('')}</tbody></table>`,
  };
}

function renderImage(block: VisualBlock): RichTextCopyPayload[] {
  const parts: RichTextCopyPayload[] = [];
  const alt = block.schema.imageAlt.trim();
  if (alt) {
    parts.push({ plainText: alt, html: `<p>${escapeHtml(alt)}</p>` });
  }
  if (block.schema.caption?.text.trim()) {
    parts.push(renderMarkdown(block.schema.caption.text));
  }
  return parts;
}

function renderCarousel(block: VisualBlock): RichTextCopyPayload[] {
  return block.schema.carouselImages
    .flatMap((image) => [image.imageAlt, image.caption])
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ plainText: text, html: `<p>${escapeHtml(text)}</p>` }));
}

function renderInlineMarkdown(markdown: string): string {
  return markdownToReaderHtml(markdown).trim().replace(/^<p>/, '').replace(/<\/p>$/, '');
}

function markdownToPlainText(markdown: string): string {
  if (!markdown.trim()) {
    return '';
  }
  const html = markdownToReaderHtml(markdown);
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  return (template.content.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
