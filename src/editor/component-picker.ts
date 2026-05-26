import { areTablesEnabled } from '../reference-config';
import type { ComponentDefinition } from '../types';
import type { AddComponentPickerOptions } from './component-helpers';
import { getRenderableHostPlugins } from '../plugins/registry';
import { plusIcon } from '../icons';

interface RenderDeps {
  escapeAttr: (value: string) => string;
  escapeHtml: (value: string) => string;
  getComponentDefs: () => ComponentDefinition[];
}

interface PickerItem {
  value: string;
  label: string;
  description: string;
  pluginId?: string;
  disabled?: boolean;
  disabledReason?: string;
}

interface PickerGroup {
  id: string;
  label: string;
  description: string;
  position: 'top' | 'top-left' | 'top-right' | 'bottom' | 'bottom-left' | 'bottom-right';
  direct: boolean;
  items: PickerItem[];
}

export function renderAddComponentPicker(options: AddComponentPickerOptions, deps: RenderDeps): string {
  const visibleGroups = getPickerGroups(deps.getComponentDefs()).map((group) => ({
    ...group,
    items: group.items.map((item) => withPickerItemAvailability(options, item)),
  }));
  const paneStyle = `--component-picker-groups: ${visibleGroups.length};`;
  return `
    <div class="component-picker" style="${paneStyle}" data-active-pane="root">
      <button
        type="button"
        class="component-picker-trigger"
        aria-label="${deps.escapeAttr(options.label ?? 'Add component')}"
        aria-haspopup="dialog"
      >
        ${plusIcon()}
      </button>
      <div class="component-picker-popover" role="dialog" aria-label="${deps.escapeAttr(options.label ?? 'Add component')}">
        <div class="component-picker-viewport">
          <div class="component-picker-panes">
            <div class="component-picker-pane component-picker-pane-root" data-picker-pane="root">
              ${visibleGroups.map((group) => renderGroupButton(options, group, deps)).join('')}
            </div>
            ${visibleGroups.map((group) => renderGroupPane(options, group, deps)).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderGroupButton(options: AddComponentPickerOptions, group: PickerGroup, deps: RenderDeps): string {
  if (group.direct && group.items.length === 1) {
    return renderComponentButton(options, group.items[0]!, deps, {
      className: 'component-picker-row-category component-picker-row-direct',
      position: group.position,
    });
  }
  return `
    <button type="button" class="component-picker-row component-picker-row-category" data-picker-position="${deps.escapeAttr(group.position)}" data-component-picker-pane="${deps.escapeAttr(group.id)}">
      <span class="component-picker-row-title">${deps.escapeHtml(group.label)}</span>
      <span class="component-picker-row-description">${deps.escapeHtml(group.description)}</span>
    </button>
  `;
}

function renderGroupPane(options: AddComponentPickerOptions, group: PickerGroup, deps: RenderDeps): string {
  return `
    <div class="component-picker-pane" data-picker-pane="${deps.escapeAttr(group.id)}">
      <button type="button" class="component-picker-back" data-component-picker-pane="root">Back</button>
      <div class="component-picker-pane-title">${deps.escapeHtml(group.label)}</div>
      ${group.items.map((item) => renderComponentButton(options, item, deps)).join('')}
    </div>
  `;
}

function renderComponentButton(
  options: AddComponentPickerOptions,
  item: PickerItem,
  deps: RenderDeps,
  display: { className?: string; position?: PickerGroup['position'] } = {}
): string {
  const disabledReason = item.disabled ? item.disabledReason || 'Unavailable here' : '';
  const description = disabledReason ? `${item.description} - ${disabledReason}` : item.description;
  const extraAttrs = Object.entries(options.extraAttrs ?? {})
    .map(([key, value]) => ` ${deps.escapeAttr(key)}="${deps.escapeAttr(value)}"`)
    .join('');
  const blockIdAttr = options.blockId ? ` data-block-id="${deps.escapeAttr(options.blockId)}"` : '';
  const positionAttr = display.position ? ` data-picker-position="${deps.escapeAttr(display.position)}"` : '';
  const pluginAttr = item.pluginId ? ` data-plugin-id="${deps.escapeAttr(item.pluginId)}"` : '';
  const actionAttr = item.disabled ? '' : ` data-action="${deps.escapeAttr(options.action)}"`;
  const disabledAttrs = item.disabled
    ? ` disabled aria-disabled="true" data-component-picker-disabled="true" data-disabled-reason="${deps.escapeAttr(disabledReason)}" title="${deps.escapeAttr(disabledReason)}"`
    : '';
  return `
    <button
      type="button"
      class="component-picker-row component-picker-row-leaf${display.className ? ` ${deps.escapeAttr(display.className)}` : ''}"
      ${actionAttr}
      data-section-key="${deps.escapeAttr(options.sectionKey)}"${blockIdAttr}
      data-component="${deps.escapeAttr(item.value)}"${positionAttr}${pluginAttr}${extraAttrs}${disabledAttrs}
    >
      <span class="component-picker-row-title">${deps.escapeHtml(item.label)}</span>
      <span class="component-picker-row-description">${deps.escapeHtml(description)}</span>
    </button>
  `;
}

function withPickerItemAvailability(options: AddComponentPickerOptions, item: PickerItem): PickerItem {
  if (!options.componentFilter || options.componentFilter(item.value, item.pluginId)) {
    return item;
  }
  return {
    ...item,
    disabled: true,
    disabledReason: options.componentDisabledReason?.(item.value, item.pluginId) || 'Unavailable here',
  };
}

function getPickerGroups(componentDefs: ComponentDefinition[]): PickerGroup[] {
  const pluginItems = getRenderableHostPlugins().map((entry) => ({
    value: 'plugin',
    label: entry.displayName,
    description: entry.id,
    pluginId: entry.id,
  }));
  const groups: PickerGroup[] = [
    {
      id: 'text',
      label: 'Text',
      description: 'multipurpose',
      position: 'top',
      direct: true,
      items: [{ value: 'text', label: 'Text', description: 'multipurpose' }],
    },
    {
      id: 'images',
      label: 'Images',
      description: 'single images and carousels',
      position: 'top-left',
      direct: false,
      items: [
        { value: 'image', label: 'Image', description: 'add a single image' },
        { value: 'carousel', label: 'Carousel', description: 'auto-scrolling attached images' },
      ],
    },
    {
      id: 'advanced',
      label: 'Advanced',
      description: 'tables and references',
      position: 'bottom-left',
      direct: false,
      items: [
        ...(areTablesEnabled() ? [{ value: 'table', label: 'Table', description: 'a static table of information' }] : []),
        { value: 'xref-card', label: 'Reference', description: 'reference another document item' },
      ],
    },
  ];
  groups.push(
    {
      id: 'containers',
      label: 'Containers',
      description: 'lists, grids, and empty containers',
      position: 'top-right',
      direct: false,
      items: [
        { value: 'container', label: 'Container', description: 'group components together' },
        { value: 'component-list', label: 'List', description: 'repeat a component template' },
        { value: 'grid', label: 'Grid', description: 'arrange components in columns' },
        { value: 'expandable', label: 'Expandable', description: 'show a stub with expandable details' },
      ],
    },
    {
      id: 'custom',
      label: 'Custom',
      description: 'component templates',
      position: 'bottom',
      direct: false,
      items: [
        ...componentDefs
          .map((def) => def.name.trim())
          .filter((name) => name.length > 0)
          .map((name) => ({ value: name, label: name, description: 'component templates' })),
      ],
    },
    {
      id: 'plugins',
      label: 'Plugin',
      description: 'plugin components',
      position: 'bottom-right',
      direct: false,
      items: pluginItems.length > 0 ? pluginItems : [{ value: 'plugin', label: 'Plugin', description: 'No plugins installed' }],
    }
  );
  return groups;
}
