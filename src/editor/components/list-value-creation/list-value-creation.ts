import './list-value-creation.css';
import { state } from '../../../state';
import { getComponentDefs } from '../../../component-defs';
import { findReusableOwner } from '../../../reusable';
import { findSortValueOwnerBlock, listValueFields, type ListValueKind } from '../../../sort-values';
import type { ComponentDefinition, SortValueDefinition } from '../../../types';

export function getListValueDefinitionOwner(sectionKey: string, blockId: string): ComponentDefinition | undefined {
  const owner = findSortValueOwnerBlock(state.document, blockId) ?? findReusableOwner(sectionKey, blockId);
  return owner ? getComponentDefs().find((definition) => definition.name === owner.schema.component) : undefined;
}

export function renderListValueCreation(sectionKey: string, blockId: string): string {
  if (!getListValueDefinitionOwner(sectionKey, blockId)) {
    return '<p class="muted">Automatic sort/group values require a reusable component item type.</p>';
  }
  return `${(['sort', 'group'] as const).map((kind) => `<button type="button" class="ghost text-use-as-menu-item" data-create-list-value="${kind}" role="menuitem">Create ${kind} key…</button>`).join('')}
    <form class="list-value-creation" hidden aria-label="Create automatic value">
      <label>Key name<input name="key" required autocomplete="off" /></label>
      <label>Value type<select name="type" aria-label="Value type">
        <option value="text">Text</option><option value="number">Number</option>
        <option value="date">Date</option><option value="datetime">Date &amp; Time</option><option value="enum">Enum</option>
      </select></label>
      <label data-list-value-format hidden>Date format<select name="format" aria-label="Date format">
        <option>YYYY-MM-DD</option><option>MM/DD/YYYY</option><option>DD/MM/YYYY</option>
      </select></label>
      <label data-list-value-options hidden>Options (one per line)<textarea name="options" rows="3"></textarea></label>
      <p class="muted">Shared by this component type. Use a manual key’s name to make it automatic.</p>
      <p class="muted" data-list-value-options hidden>Enum labels are their stored values. Edit mappings in list settings.</p>
      <p data-list-value-error role="alert" hidden></p>
      <div class="list-value-creation-actions"><button type="submit">Create and use</button><button type="button" class="ghost" data-cancel-list-value>Cancel</button></div>
    </form>`;
}

export function openListValueCreation(control: HTMLElement, kind: ListValueKind, selectedText: string): void {
  const form = control.querySelector<HTMLFormElement>('.list-value-creation');
  if (!form) return;
  form.reset();
  form.dataset.valueKind = kind;
  form.hidden = false;
  control.classList.add('is-creating-list-value');
  const type = form.elements.namedItem('type') as HTMLSelectElement;
  Array.from(type.options).forEach((option) => {
    option.disabled = kind === 'group' && option.value !== 'text' && option.value !== 'enum';
    option.hidden = option.disabled;
  });
  (form.elements.namedItem('options') as HTMLTextAreaElement).value = selectedText.trim();
  form.querySelector<HTMLElement>('[data-list-value-error]')!.hidden = true;
  updateListValueCreationType(form);
  (form.elements.namedItem('key') as HTMLInputElement).focus({ preventScroll: true });
}

export function updateListValueCreationType(form: HTMLFormElement): void {
  const type = (form.elements.namedItem('type') as HTMLSelectElement).value;
  form.querySelector<HTMLElement>('[data-list-value-format]')!.hidden = type !== 'date';
  form.querySelectorAll<HTMLElement>('[data-list-value-options]').forEach((element) => { element.hidden = type !== 'enum'; });
  placeUseAsMenu(form.closest<HTMLElement>('.text-use-as-selection')!);
}

/** Keep the menu inside all clipping ancestors, including the emulated frame. */
export function placeUseAsMenu(control: HTMLElement): void {
  if (!control.classList.contains('is-use-as-open')) return;
  const menu = control.querySelector<HTMLElement>('.text-use-as-menu');
  if (!menu) return;
  let top = 0;
  let bottom = window.innerHeight;
  let left = 0;
  let right = window.innerWidth;
  for (let ancestor = control.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    const rect = ancestor.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      left = Math.max(left, rect.left);
      right = Math.min(right, rect.right);
    }
  }
  const anchor = control.getBoundingClientRect();
  menu.style.maxHeight = `${Math.max(0, Math.min(448, bottom - top - 8))}px`;
  menu.style.maxWidth = `${Math.max(0, right - left - 8)}px`;
  menu.style.top = `${Math.max(top + 4, Math.min(anchor.bottom + 5, bottom - menu.offsetHeight - 4)) - anchor.top}px`;
  menu.style.right = `${anchor.right - Math.max(left + 4, Math.min(anchor.right - menu.offsetWidth, right - menu.offsetWidth - 4)) - menu.offsetWidth}px`;
}

export function closeListValueCreation(control: HTMLElement): void {
  control.classList.remove('is-creating-list-value');
  const form = control.querySelector<HTMLFormElement>('.list-value-creation');
  if (form) form.hidden = true;
}

export function readListValueCreation(form: HTMLFormElement, owner: ComponentDefinition): { key: string; kind: ListValueKind; definition: SortValueDefinition } | null {
  const data = new FormData(form);
  const key = String(data.get('key') ?? '').trim();
  const kind = form.dataset.valueKind === 'group' ? 'group' : 'sort';
  const type = String(data.get('type')) as SortValueDefinition['type'];
  const definition: SortValueDefinition = { type };
  let error = !key ? 'Enter a key name.' : Object.hasOwn(owner[listValueFields(kind).definitions] ?? {}, key) ? 'That key already exists. Cancel and choose it from the menu.' : '';
  if (type === 'date') definition.format = String(data.get('format')) as SortValueDefinition['format'];
  if (type === 'enum') {
    const labels = [...new Set(String(data.get('options') ?? '').split('\n').map((label) => label.trim()).filter(Boolean))];
    definition.options = labels.map((label) => ({ label, value: label }));
    if (!labels.length) error = 'Enter at least one option.';
  }
  const message = form.querySelector<HTMLElement>('[data-list-value-error]')!;
  message.textContent = error;
  message.hidden = !error;
  return error ? null : { key, kind, definition };
}
