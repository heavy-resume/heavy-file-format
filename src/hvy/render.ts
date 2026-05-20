import type { HvyDocument, HvySection } from './types';
import { markdownToReaderHtml, normalizeMarkdownIndentation } from '../markdown';
import { sanitizeCssBlock } from '../css-sanitizer';
import { getTextLineStylesFromMeta } from '../text-line-styles';

export function renderDocument(document: HvyDocument): string {
  const textLineStyles = getTextLineStylesFromMeta(document.meta);
  const sections = document.sections.map((section) => renderSection(section, textLineStyles)).join('');
  if (sections.trim().length === 0) {
    return '<p class="muted">No sections detected yet. Add markdown headings to create atomic sections.</p>';
  }
  return `<article class="hvy-doc">${sections}</article>`;
}

export function buildRuntimeCss(document: HvyDocument): string {
  const blocks: string[] = [];
  for (const block of document.cssBlocks) {
    const id = typeof block.meta.id === 'string' ? block.meta.id : 'anonymous';
    blocks.push(`/* hvy:css ${id} */\n${sanitizeCssBlock(block.css)}`);
  }
  return blocks.join('\n\n');
}

function renderSection(section: HvySection, textLineStyles: ReturnType<typeof getTextLineStylesFromMeta>): string {
  const html = markdownToReaderHtml(normalizeMarkdownIndentation(section.contentMarkdown), { textLineStyles, textLineStyleMode: 'viewer' });
  const children = section.children.map((child) => renderSection(child, textLineStyles)).join('');
  const tags = Array.isArray(section.meta.tags) ? section.meta.tags.join(', ') : '';

  return `
    <section class="hvy-section" data-section-id="${escapeHtml(section.id)}">
      <header class="hvy-section-header">
        <h${Math.min(Math.max(section.level, 1), 6)}>${escapeHtml(section.title || 'Untitled')}</h${Math.min(
          Math.max(section.level, 1),
          6
        )}>
        <div class="hvy-section-meta">id: <code>${escapeHtml(section.id)}</code>${
    tags ? ` | tags: ${escapeHtml(tags)}` : ''
  }</div>
      </header>
      <div class="hvy-section-content">${html}</div>
      ${children}
    </section>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
