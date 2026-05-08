import './component-list.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import type { ComponentListView, VisualBlock } from '../../types';
import { getComponentListAddLabel } from './component-list-labels';
import { arrowDownIcon, arrowUpIcon, plusIcon } from '../../../icons';
import { renderVirtualContainerReader } from '../container/container';
import { getComponentListActiveView, parseComponentListRuntimeView, resolveComponentListItems } from './component-list-view';

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
    ${renderComponentListViewEditor(sectionKey, block, helpers)}
    <div class="container-inner-blocks">
      ${(block.schema.componentListBlocks ?? []).map((innerBlock) => helpers.renderEditorBlock(sectionKey, innerBlock, block.schema.lock)).join('')}
    </div>
    ${addControl}
  `;
};

export const renderComponentListReader: ComponentReaderRenderer = (section, block, helpers) => {
  helpers.ensureComponentListBlocks(block);
  const activeViewId = helpers.getComponentListReaderViewId(section.key, block.id);
  const runtimeView = parseComponentListRuntimeView(activeViewId);
  const activeView = getComponentListActiveView(block, activeViewId);
  const selectedViewId = runtimeView.viewId || activeView?.id || '';
  const selectedGroupKey = typeof runtimeView.groupKey === 'string' ? runtimeView.groupKey : activeView?.groupKey ?? '';
  const groupKeys = getAvailableGroupKeys(block);
  const directionIcon = activeView?.direction === 'asc' ? arrowUpIcon() : arrowDownIcon();
  const reverseLabel = activeView?.direction === 'asc' ? 'Sort ascending' : 'Sort descending';
  const controls =
    block.schema.componentListViews.length > 0
      ? `<div class="component-list-reader-controls" data-component-list-reader-controls="true">
          <label class="component-list-view-picker">
            <span>Sort</span>
            <select data-field="component-list-reader-view" data-section-key="${helpers.escapeAttr(section.key)}" data-block-id="${helpers.escapeAttr(block.id)}">
            ${block.schema.componentListViews
              .map((view) => `<option value="${helpers.escapeAttr(view.id)}"${view.id === selectedViewId ? ' selected' : ''}>${helpers.escapeHtml(view.label)}</option>`)
              .join('')}
            </select>
          </label>
          <label class="component-list-group-picker">
            <span>Group</span>
            <select data-field="component-list-reader-group" data-section-key="${helpers.escapeAttr(section.key)}" data-block-id="${helpers.escapeAttr(block.id)}" data-view-id="${helpers.escapeAttr(selectedViewId)}">
              <option value=""${selectedGroupKey ? '' : ' selected'}>No grouping</option>
              ${groupKeys.map((key) => `<option value="${helpers.escapeAttr(key)}"${key === selectedGroupKey ? ' selected' : ''}>${helpers.escapeHtml(key)}</option>`).join('')}
            </select>
          </label>
          <button
            type="button"
            class="component-list-reverse-button${runtimeView.reversed ? ' is-active' : ''}"
            data-reader-action="toggle-component-list-reverse"
            data-section-key="${helpers.escapeAttr(section.key)}"
            data-block-id="${helpers.escapeAttr(block.id)}"
            data-view-id="${helpers.escapeAttr(selectedViewId)}"
            aria-pressed="${runtimeView.reversed ? 'true' : 'false'}"
            aria-label="${helpers.escapeAttr(reverseLabel)}"
            title="Reverse order"
          >${directionIcon}</button>
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
  const listClass = resolved.kind === 'groups' ? 'reader-component-list is-grouped-view' : 'reader-component-list';
  return `${controls}<div class="${helpers.escapeAttr(listClass)}">${body}</div>`;
};

function renderComponentListViewEditor(sectionKey: string, block: VisualBlock, helpers: Parameters<ComponentEditorRenderer>[2]): string {
  const views = block.schema.componentListViews;
  const sortKeys = getAvailableSortKeys(block);
  const viewRows = [...views, createBlankView()];
  const defaultOptions = [
    `<option value=""${block.schema.componentListDefaultView ? '' : ' selected'}>Canonical order</option>`,
    ...views.map((view) => `<option value="${helpers.escapeAttr(view.id)}"${view.id === block.schema.componentListDefaultView ? ' selected' : ''}>${helpers.escapeHtml(view.label || view.id)}</option>`),
  ].join('');
  return `<section class="component-list-view-editor" aria-label="List views">
    <div class="component-list-view-editor-head">
      <strong>List Views</strong>
      <label>
        <span>Default</span>
        <select data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" data-field="component-list-default-view-select">
          ${defaultOptions}
        </select>
      </label>
    </div>
    <div class="component-list-view-rows">
      ${viewRows.map((view, index) => renderViewRow(sectionKey, block, view, index, sortKeys, helpers)).join('')}
    </div>
  </section>`;
}

function renderViewRow(
  sectionKey: string,
  block: VisualBlock,
  view: ComponentListView,
  index: number,
  sortKeys: string[],
  helpers: Parameters<ComponentEditorRenderer>[2]
): string {
  const isBlank = index >= block.schema.componentListViews.length;
  const id = isBlank ? '' : view.id;
  return `<div class="component-list-view-row">
    <input
      data-section-key="${helpers.escapeAttr(sectionKey)}"
      data-block-id="${helpers.escapeAttr(block.id)}"
      data-field="component-list-view-id"
      data-view-index="${index}"
      placeholder="view id"
      value="${helpers.escapeAttr(id)}"
    />
    <input
      data-section-key="${helpers.escapeAttr(sectionKey)}"
      data-block-id="${helpers.escapeAttr(block.id)}"
      data-field="component-list-view-label"
      data-view-index="${index}"
      placeholder="Label"
      value="${helpers.escapeAttr(isBlank ? '' : view.label)}"
    />
    ${renderSortKeySelect('component-list-view-sort-key', sectionKey, block.id, index, view.sortKey, sortKeys, 'Sort by', helpers)}
    <select data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" data-field="component-list-view-direction" data-view-index="${index}" aria-label="Sort direction">
      <option value="desc"${view.direction === 'desc' ? ' selected' : ''}>High to low</option>
      <option value="asc"${view.direction === 'asc' ? ' selected' : ''}>Low to high</option>
    </select>
    ${renderSortKeySelect('component-list-view-group-key', sectionKey, block.id, index, view.groupKey, sortKeys, 'No group', helpers, true)}
    <input
      type="number"
      min="1"
      step="0.25"
      data-section-key="${helpers.escapeAttr(sectionKey)}"
      data-block-id="${helpers.escapeAttr(block.id)}"
      data-field="component-list-view-preview-rem"
      data-view-index="${index}"
      aria-label="Group preview height"
      value="${helpers.escapeAttr(String(view.groupCollapsedPreviewRem || 3))}"
    />
  </div>`;
}

function renderSortKeySelect(
  field: string,
  sectionKey: string,
  blockId: string,
  index: number,
  selected: string,
  sortKeys: string[],
  emptyLabel: string,
  helpers: Parameters<ComponentEditorRenderer>[2],
  includeEmpty = false
): string {
  const options = [
    ...(includeEmpty ? [`<option value=""${selected ? '' : ' selected'}>${helpers.escapeHtml(emptyLabel)}</option>`] : []),
    ...sortKeys.map((key) => `<option value="${helpers.escapeAttr(key)}"${key === selected ? ' selected' : ''}>${helpers.escapeHtml(key)}</option>`),
  ].join('');
  return `<select data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(blockId)}" data-field="${helpers.escapeAttr(field)}" data-view-index="${index}" aria-label="${helpers.escapeAttr(emptyLabel)}">${options}</select>`;
}

function getAvailableSortKeys(block: VisualBlock): string[] {
  const keys = new Set<string>();
  for (const child of block.schema.componentListBlocks ?? []) {
    for (const key of Object.keys(child.schema.sortKeys)) {
      keys.add(key);
    }
  }
  for (const view of block.schema.componentListViews) {
    if (view.sortKey) keys.add(view.sortKey);
    if (view.groupKey) keys.add(view.groupKey);
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
  for (const view of block.schema.componentListViews) {
    if (view.groupKey) keys.add(view.groupKey);
  }
  return [...keys].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

function createBlankView(): ComponentListView {
  return {
    id: '',
    label: '',
    sortKey: '',
    direction: 'desc',
    groupKey: '',
    groupDirection: 'desc',
    groupCollapsedPreviewRem: 3,
  };
}
