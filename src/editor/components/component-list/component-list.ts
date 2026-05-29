import './component-list.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import type { VisualBlock } from '../../types';
import { getComponentListAddLabel } from './component-list-labels';
import { arrowDownIcon, arrowUpIcon, plusIcon } from '../../../icons';
import { renderVirtualContainerReader } from '../container/container';
import { getComponentListDisplayState, parseComponentListRuntimeView, resolveComponentListItems } from './component-list-view';

export const renderComponentListEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  helpers.ensureComponentListBlocks(block);
  const pdfDocument = helpers.isPdfDocument?.() === true;
  const locked = block.schema.lock && helpers.isReusableDefinitionEditor?.() !== true;
  const hasItems = (block.schema.componentListBlocks ?? []).length > 0;
  const listComponent = block.schema.componentListComponent || 'text';
  const editorResolved = resolveComponentListItems(block);
  const editorBlocks = editorResolved.kind === 'items'
    ? editorResolved.blocks
    : [...editorResolved.groups.flatMap((group) => group.blocks), ...editorResolved.missingBlocks];
  const editorBlockList = renderComponentListPlacementBlockList(sectionKey, block, editorBlocks, helpers);
  const placementMode = editorBlockList.length > 0 && editorBlockList.includes('component-placement-target');
  const addControl = locked
    || pdfDocument
    || placementMode
    ? ''
    : `<div class="ghost-section-card add-ghost component-list-add-ghost" data-action="add-component-list-item" data-section-key="${helpers.escapeAttr(
        sectionKey
      )}" data-block-id="${helpers.escapeAttr(block.id)}">
        <div class="ghost-plus-small">${plusIcon()}</div>
        <div class="ghost-label">${helpers.escapeHtml(getComponentListAddLabel(block))}</div>
      </div>`;
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
      ${editorBlockList}
    </div>
    ${addControl}
  `;
};

function renderComponentListPlacementBlockList(
  sectionKey: string,
  block: VisualBlock,
  blocks: VisualBlock[],
  helpers: Parameters<ComponentEditorRenderer>[2]
): string {
  const pdfDocument = helpers.isPdfDocument?.() === true;
  const locked = block.schema.lock && helpers.isReusableDefinitionEditor?.() !== true;
  const output: string[] = [];
  if (!locked && !pdfDocument && blocks.length > 0) {
    output.push(helpers.renderComponentPlacementTarget({
      container: 'component-list',
      sectionKey,
      parentBlockId: block.id,
      placement: 'before',
      targetBlockId: blocks[0]?.id,
    }));
  }
  for (const innerBlock of blocks) {
    output.push(helpers.renderEditorBlock(sectionKey, innerBlock, locked));
    if (!locked && !pdfDocument) {
      output.push(helpers.renderComponentPlacementTarget({
        container: 'component-list',
        sectionKey,
        parentBlockId: block.id,
        placement: 'after',
        targetBlockId: innerBlock.id,
      }));
    }
  }
  if (!locked && !pdfDocument && blocks.length === 0) {
    output.push(helpers.renderComponentPlacementTarget({
      container: 'component-list',
      sectionKey,
      parentBlockId: block.id,
      placement: 'end',
    }));
  }
  return output.join('');
}

export const renderComponentListReader: ComponentReaderRenderer = (section, block, helpers) => {
  helpers.ensureComponentListBlocks(block);
  const activeViewId = helpers.getComponentListReaderViewId(section.key, block.id);
  const runtimeView = parseComponentListRuntimeView(activeViewId);
  const activeDisplay = getComponentListDisplayState(block, activeViewId);
  const selectedSortKey = runtimeView.sortKeyOverride ? runtimeView.sortKey : activeDisplay.sortKey;
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
              ${selectedSortKey ? '' : '<option value="" selected>None</option>'}
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
          ...orderComponentListGroups(resolved.groups, (group) => group.blocks.some(helpers.isReaderViewPrioritizedBlock)).map((group) => {
            const prioritized = group.blocks.some(helpers.isReaderViewPrioritizedBlock);
            return renderVirtualContainerReader(
              section,
              {
                listBlockId: block.id,
                viewId: resolved.display.sortKey,
                groupKey: group.key,
                title: group.label,
                blocks: group.blocks,
                collapsedPreviewRem: resolved.display.groupCollapsedPreviewRem,
                expanded: prioritized,
                useListOrdering: true,
              },
              helpers
            );
          }),
          helpers.renderReaderListBlocks(section, resolved.missingBlocks),
        ].join('')
      : helpers.renderReaderListBlocks(section, resolved.blocks);
  if (!body.trim()) {
    return '';
  }
  const listClass = resolved.kind === 'groups' ? 'reader-component-list is-grouped-view' : 'reader-component-list';
  return `${controls}<div class="${helpers.escapeAttr(listClass)}">${body}</div>`;
};

function renderComponentListDefaultDisplayEditor(sectionKey: string, block: VisualBlock, helpers: Parameters<ComponentEditorRenderer>[2]): string {
  const sortKeys = getAvailableSortKeys(block);
  const groupKeys = getAvailableGroupKeys(block);
  const sortControls = sortKeys.length > 0
    ? `<label class="component-list-view-row-label">
        <span>Sort</span>
        ${renderKeySelect('component-list-default-sort-key', sectionKey, block.id, block.schema.componentListDefaultSortKey, sortKeys, helpers)}
      </label>
      ${block.schema.componentListDefaultSortKey.trim()
        ? `<label class="component-list-view-row-label">
        <span>Order</span>
        <select data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" data-field="component-list-default-sort-direction">
          <option value="asc"${block.schema.componentListDefaultSortDirection === 'asc' ? ' selected' : ''}>Ascending</option>
          <option value="desc"${block.schema.componentListDefaultSortDirection === 'desc' ? ' selected' : ''}>Descending</option>
        </select>
      </label>`
        : ''}`
    : '';
  const groupControl = groupKeys.length > 0
    ? `<label class="component-list-view-row-label">
        <span>Group</span>
        ${renderKeySelect('component-list-default-group-key', sectionKey, block.id, block.schema.componentListDefaultGroupKey, groupKeys, helpers)}
      </label>`
    : '';
  if (!sortControls && !groupControl) {
    return '';
  }
  return `<section class="component-list-view-editor" aria-label="Default list display">
    <div class="component-list-view-editor-head">
      <strong>Default Display</strong>
    </div>
    <div class="component-list-view-rows">
      ${sortControls}
      ${groupControl}
    </div>
  </section>`;
}

function orderComponentListGroups<T>(groups: T[], isPrioritized: (group: T) => boolean): T[] {
  const priorityGroups: T[] = [];
  const standardGroups: T[] = [];
  for (const group of groups) {
    if (isPrioritized(group)) {
      priorityGroups.push(group);
    } else {
      standardGroups.push(group);
    }
  }
  return [...priorityGroups, ...standardGroups];
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
    for (const [key, value] of Object.entries(child.schema.groupKeys)) {
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
