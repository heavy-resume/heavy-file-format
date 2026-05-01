import { areTablesEnabled } from '../reference-config';
import type { ComponentDefinition } from '../types';
import type { AddComponentPickerOptions } from './component-helpers';

interface RenderDeps {
  escapeAttr: (value: string) => string;
  escapeHtml: (value: string) => string;
  getComponentDefs: () => ComponentDefinition[];
}

interface PickerItem {
  value: string;
  label: string;
  description: string;
}

interface PickerGroup {
  id: string;
  label: string;
  description: string;
  items: PickerItem[];
}

export function renderAddComponentPicker(options: AddComponentPickerOptions, deps: RenderDeps): string {
  const groups = getPickerGroups(deps.getComponentDefs());
  const paneStyle = `--component-picker-groups: ${groups.length};`;
  return `
    <div class="component-picker" style="${paneStyle}" data-active-pane="root">
      <button
        type="button"
        class="component-picker-trigger"
        aria-label="${deps.escapeAttr(options.label ?? 'Add component')}"
        aria-haspopup="dialog"
      >
        <span>+</span>
      </button>
      <div class="component-picker-popover" role="dialog" aria-label="${deps.escapeAttr(options.label ?? 'Add component')}">
        <div class="component-picker-viewport">
          <div class="component-picker-panes">
            <div class="component-picker-pane component-picker-pane-root" data-picker-pane="root">
              ${groups.map((group) => renderGroupButton(options.id, group, deps)).join('')}
            </div>
            ${groups.map((group) => renderGroupPane(options, group, deps)).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderGroupButton(_pickerId: string, group: PickerGroup, deps: RenderDeps): string {
  return `
    <button type="button" class="component-picker-row component-picker-row-category" data-component-picker-pane="${deps.escapeAttr(group.id)}">
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

function renderComponentButton(options: AddComponentPickerOptions, item: PickerItem, deps: RenderDeps): string {
  const extraAttrs = Object.entries(options.extraAttrs ?? {})
    .map(([key, value]) => ` ${deps.escapeAttr(key)}="${deps.escapeAttr(value)}"`)
    .join('');
  const blockIdAttr = options.blockId ? ` data-block-id="${deps.escapeAttr(options.blockId)}"` : '';
  return `
    <button
      type="button"
      class="component-picker-row component-picker-row-leaf"
      data-action="${deps.escapeAttr(options.action)}"
      data-section-key="${deps.escapeAttr(options.sectionKey)}"${blockIdAttr}
      data-component="${deps.escapeAttr(item.value)}"${extraAttrs}
    >
      <span class="component-picker-row-title">${deps.escapeHtml(item.label)}</span>
      <span class="component-picker-row-description">${deps.escapeHtml(item.description)}</span>
    </button>
  `;
}

function getPickerGroups(componentDefs: ComponentDefinition[]): PickerGroup[] {
  const groups: PickerGroup[] = [
    {
      id: 'text',
      label: 'Text',
      description: 'multipurpose text component',
      items: [{ value: 'text', label: 'Text', description: 'multipurpose text component' }],
    },
    {
      id: 'image',
      label: 'Image',
      description: 'add an image',
      items: [{ value: 'image', label: 'Image', description: 'add an image' }],
    },
  ];
  if (areTablesEnabled()) {
    groups.push({
      id: 'table',
      label: 'Table',
      description: 'a static table of information',
      items: [{ value: 'table', label: 'Table', description: 'a static table of information' }],
    });
  }
  groups.push(
    {
      id: 'containers',
      label: 'Containers',
      description: 'lists, grids, and containers',
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
      description: 'custom components',
      items: [
        { value: 'xref-card', label: 'Cross-reference card', description: 'link to another document section' },
        ...componentDefs
          .map((def) => def.name.trim())
          .filter((name) => name.length > 0)
          .map((name) => ({ value: name, label: name, description: 'custom component' })),
      ],
    },
    {
      id: 'plugins',
      label: 'Plugins',
      description: 'components from plugins',
      items: [{ value: 'plugin', label: 'Plugin', description: 'components from plugins' }],
    }
  );
  return groups;
}
