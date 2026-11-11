import type { HvyPluginContext } from '../types';
import { sanitizeInlineCss } from '../../css-sanitizer';
import { getActiveStateRuntime } from '../../state';
import { createFormPhotoControl } from '../form-photo-field/form-photo-field';
import { createFormRangeControl, type FormRangeDragTracker } from '../form-range-field/form-range-field';
import type { LiveFormState } from '../form-live-state/form-live-state';
import { normalizePhotoValue, type FormFieldDefinition } from '../form-spec/form-spec';

export interface FormScriptRunOptions {
  startedByUser?: boolean;
}

export interface FormReaderFieldContext {
  ctx: HvyPluginContext;
  live: LiveFormState;
  rangeDrag: FormRangeDragTracker;
  /** Pending debounced input-trigger timers, keyed by field label. */
  inputTimers: Map<string, number>;
  runNamedScript(scriptName: string, reason: string, options?: FormScriptRunOptions): void;
  renderReader(): void;
}

type FormControlElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export function renderFormReaderField(field: FormFieldDefinition, fieldContext: FormReaderFieldContext): HTMLElement {
  const { ctx, live, rangeDrag, runNamedScript, renderReader } = fieldContext;
  // Disabled shows the value cannot be changed; the value still belongs to the form.
  const disabled = live.disabled[field.label] === true;
  const wrap = document.createElement(field.type === 'radio' || field.type === 'photo' ? 'div' : 'label');
  wrap.className = `hvy-form-field hvy-form-field-${field.type}`;
  if (field.meta.css.trim().length > 0) {
    wrap.setAttribute('style', sanitizeInlineCss(field.meta.css));
  }
  wrap.dataset.formFieldLabel = field.label;
  if (disabled) {
    wrap.dataset.formFieldDisabled = 'true';
  }
  if (field.type !== 'hidden') {
    const label = document.createElement('span');
    label.className = 'hvy-form-field-label';
    label.textContent = field.label;
    wrap.appendChild(label);
  }

  const value = live.values[field.label] ?? field.value;
  if (field.type === 'photo') {
    const photoValue = normalizePhotoValue(value);
    wrap.appendChild(createFormPhotoControl({
      ctx,
      label: field.label,
      required: field.required,
      disabled,
      meta: field.meta,
      value: photoValue,
      imageAttachmentMaxDimensions: getActiveStateRuntime().state.imageAttachmentMaxDimensions,
      onChange: (next, startedByUser) => {
        live.values[field.label] = next;
        delete live.errors[field.label];
        runNamedScript(field.triggers.change ?? '', `change:${field.label}`, { startedByUser });
      },
      onError: (message) => {
        if (message) {
          live.errors[field.label] = message;
          renderReader();
        } else {
          delete live.errors[field.label];
        }
      },
    }));
  } else if (field.type === 'range') {
    const { control, input } = createFormRangeControl({
      name: field.label,
      bounds: field,
      value: String(value ?? ''),
    });
    input.disabled = disabled;
    wireControl(input, field, fieldContext);
    rangeDrag.watch(input);
    wrap.appendChild(control);
  } else if (field.type === 'textarea') {
    const textarea = document.createElement('textarea');
    textarea.name = field.label;
    textarea.value = String(value ?? '');
    textarea.placeholder = field.placeholder;
    textarea.required = field.required;
    textarea.disabled = disabled;
    if (field.rows > 0) {
      textarea.rows = field.rows;
    }
    appendControl(wrap, textarea, field, fieldContext);
  } else if (field.type === 'select') {
    const select = document.createElement('select');
    select.name = field.label;
    select.required = field.required;
    select.disabled = disabled;
    for (const option of live.options[field.label] ?? field.options) {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      node.selected = option.value === value;
      select.appendChild(node);
    }
    appendControl(wrap, select, field, fieldContext);
  } else if (field.type === 'radio') {
    const group = document.createElement('div');
    group.className = 'hvy-form-radio-group';
    for (const option of live.options[field.label] ?? field.options) {
      const radioLabel = document.createElement('label');
      radioLabel.className = 'hvy-form-radio-option';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = field.label;
      radio.value = option.value;
      radio.checked = option.value === value;
      radio.required = field.required;
      radio.disabled = disabled;
      wireControl(radio, field, fieldContext);
      radioLabel.appendChild(radio);
      radioLabel.appendChild(document.createTextNode(option.label));
      group.appendChild(radioLabel);
    }
    wrap.appendChild(group);
  } else {
    const input = document.createElement('input');
    input.type = field.type;
    input.name = field.label;
    input.placeholder = field.placeholder;
    input.required = field.required;
    input.disabled = disabled;
    if (field.type === 'checkbox') {
      input.checked = value === true || value === 'true';
    } else {
      input.value = String(value ?? '');
    }
    appendControl(wrap, input, field, fieldContext);
  }

  const error = live.errors[field.label];
  if (error) {
    const errorNode = document.createElement('span');
    errorNode.className = 'hvy-form-field-error';
    errorNode.textContent = error;
    wrap.appendChild(errorNode);
  }
  return wrap;
}

function appendControl(wrap: HTMLElement, control: FormControlElement, field: FormFieldDefinition, fieldContext: FormReaderFieldContext): void {
  wireControl(control, field, fieldContext);
  wrap.appendChild(control);
}

function wireControl(control: FormControlElement, field: FormFieldDefinition, fieldContext: FormReaderFieldContext): void {
  const { live, rangeDrag, inputTimers, runNamedScript } = fieldContext;
  control.dataset.formControl = 'true';
  control.dataset.formFieldLabel = field.label;
  control.addEventListener('input', (event) => {
    updateLiveValue(control, field, live);
    const script = field.triggers.input ?? '';
    if (script.length > 0) {
      const key = field.label;
      const existing = inputTimers.get(key);
      if (existing) {
        window.clearTimeout(existing);
      }
      const runWhenReleased = () => {
        if (rangeDrag.isDragging()) {
          inputTimers.set(key, window.setTimeout(runWhenReleased, 250));
          return;
        }
        inputTimers.delete(key);
        runNamedScript(script, `input:${field.label}`, { startedByUser: event.isTrusted });
      };
      inputTimers.set(key, window.setTimeout(runWhenReleased, 250));
    }
  });
  control.addEventListener('change', (event) => {
    updateLiveValue(control, field, live);
    // A change script that edits the document remounts the form, which would drop a pending input script.
    const pendingInput = inputTimers.get(field.label);
    if (pendingInput) {
      window.clearTimeout(pendingInput);
      inputTimers.delete(field.label);
      runNamedScript(field.triggers.input ?? '', `input:${field.label}`, { startedByUser: event.isTrusted });
    }
    runNamedScript(field.triggers.change ?? '', `change:${field.label}`, { startedByUser: event.isTrusted });
  });
  control.addEventListener('blur', (event) => {
    updateLiveValue(control, field, live);
    runNamedScript(field.triggers.blur ?? '', `blur:${field.label}`, { startedByUser: event.isTrusted });
  });
}

function updateLiveValue(control: FormControlElement, field: FormFieldDefinition, live: LiveFormState): void {
  if (control instanceof HTMLInputElement && control.type === 'checkbox') {
    live.values[field.label] = control.checked;
    return;
  }
  live.values[field.label] = control.value;
}
