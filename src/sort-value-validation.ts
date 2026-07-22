import { coerceSortValue } from './sort-values';
import type { SortValueDefinition } from './types';

const VALIDATION_CLASS = 'hvy-sort-value-invalid';
const MESSAGE_CLASS = 'hvy-sort-value-validation-popover';

export function clearSortValueValidation(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(`.${VALIDATION_CLASS}`).forEach((node) => {
    node.classList.remove(VALIDATION_CLASS);
    node.removeAttribute('aria-invalid');
    node.removeAttribute('aria-describedby');
  });
  root.querySelectorAll<HTMLElement>(`.${MESSAGE_CLASS}`).forEach((message) => message.remove());
}

export function showInvalidSortValues(
  editorBlock: HTMLElement,
  definitions: Record<string, SortValueDefinition>
): boolean {
  clearSortValueValidation(editorBlock);
  const invalid = [...editorBlock.querySelectorAll<HTMLElement>('[data-hvy-sort-value="true"]')]
    .map((node) => ({ node, key: node.dataset.sortValueKey?.trim() ?? '' }))
    .filter(({ node, key }) => {
      const text = node instanceof HTMLSelectElement ? node.value : node.textContent ?? '';
      return Boolean(definitions[key]) && coerceSortValue(text, definitions[key]!) === null;
    });
  if (invalid.length === 0) {
    return false;
  }
  invalid.forEach(({ node }, index) => {
    node.classList.add(VALIDATION_CLASS);
    node.setAttribute('aria-invalid', 'true');
    if (index === 0) {
      const key = invalid[0]!.key;
      const messageId = `hvy-sort-value-validation-${Date.now()}`;
      const message = node.ownerDocument.createElement('div');
      message.id = messageId;
      message.className = MESSAGE_CLASS;
      message.setAttribute('role', 'alert');
      message.textContent = formatValidationMessage(key, definitions[key]!);
      node.setAttribute('aria-describedby', messageId);
      (node.closest('.text-editor-shell, .table-editor') ?? editorBlock.querySelector('.editor-block-content') ?? editorBlock).append(message);
    }
  });
  const first = invalid[0]!.node;
  if (!(first instanceof HTMLSelectElement)) {
    first.tabIndex = -1;
  }
  first.focus({ preventScroll: true });
  first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}

function formatValidationMessage(key: string, definition: SortValueDefinition): string {
  if (definition.type === 'date') {
    return `${key} must be a valid date in ${definition.format} format.`;
  }
  if (definition.type === 'datetime') {
    return `${key} must be a date and time with an explicit timezone.`;
  }
  if (definition.type === 'number') {
    return `${key} must be a valid number.`;
  }
  if (definition.type === 'enum') {
    return `${key} must be one of the configured choices.`;
  }
  return `${key} is not a valid sort value.`;
}
