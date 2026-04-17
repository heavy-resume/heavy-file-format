export type TagField = 'block-tags' | 'def-tags' | 'section-tags';

export interface TagRenderOptions {
  sectionKey?: string;
  blockId?: string;
  defIndex?: number;
  placeholder?: string;
}

interface TagRendererHelpers {
  escapeAttr: (value: string) => string;
  escapeHtml: (value: string) => string;
}

interface TagStateHelpers {
  getTagState: (target: HTMLElement) => string[];
  setTagState: (target: HTMLElement, tags: string[]) => void;
  getRenderOptions: (target: HTMLElement) => Omit<TagRenderOptions, 'placeholder'>;
}

export function renderTagEditor(
  field: TagField,
  value: string,
  options: TagRenderOptions,
  helpers: TagRendererHelpers
): string {
  const tags = parseTags(value);
  const contextAttrs = [
    options.sectionKey ? `data-section-key="${helpers.escapeAttr(options.sectionKey)}"` : '',
    options.blockId ? `data-block-id="${helpers.escapeAttr(options.blockId)}"` : '',
    typeof options.defIndex === 'number' ? `data-def-index="${String(options.defIndex)}"` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `
    <div class="tag-editor" data-tag-editor>
      <div class="tag-pill-list">${renderTagPills(tags, field, options, helpers)}</div>
      <input
        class="tag-editor-input"
        ${contextAttrs}
        data-field="${helpers.escapeAttr(`${field}-input`)}"
        placeholder="${helpers.escapeAttr(options.placeholder ?? 'Add a tag')}"
      />
    </div>
  `;
}

export function renderTagPills(
  tags: string[],
  field: TagField,
  options: Omit<TagRenderOptions, 'placeholder'>,
  helpers: TagRendererHelpers
): string {
  return tags
    .map((tag, index) => {
      const contextAttrs = [
        options.sectionKey ? `data-section-key="${helpers.escapeAttr(options.sectionKey)}"` : '',
        options.blockId ? `data-block-id="${helpers.escapeAttr(options.blockId)}"` : '',
        typeof options.defIndex === 'number' ? `data-def-index="${String(options.defIndex)}"` : '',
      ]
        .filter(Boolean)
        .join(' ');

      return `<span class="tag-pill">
        <span>${helpers.escapeHtml(tag)}</span>
        <button type="button" class="tag-pill-remove" data-action="remove-tag" data-tag-field="${helpers.escapeAttr(
          field
        )}" data-tag-index="${String(index)}" ${contextAttrs} aria-label="Remove ${helpers.escapeAttr(tag)}">×</button>
      </span>`;
    })
    .join('');
}

export function parseTags(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => {
      if (!tag || seen.has(tag.toLowerCase())) {
        return false;
      }
      seen.add(tag.toLowerCase());
      return true;
    });
}

export function serializeTags(tags: string[]): string {
  return parseTags(tags.join(', ')).join(', ');
}

export function handleTagEditorInput(target: HTMLElement, helpers: TagStateHelpers): boolean {
  if (!(target instanceof HTMLInputElement)) {
    return false;
  }
  if (!isTagInputField(target.dataset.field)) {
    return false;
  }
  if (!target.value.includes(',')) {
    return false;
  }

  const parts = target.value.split(',');
  const draft = parts.pop() ?? '';
  const pendingTags = parts.map((part) => part.trim()).filter(Boolean);
  if (pendingTags.length === 0) {
    target.value = draft;
    return true;
  }

  appendTagsFromInput(target, pendingTags, draft, helpers);
  return true;
}

export function handleTagEditorKeydown(
  event: KeyboardEvent,
  target: HTMLInputElement,
  helpers: TagStateHelpers
): boolean {
  if (!isTagInputField(target.dataset.field)) {
    return false;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    commitTagEditorDraft(target, helpers);
    return true;
  }

  if (event.key === 'Backspace' && target.value.trim().length === 0) {
    const currentTags = helpers.getTagState(target);
    if (currentTags.length === 0) {
      return false;
    }
    currentTags.pop();
    helpers.setTagState(target, currentTags);
    syncTagEditorUi(target, currentTags, '', helpers);
    event.preventDefault();
    return true;
  }

  return false;
}

export function commitTagEditorDraft(target: HTMLInputElement, helpers: TagStateHelpers): void {
  if (!isTagInputField(target.dataset.field)) {
    return;
  }
  const draft = target.value.trim();
  if (!draft) {
    return;
  }
  appendTagsFromInput(target, [draft], '', helpers);
}

export function handleRemoveTag(actionButton: HTMLElement, helpers: TagStateHelpers): void {
  const field = actionButton.dataset.tagField;
  const tagIndex = Number.parseInt(actionButton.dataset.tagIndex ?? '', 10);
  if ((field !== 'block-tags' && field !== 'def-tags' && field !== 'section-tags') || Number.isNaN(tagIndex)) {
    return;
  }

  const currentTags = helpers.getTagState(actionButton);
  if (!currentTags[tagIndex]) {
    return;
  }
  currentTags.splice(tagIndex, 1);
  helpers.setTagState(actionButton, currentTags);

  const editor = actionButton.closest<HTMLElement>('[data-tag-editor]');
  const input = editor?.querySelector<HTMLInputElement>('.tag-editor-input');
  if (input) {
    syncTagEditorUi(input, currentTags, input.value, helpers);
  }
}

function appendTagsFromInput(
  target: HTMLInputElement,
  nextTags: string[],
  nextDraft: string,
  helpers: TagStateHelpers
): void {
  const currentTags = helpers.getTagState(target);
  const merged = serializeTags([...currentTags, ...nextTags]);
  const parsed = parseTags(merged);
  helpers.setTagState(target, parsed);
  syncTagEditorUi(target, parsed, nextDraft, helpers);
}

function syncTagEditorUi(
  target: HTMLInputElement,
  tags: string[],
  draft: string,
  helpers: TagStateHelpers
): void {
  target.value = draft;
  const editor = target.closest<HTMLElement>('[data-tag-editor]');
  const pillList = editor?.querySelector<HTMLElement>('.tag-pill-list');
  if (!pillList) {
    return;
  }

  const field = target.dataset.field === 'block-tags-input' ? 'block-tags' : target.dataset.field === 'section-tags-input' ? 'section-tags' : 'def-tags';
  pillList.innerHTML = renderTagPills(tags, field, helpers.getRenderOptions(target), {
    escapeAttr: escapeAttrFallback,
    escapeHtml: escapeHtmlFallback,
  });
}

function isTagInputField(field: string | undefined): field is 'block-tags-input' | 'def-tags-input' | 'section-tags-input' {
  return field === 'block-tags-input' || field === 'def-tags-input' || field === 'section-tags-input';
}

function escapeAttrFallback(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeHtmlFallback(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
