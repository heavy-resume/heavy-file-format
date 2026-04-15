import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { HvyDocument, HvySection } from './types';

marked.setOptions({ gfm: true, breaks: false });

export function renderDocument(document: HvyDocument): string {
  const sections = document.sections.map(renderSection).join('');
  if (sections.trim().length === 0) {
    return '<p class="muted">No sections detected yet. Add markdown headings to create atomic sections.</p>';
  }
  return `<article class="hvy-doc">${sections}</article>`;
}

export function buildRuntimeCss(document: HvyDocument): string {
  const blocks: string[] = [];
  for (const block of document.cssBlocks) {
    const id = typeof block.meta.id === 'string' ? block.meta.id : 'anonymous';
    blocks.push(`/* hvy:css ${id} */\n${block.css}`);
  }
  return blocks.join('\n\n');
}

function renderSection(section: HvySection): string {
  const html = DOMPurify.sanitize(marked.parse(escapeRawHtml(section.contentMarkdown)) as string);
  const children = section.children.map(renderSection).join('');
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

function escapeRawHtml(markdown: string): string {
  return markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
