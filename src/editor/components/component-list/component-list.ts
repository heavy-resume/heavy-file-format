import './component-list.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import { getComponentListAddLabel } from './component-list-labels';
import { plusIcon } from '../../../icons';
import { renderVirtualContainerReader } from '../container/container';
import { getComponentListActiveView, resolveComponentListItems } from './component-list-view';

export const renderComponentListEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  helpers.ensureComponentListBlocks(block);
  const hasItems = (block.schema.componentListBlocks ?? []).length > 0;
  const listComponent = block.schema.componentListComponent || 'text';
  const addControl = block.schema.lock
    ? ''
    : `<article class="ghost-section-card add-ghost component-list-add-ghost" data-action="add-component-list-item" data-section-key="${helpers.escapeAttr(
        sectionKey
      )}" data-block-id="${helpers.escapeAttr(block.id)}">
        <div class="ghost-plus-big">${plusIcon()}</div>
        <div class="ghost-label">${helpers.escapeHtml(getComponentListAddLabel(block))}</div>
      </article>`;
  return `
    ${
      hasItems
        ? `<div class="component-list-type-summary">List type: <strong>${helpers.escapeHtml(listComponent)}</strong></div>`
        : `<label>
          <span>List Component Type</span>
          <select data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
            block.id
          )}" data-field="block-component-list-component">
            ${helpers.renderComponentOptions(listComponent)}
          </select>
        </label>`
    }
    <div class="container-inner-blocks">
      ${(block.schema.componentListBlocks ?? []).map((innerBlock) => helpers.renderEditorBlock(sectionKey, innerBlock, block.schema.lock)).join('')}
    </div>
    ${addControl}
  `;
};

export const renderComponentListReader: ComponentReaderRenderer = (section, block, helpers) => {
  helpers.ensureComponentListBlocks(block);
  const activeViewId = helpers.getComponentListReaderViewId(section.key, block.id);
  const activeView = getComponentListActiveView(block, activeViewId);
  const controls =
    block.schema.componentListViews.length > 1
      ? `<label class="component-list-view-picker">
          <span>View</span>
          <select data-field="component-list-reader-view" data-section-key="${helpers.escapeAttr(section.key)}" data-block-id="${helpers.escapeAttr(block.id)}">
            ${block.schema.componentListViews
              .map((view) => `<option value="${helpers.escapeAttr(view.id)}"${view.id === activeView?.id ? ' selected' : ''}>${helpers.escapeHtml(view.label)}</option>`)
              .join('')}
          </select>
        </label>`
      : '';
  const resolved = resolveComponentListItems(block, activeView?.id ?? '');
  const body =
    resolved.kind === 'groups'
      ? [
          ...resolved.groups.map((group) =>
            renderVirtualContainerReader(
              section,
              {
                listBlockId: block.id,
                viewId: resolved.view.id,
                groupKey: group.key,
                title: group.label,
                blocks: group.blocks,
                collapsedPreviewRem: resolved.view.groupCollapsedPreviewRem,
              },
              helpers
            )
          ),
          ...resolved.missingBlocks.map((innerBlock) => helpers.renderReaderBlock(section, innerBlock)),
        ].join('')
      : resolved.blocks.map((innerBlock) => helpers.renderReaderBlock(section, innerBlock)).join('');
  return `${controls}<div class="reader-component-list">${body}</div>`;
};
