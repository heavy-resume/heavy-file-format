import type { VisualBlock, VisualSection } from './editor/types';
import type { VisualDocument } from './types';
import { renderAltAnnotationsAsFullText } from './markdown';
import { isBlockHiddenByTemplateMarker, isSectionHiddenByTemplateMarker } from './template-hide';
import { hasTextFillInMarker, removeTextFillInMarkers } from './text-fill-in';

export function exportDocumentSourceMarkdown(document: VisualDocument): string {
  return document.sections
    .flatMap((section) => renderSectionMarkdown(section))
    .join('\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderSectionMarkdown(section: VisualSection): string[] {
  if (section.isGhost || section.editorOnly || isSectionHiddenByTemplateMarker(section)) {
    return [];
  }
  const heading = `${'#'.repeat(Math.max(1, Math.min(section.level || 1, 6)))} ${section.title.trim() || 'Untitled Section'}`;
  const blockParts = section.blocks.flatMap((block) => renderBlockMarkdown(block));
  const childParts = section.children.flatMap((child) => renderSectionMarkdown(child));
  return [heading, ...blockParts, ...childParts].filter((part) => part.trim().length > 0);
}

function renderBlockMarkdown(block: VisualBlock): string[] {
  if (block.schema.editorOnly || isBlockHiddenByTemplateMarker(block)) {
    return [];
  }
  const component = block.schema.kind;
  if (component === 'text') {
    return textBlockPart(block);
  }
  if (component === 'code') {
    return [];
  }
  if (component === 'xref-card') {
    return textPart([block.schema.xrefTitle, block.schema.xrefDetail].filter((value) => value.trim().length > 0).join(' - '));
  }
  if (component === 'table') {
    return tablePart(block);
  }
  if (component === 'image') {
    return imagePart(block.schema.imageAlt);
  }
  if (component === 'carousel') {
    return block.schema.carouselImages.flatMap((image) => [
      ...imagePart(image.imageAlt),
      ...textPart(image.caption),
    ]);
  }
  if (component === 'container') {
    return [
      ...textPart(block.schema.containerTitle),
      ...block.schema.containerBlocks.flatMap((child) => renderBlockMarkdown(child)),
    ];
  }
  if (component === 'component-list') {
    return block.schema.componentListBlocks.flatMap((child) => renderBlockMarkdown(child));
  }
  if (component === 'grid') {
    return block.schema.gridItems.flatMap((item) => renderBlockMarkdown(item.block));
  }
  if (component === 'expandable') {
    return [
      ...block.schema.expandableStubBlocks.children.flatMap((child) => renderBlockMarkdown(child)),
      ...block.schema.expandableContentBlocks.children.flatMap((child) => renderBlockMarkdown(child)),
    ];
  }
  return textPart(block.text);
}

function textBlockPart(block: VisualBlock): string[] {
  const text = block.schema.fillIn && hasTextFillInMarker(block.text)
    ? removeTextFillInMarkers(block.text)
    : block.text;
  return textPart(text);
}

function textPart(value: string): string[] {
  const text = renderAltAnnotationsAsFullText(value).trim();
  return text.length > 0 && hasVisibleMarkdownText(text) ? [text] : [];
}

function imagePart(alt: string): string[] {
  const text = renderAltAnnotationsAsFullText(alt).trim();
  return text.length > 0 ? [`![${escapeMarkdownTableCell(text)}]()`] : [];
}

function tablePart(block: VisualBlock): string[] {
  const columns = block.schema.tableColumns.map(formatTableCell);
  if (columns.length === 0) {
    return [];
  }
  const header = `| ${columns.join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const rows = block.schema.tableRows.map((row) => `| ${columns.map((_column, index) => formatTableCell(row.cells[index] ?? '')).join(' | ')} |`);
  return [[header, divider, ...rows].join('\n')];
}

function formatTableCell(value: string): string {
  return escapeMarkdownTableCell(renderAltAnnotationsAsFullText(value).replace(/\s+/g, ' ').trim());
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\]/g, '\\]');
}

function hasVisibleMarkdownText(text: string): boolean {
  return text
    .split(/\r?\n/)
    .some((line) => stripMarkdownScaffold(line).trim().length > 0);
}

function stripMarkdownScaffold(line: string): string {
  return line
    .replace(/^\s*\^[a-z0-9_-]+\^\s?/i, '')
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*[-*_]{3,}\s*$/, '')
    .replace(/[\\`*_~#[\]()!>-]/g, '');
}
