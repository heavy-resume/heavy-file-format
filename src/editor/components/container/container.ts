import './container.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import type { VisualBlock, VisualSection } from '../../types';
import { hasContainerBorderCss } from './container-css';

export const renderContainerEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  helpers.ensureContainerBlocks(block);
  const locked = block.schema.lock && helpers.isReusableDefinitionEditor?.() !== true;
  const addKey = `container:${sectionKey}:${block.id}`;
  const bordered = hasContainerBorderCss(block.schema.css);
  const innerBlocks = renderContainerPlacementBlockList(sectionKey, block, helpers);
  const placementMode = innerBlocks.length > 0 && innerBlocks.includes('component-placement-target');
  return `
    <div class="container-config-row">
      <span class="container-title-editor-label">Container Title</span>
      <input
        class="container-title-editor-input"
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-field="block-container-title"
        placeholder="Title"
        value="${helpers.escapeAttr(block.schema.containerTitle)}"
      />
      <div class="container-config-actions">
        <div class="container-toggle-group">
          <label class="checkbox-label container-border-toggle">
            <input
              type="checkbox"
              data-section-key="${helpers.escapeAttr(sectionKey)}"
              data-block-id="${helpers.escapeAttr(block.id)}"
              data-field="block-container-border"
              ${bordered ? 'checked' : ''}
            />
            <span>Border</span>
          </label>
          <label class="checkbox-label container-expanded-toggle">
            <input
              type="checkbox"
              data-section-key="${helpers.escapeAttr(sectionKey)}"
              data-block-id="${helpers.escapeAttr(block.id)}"
              data-field="block-container-expanded"
              ${bordered && block.schema.containerExpanded ? 'checked' : ''}
              ${bordered ? '' : 'disabled'}
            />
            <span>Expanded by default</span>
          </label>
        </div>
      </div>
    </div>
    <div class="container-inner-blocks">
      ${innerBlocks}
    </div>
    ${
      locked || placementMode
        ? ''
        : `<div class="ghost-section-card add-ghost container-add-ghost">
            ${helpers.renderAddComponentPicker({
              id: addKey,
              action: 'add-container-block',
              sectionKey,
              blockId: block.id,
              label: 'Container component type',
            })}
          </div>`
    }
  `;
};

function renderContainerPlacementBlockList(
  sectionKey: string,
  block: VisualBlock,
  helpers: Parameters<ComponentEditorRenderer>[2]
): string {
  const blocks = block.schema.containerBlocks;
  const locked = block.schema.lock && helpers.isReusableDefinitionEditor?.() !== true;
  const output: string[] = [];
  if (!locked && blocks.length > 0) {
    output.push(helpers.renderComponentPlacementTarget({
      container: 'container',
      sectionKey,
      parentBlockId: block.id,
      placement: 'before',
      targetBlockId: blocks[0]?.id,
    }));
  }
  for (const innerBlock of blocks) {
    output.push(helpers.renderEditorBlock(sectionKey, innerBlock, locked));
    if (!locked) {
      output.push(helpers.renderComponentPlacementTarget({
        container: 'container',
        sectionKey,
        parentBlockId: block.id,
        placement: 'after',
        targetBlockId: innerBlock.id,
      }));
    }
  }
  if (!locked && blocks.length === 0) {
    output.push(helpers.renderComponentPlacementTarget({
      container: 'container',
      sectionKey,
      parentBlockId: block.id,
      placement: 'end',
    }));
  }
  return output.join('');
}

export const renderContainerReader: ComponentReaderRenderer = (section, block, helpers) => {
  helpers.ensureContainerBlocks(block);
  return renderContainerReaderBody({
    section,
    blockId: block.id,
    title: block.schema.containerTitle,
    blocks: block.schema.containerBlocks,
    expanded: helpers.getReaderContainerExpanded(`${section.key}:${block.id}`, block.schema.containerExpanded),
    collapsedPreviewRem: block.schema.containerCollapsedPreviewRem,
    bordered: hasContainerBorderCss(block.schema.css),
    virtualKey: '',
    useListOrdering: false,
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
    expanded?: boolean;
    useListOrdering?: boolean;
  },
  helpers: Parameters<ComponentReaderRenderer>[2]
): string {
  const virtualKey = `${section.key}:${options.listBlockId}:group:${options.viewId}:${options.groupKey}`;
  return renderContainerReaderBody({
    section,
    blockId: options.listBlockId,
    title: options.title,
    blocks: options.blocks,
    expanded: helpers.getReaderContainerExpanded(virtualKey, options.expanded ?? false),
    collapsedPreviewRem: options.collapsedPreviewRem,
    bordered: true,
    virtualKey,
    useListOrdering: options.useListOrdering ?? false,
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
  bordered: boolean;
  virtualKey: string;
  useListOrdering: boolean;
  helpers: Parameters<ComponentReaderRenderer>[2];
}): string {
  const body = options.useListOrdering
    ? options.helpers.renderReaderListBlocks(options.section, options.blocks)
    : options.helpers.renderReaderBlocks(options.section, options.blocks);
  if (options.virtualKey && !body.trim()) {
    return '';
  }
  if (!body && !options.title.trim()) {
    return '';
  }
  const canCollapse = options.bordered || Boolean(options.virtualKey);
  const expanded = canCollapse ? options.expanded : true;
  const previewRem = Number.isFinite(options.collapsedPreviewRem) && options.collapsedPreviewRem > 0 ? options.collapsedPreviewRem : 5;
  const singletonExpandableBlock = options.virtualKey && options.blocks.length === 1 && options.blocks[0]?.schema.component === 'expandable'
    ? options.blocks[0]
    : null;
  const singletonExpandableAttrs = singletonExpandableBlock
    ? ` data-singleton-expandable-section-key="${options.helpers.escapeAttr(options.section.key)}" data-singleton-expandable-block-id="${options.helpers.escapeAttr(singletonExpandableBlock.id)}"`
    : '';
  const collapsibleAttrs = `data-reader-action="toggle-container" data-section-key="${options.helpers.escapeAttr(options.section.key)}" data-block-id="${options.helpers.escapeAttr(
    options.blockId
  )}" data-container-key="${options.helpers.escapeAttr(options.virtualKey || `${options.section.key}:${options.blockId}`)}" aria-expanded="${expanded ? 'true' : 'false'}"${singletonExpandableAttrs}`;
  const titleLabel = options.title.trim() || (options.virtualKey ? 'Group' : '');
  const className = [
    'reader-container',
    titleLabel ? 'has-title' : '',
    canCollapse ? 'is-collapsible' : '',
    canCollapse && !expanded ? 'is-collapsed-preview' : 'is-expanded',
    options.bordered ? 'is-bordered' : '',
    options.virtualKey ? 'is-virtual-group-container' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const title = titleLabel ? `<div class="reader-container-title">${options.helpers.escapeHtml(titleLabel)}</div>` : '';
  const toggle = canCollapse
    ? `<button type="button" class="tiny toggle-expand-button reader-container-toggle" ${collapsibleAttrs} aria-label="${
        expanded ? 'Collapse container' : 'Expand container'
      }">${expanded ? '-' : '+'}</button>`
    : '';
  const header = title ? `<header class="reader-container-head">${title}<div class="reader-container-actions">${toggle}</div></header>` : '';
  const bodyAttrs = canCollapse && !expanded ? ` ${collapsibleAttrs}` : '';
  const rootAttrs = canCollapse && options.virtualKey && !expanded ? ` ${collapsibleAttrs}` : '';
  return `<div class="${options.helpers.escapeAttr(className)}" style="--hvy-container-preview-rem: ${previewRem}rem;"${rootAttrs}>
    ${header}
    <div class="reader-container-body"${bodyAttrs}>${body}</div>
  </div>`;
}
