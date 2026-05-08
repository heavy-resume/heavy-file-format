import './container.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import type { VisualBlock, VisualSection } from '../../types';

export const renderContainerEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  helpers.ensureContainerBlocks(block);
  const addKey = `container:${sectionKey}:${block.id}`;
  return `
    <div class="container-inner-blocks">
      ${block.schema.containerBlocks.map((innerBlock) => helpers.renderEditorBlock(sectionKey, innerBlock, block.schema.lock)).join('')}
    </div>
    ${
      block.schema.lock
        ? ''
        : `<article class="ghost-section-card add-ghost container-add-ghost">
            ${helpers.renderAddComponentPicker({
              id: addKey,
              action: 'add-container-block',
              sectionKey,
              blockId: block.id,
              label: 'Container component type',
            })}
          </article>`
    }
  `;
};

export const renderContainerReader: ComponentReaderRenderer = (section, block, helpers) => {
  helpers.ensureContainerBlocks(block);
  return renderContainerReaderBody({
    section,
    blockId: block.id,
    title: block.schema.containerTitle,
    blocks: block.schema.containerBlocks,
    expanded: helpers.getReaderContainerExpanded(`${section.key}:${block.id}`, block.schema.containerExpanded),
    collapsedPreviewRem: block.schema.containerCollapsedPreviewRem,
    virtualKey: '',
    helpers,
  });
};

export function renderVirtualContainerReader(
  section: VisualSection,
  options: {
    listBlockId: string;
    viewId: string;
    groupKey: string;
    title: string;
    blocks: VisualBlock[];
    collapsedPreviewRem: number;
  },
  helpers: Parameters<ComponentReaderRenderer>[2]
): string {
  const virtualKey = `${section.key}:${options.listBlockId}:group:${options.viewId}:${options.groupKey}`;
  return renderContainerReaderBody({
    section,
    blockId: options.listBlockId,
    title: options.title,
    blocks: options.blocks,
    expanded: helpers.getReaderContainerExpanded(virtualKey, false),
    collapsedPreviewRem: options.collapsedPreviewRem,
    virtualKey,
    helpers,
  });
};

function renderContainerReaderBody(options: {
  section: VisualSection;
  blockId: string;
  title: string;
  blocks: VisualBlock[];
  expanded: boolean;
  collapsedPreviewRem: number;
  virtualKey: string;
  helpers: Parameters<ComponentReaderRenderer>[2];
}): string {
  const body = options.blocks.map((innerBlock) => options.helpers.renderReaderBlock(options.section, innerBlock)).join('');
  if (!body && !options.title.trim()) {
    return '';
  }
  const expanded = options.expanded;
  const previewRem = Number.isFinite(options.collapsedPreviewRem) && options.collapsedPreviewRem > 0 ? options.collapsedPreviewRem : 3;
  const collapsibleAttrs = `data-reader-action="toggle-container" data-section-key="${options.helpers.escapeAttr(options.section.key)}" data-block-id="${options.helpers.escapeAttr(
    options.blockId
  )}" data-container-key="${options.helpers.escapeAttr(options.virtualKey || `${options.section.key}:${options.blockId}`)}" aria-expanded="${expanded ? 'true' : 'false'}"`;
  const className = ['reader-container', expanded ? 'is-expanded' : 'is-collapsed-preview', options.virtualKey ? 'is-virtual-group-container' : '']
    .filter(Boolean)
    .join(' ');
  const titleLabel = options.title.trim() || (options.virtualKey ? 'Group' : 'Container');
  const title = `<button type="button" class="reader-container-title" ${collapsibleAttrs}>${options.helpers.escapeHtml(titleLabel)}</button>`;
  const bodyAttrs = expanded ? '' : ` ${collapsibleAttrs}`;
  const rootAttrs = options.virtualKey && !expanded ? ` ${collapsibleAttrs}` : '';
  return `<div class="${options.helpers.escapeAttr(className)}" style="--hvy-container-preview-rem: ${previewRem}rem;"${rootAttrs}>
    ${title}
    <div class="reader-container-body"${bodyAttrs}>${body}</div>
  </div>`;
}
