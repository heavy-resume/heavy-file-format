import { CANVAS_TEXT_EDITOR_KEEP_OPEN_ATTRIBUTE } from './canvas-text-editor';

// Font size field with a list of common sizes. Typing applies on Enter or when
// the field loses focus, never per keystroke; the chevron opens a themed list.
// Using it does not close an open canvas text editor.

export const CANVAS_FONT_SIZE_PRESETS = [4, 6, 8, 10, 12, 14, 17, 21, 24, 32, 48, 72, 128];
export const CANVAS_MIN_FONT_SIZE = 1;
export const CANVAS_MAX_FONT_SIZE = 512;

export interface CanvasFontSizeControl {
  element: HTMLDivElement;
  // Shows a size without committing it (for example the size at the caret).
  setValue(size: number): void;
}

export function makeCanvasFontSizeControl(value: number, commit: (size: number) => void): CanvasFontSizeControl {
  let current = Math.round(value);
  const wrapper = document.createElement('div');
  wrapper.className = 'hvy-canvas-control hvy-canvas-font-size';
  wrapper.setAttribute(CANVAS_TEXT_EDITOR_KEEP_OPEN_ATTRIBUTE, '');
  const caption = document.createElement('span');
  caption.textContent = 'Font size';

  const field = document.createElement('div');
  field.className = 'hvy-canvas-font-size-field';
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(CANVAS_MIN_FONT_SIZE);
  input.max = String(CANVAS_MAX_FONT_SIZE);
  input.step = '1';
  input.value = String(Math.round(value));
  input.setAttribute('aria-label', 'Font size');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ghost hvy-canvas-font-size-toggle';
  toggle.setAttribute('aria-label', 'Common font sizes');
  toggle.setAttribute('aria-haspopup', 'listbox');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const list = document.createElement('div');
  list.className = 'hvy-canvas-font-size-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Common font sizes');
  list.hidden = true;

  const markCurrent = () => {
    for (const option of options) {
      const isCurrent = Number(option.textContent) === current;
      option.classList.toggle('is-current', isCurrent);
      option.setAttribute('aria-selected', String(isCurrent));
    }
  };
  const setValue = (size: number) => {
    current = Math.round(size);
    if (document.activeElement !== input) input.value = String(current);
    markCurrent();
  };
  const apply = (size: number) => {
    const clamped = Math.min(CANVAS_MAX_FONT_SIZE, Math.max(CANVAS_MIN_FONT_SIZE, Math.round(size)));
    if (!Number.isFinite(clamped)) return;
    input.value = String(clamped);
    current = clamped;
    markCurrent();
    commit(clamped);
  };

  const options = CANVAS_FONT_SIZE_PRESETS.map((size) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'hvy-canvas-font-size-option';
    option.setAttribute('role', 'option');
    option.textContent = String(size);
    // Keeps focus (and any text selection) where it is while picking a size.
    option.addEventListener('mousedown', (event) => event.preventDefault());
    option.addEventListener('click', () => {
      close();
      apply(size);
    });
    list.appendChild(option);
    return option;
  });

  // Clicking anywhere outside the control closes the list; attached only while open.
  const onOutsidePointer = (event: PointerEvent) => {
    if (!wrapper.contains(event.target as Node)) close();
  };
  const open = () => {
    list.hidden = false;
    document.addEventListener('pointerdown', onOutsidePointer, true);
    toggle.setAttribute('aria-expanded', 'true');
    markCurrent();
    const currentOption = options.find((option) => option.classList.contains('is-current'));
    currentOption?.scrollIntoView({ block: 'nearest' });
  };
  function close() {
    document.removeEventListener('pointerdown', onOutsidePointer, true);
    list.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('mousedown', (event) => event.preventDefault());
  toggle.addEventListener('click', () => (list.hidden ? open() : close()));
  input.addEventListener('change', () => apply(Number(input.value)));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && event.altKey) {
      event.preventDefault();
      open();
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      close();
    }
  });


  markCurrent();
  field.append(input, toggle, list);
  wrapper.append(caption, field);
  return { element: wrapper, setValue };
}
