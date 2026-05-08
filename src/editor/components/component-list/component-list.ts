import './component-list.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import type { VisualBlock } from '../../types';
import { getComponentListAddLabel } from './component-list-labels';
import { arrowDownIcon, arrowUpIcon, plusIcon } from '../../../icons';
import { renderVirtualContainerReader } from '../container/container';
import { getComponentListDisplayState, parseComponentListRuntimeView, resolveComponentListItems } from './component-list-view';

export const renderComponentListEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  helpers.ensureComponentListBlocks(block);
  const hasItems = (block.schema.componentListBlocks ?? []).length > 0;
  const listComponent = block.schema.componentListComponent || 'text';
  const editorResolved = resolveComponentListItems(block);
  const editorBlocks = editorResolved.kind === 'items'
    ? editorResolved.blocks
    : [...editorResolved.groups.flatMap((group) => group.blocks), ...editorResolved.missingBlocks];
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
    ${renderComponentListDefaultDisplayEditor(sectionKey, block, helpers)}
    <div class="container-inner-blocks">
      ${editorBlocks.map((innerBlock) => helpers.renderEditorBlock(sectionKey, innerBlock, block.schema.lock)).join('')}
    </div>
    ${addControl}
  `;
};

export const renderComponentListReader: ComponentReaderRenderer = (section, block, helpers) => {
  helpers.ensureComponentListBlocks(block);
  const activeViewId = helpers.getComponentListReaderViewId(section.key, block.id);
  const runtimeView = parseComponentListRuntimeView(activeViewId);
  const activeDisplay = getComponentListDisplayState(block, activeViewId);
  const selectedSortKey = runtimeView.sortKey || activeDisplay.sortKey;
  const selectedGroupKey = typeof runtimeView.groupKey === 'string' ? runtimeView.groupKey : activeDisplay.groupKey;
  const sortKeys = getAvailableSortKeys(block);
  const groupKeys = getAvailableGroupKeys(block);
  const hasSortOptions = sortKeys.length > 0;
  const hasGroupOptions = groupKeys.length > 0;
  const directionIcon = activeDisplay.direction === 'asc' ? arrowUpIcon() : arrowDownIcon();
  const reverseLabel = activeDisplay.direction === 'asc' ? 'Sort ascending' : 'Sort descending';
  const sortControl = hasSortOptions
    ? `<label class="component-list-view-picker">
            <span>Sort</span>
            <select data-field="component-list-reader-view" data-section-key="${helpers.escapeAttr(section.key)}" data-block-id="${helpers.escapeAttr(block.id)}">
              <option value=""${selectedSortKey ? '' : ' selected'}>None</option>
              ${sortKeys.map((key) => `<option value="${helpers.escapeAttr(key)}"${key === selectedSortKey ? ' selected' : ''}>${helpers.escapeHtml(key)}</option>`).join('')}
            </select>
          </label>`
    : '';
  const groupControl = hasGroupOptions
    ? `<label class="component-list-group-picker">
            <span>Group</span>
            <select data-field="component-list-reader-group" data-section-key="${helpers.escapeAttr(section.key)}" data-block-id="${helpers.escapeAttr(block.id)}" data-view-id="${helpers.escapeAttr(selectedSortKey)}">
              <option value=""${selectedGroupKey ? '' : ' selected'}>None</option>
              ${groupKeys.map((key) => `<option value="${helpers.escapeAttr(key)}"${key === selectedGroupKey ? ' selected' : ''}>${helpers.escapeHtml(key)}</option>`).join('')}
            </select>
          </label>`
    : '';
  const reverseControl = hasSortOptions
    ? `<button
            type="button"
            class="component-list-reverse-button${runtimeView.reversed ? ' is-active' : ''}"
            data-reader-action="toggle-component-list-reverse"
            data-section-key="${helpers.escapeAttr(section.key)}"
            data-block-id="${helpers.escapeAttr(block.id)}"
            data-view-id="${helpers.escapeAttr(selectedSortKey)}"
            aria-pressed="${runtimeView.reversed ? 'true' : 'false'}"
            aria-label="${helpers.escapeAttr(reverseLabel)}"
            title="Reverse order"
          >${directionIcon}</button>`
    : '';
  const controls =
    hasSortOptions || hasGroupOptions
      ? `<div class="component-list-reader-controls${hasSortOptions ? ' has-sort-options' : ''}${hasGroupOptions ? ' has-group-options' : ''}" data-component-list-reader-controls="true">
          ${sortControl}
          ${groupControl}
          ${reverseControl}
        </div>`
      : '';
  const resolved = resolveComponentListItems(block, activeViewId);
  const body =
    resolved.kind === 'groups'
      ? [
          ...resolved.groups.map((group) =>
            renderVirtualContainerReader(
              section,
              {
                listBlockId: block.id,
                viewId: resolved.display.sortKey,
                groupKey: group.key,
                title: group.label,
                blocks: group.blocks,
                collapsedPreviewRem: resolved.display.groupCollapsedPreviewRem,
              },
              helpers
            )
          ),
          ...resolved.missingBlocks.map((innerBlock) => helpers.renderReaderBlock(section, innerBlock)),
        ].join('')
      : resolved.blocks.map((innerBlock) => helpers.renderReaderBlock(section, innerBlock)).join('');
  const listClass = resolved.kind === 'groups' ? 'reader-component-list is-grouped-view' : 'reader-component-list';
  return `${controls}<div class="${helpers.escapeAttr(listClass)}">${body}</div>`;
};

function renderComponentListDefaultDisplayEditor(sectionKey: string, block: VisualBlock, helpers: Parameters<ComponentEditorRenderer>[2]): string {
  const sortKeys = getAvailableSortKeys(block);
  const groupKeys = getAvailableGroupKeys(block);
  return `<section class="component-list-view-editor" aria-label="Default list display">
    <div class="component-list-view-editor-head">
      <strong>Default Display</strong>
    </div>
    <div class="component-list-view-rows">
      <label class="component-list-view-row-label">
        <span>Sort</span>
        ${renderKeySelect('component-list-default-sort-key', sectionKey, block.id, block.schema.componentListDefaultSortKey, sortKeys, helpers)}
      </label>
      <label class="component-list-view-row-label">
        <span>Order</span>
        <select data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" data-field="component-list-default-sort-direction">
          <option value="asc"${block.schema.componentListDefaultSortDirection === 'asc' ? ' selected' : ''}>A-Z / Low to high</option>
          <option value="desc"${block.schema.componentListDefaultSortDirection === 'desc' ? ' selected' : ''}>Z-A / High to low</option>
        </select>
      </label>
      <label class="component-list-view-row-label">
        <span>Group</span>
        ${renderKeySelect('component-list-default-group-key', sectionKey, block.id, block.schema.componentListDefaultGroupKey, groupKeys, helpers)}
      </label>
    </div>
  </section>`;
}

function renderKeySelect(
  field: string,
  sectionKey: string,
  blockId: string,
  selected: string,
  sortKeys: string[],
  helpers: Parameters<ComponentEditorRenderer>[2]
): string {
  const options = [
    `<option value=""${selected ? '' : ' selected'}>None</option>`,
    ...sortKeys.map((key) => `<option value="${helpers.escapeAttr(key)}"${key === selected ? ' selected' : ''}>${helpers.escapeHtml(key)}</option>`),
  ].join('');
  return `<select data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(blockId)}" data-field="${helpers.escapeAttr(field)}">${options}</select>`;
}

function getAvailableSortKeys(block: VisualBlock): string[] {
  const keys = new Set<string>();
  for (const child of block.schema.componentListBlocks ?? []) {
    for (const key of Object.keys(child.schema.sortKeys)) {
      keys.add(key);
    }
  }
  return [...keys].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

function getAvailableGroupKeys(block: VisualBlock): string[] {
  const keys = new Set<string>();
  const valuesByKey = new Map<string, Set<string>>();
  const countsByKey = new Map<string, number>();
  for (const child of block.schema.componentListBlocks ?? []) {
    for (const [key, value] of Object.entries(child.schema.sortKeys)) {
      if (typeof value === 'undefined' || String(value).trim().length === 0) {
        continue;
      }
      valuesByKey.set(key, valuesByKey.get(key) ?? new Set<string>());
      valuesByKey.get(key)?.add(String(value));
      countsByKey.set(key, (countsByKey.get(key) ?? 0) + 1);
    }
  }
  for (const [key, values] of valuesByKey) {
    const count = countsByKey.get(key) ?? 0;
    if (count > values.size) {
      keys.add(key);
    }
  }
  return [...keys].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}
