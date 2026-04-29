import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import type {
  HvyPluginContext,
  HvyPluginFactory,
  HvyPluginInstance,
  HvyPluginRegistration,
} from './types';
import { FORM_PLUGIN_ID } from './registry';
import { runUserScript, type ScriptingRunResult } from './scripting/wrapper';
import type { ScriptingFormApi, ScriptingFormOption } from './scripting/runtime';
import { sanitizeInlineCss } from '../css-sanitizer';

import './form.css';

export const FORM_PLUGIN_VERSION = '0.1';

const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'select',
  'checkbox',
  'radio',
  'date',
  'email',
  'tel',
  'url',
  'password',
  'hidden',
] as const;

type FormFieldType = (typeof FIELD_TYPES)[number];
type FormTriggerName = 'input' | 'change' | 'blur';

export interface FormOption {
  label: string;
  value: string;
}

export interface FormFieldDefinition {
  name: string;
  label: string;
  type: FormFieldType;
  value: string | boolean;
  placeholder: string;
  required: boolean;
  options: FormOption[];
  triggers: Partial<Record<FormTriggerName, string>>;
  meta: {
    css: string;
  };
}

export interface FormSpec {
  fields: FormFieldDefinition[];
  scripts: Record<string, string>;
  initialScript: string;
  submitScript: string;
  submitLabel: string;
  showSubmit: boolean;
}

export interface ParsedFormSpec {
  spec: FormSpec;
  error: string | null;
}

interface LiveFormState {
  values: Record<string, string | boolean>;
  options: Record<string, FormOption[]>;
  errors: Record<string, string>;
}

const DEFAULT_FIELD: FormFieldDefinition = {
  name: 'field',
  label: 'Field',
  type: 'text',
  value: '',
  placeholder: '',
  required: false,
  options: [],
  triggers: {},
  meta: {
    css: '',
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFieldType(value: unknown): FormFieldType {
  return typeof value === 'string' && FIELD_TYPES.includes(value as FormFieldType) ? (value as FormFieldType) : 'text';
}

function normalizeOption(value: unknown): FormOption | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const label = String(value);
    return { label, value: label };
  }
  if (!isObject(value)) {
    return null;
  }
  const label = typeof value.label === 'string' ? value.label : String(value.value ?? '');
  if (label.trim().length === 0) {
    return null;
  }
  return {
    label,
    value: typeof value.value === 'string' ? value.value : label,
  };
}

function normalizeTriggers(value: unknown): Partial<Record<FormTriggerName, string>> {
  if (!isObject(value)) {
    return {};
  }
  const triggers: Partial<Record<FormTriggerName, string>> = {};
  for (const key of ['input', 'change', 'blur'] as const) {
    if (typeof value[key] === 'string' && value[key].trim().length > 0) {
      triggers[key] = value[key].trim();
    }
  }
  return triggers;
}

function normalizeField(candidate: unknown, index: number): FormFieldDefinition {
  const raw = isObject(candidate) ? candidate : {};
  const name = typeof raw.name === 'string' && raw.name.trim().length > 0 ? raw.name.trim() : `field_${index + 1}`;
  const label = typeof raw.label === 'string' && raw.label.trim().length > 0 ? raw.label : name;
  const type = normalizeFieldType(raw.type);
  const rawValue = raw.value;
  const fieldValue = type === 'checkbox' ? rawValue === true || rawValue === 'true' : typeof rawValue === 'string' ? rawValue : String(rawValue ?? '');
  const options = Array.isArray(raw.options) ? raw.options.map(normalizeOption).filter((option): option is FormOption => option !== null) : [];
  const meta = isObject(raw.meta) ? raw.meta : {};
  return {
    name,
    label,
    type,
    value: fieldValue,
    placeholder: typeof raw.placeholder === 'string' ? raw.placeholder : '',
    required: raw.required === true,
    options,
    triggers: normalizeTriggers(raw.triggers),
    meta: {
      css: typeof meta.css === 'string' ? meta.css : '',
    },
  };
}

function normalizeScripts(value: unknown): Record<string, string> {
  if (!isObject(value)) {
    return {};
  }
  const scripts: Record<string, string> = {};
  for (const [key, source] of Object.entries(value)) {
    const name = key.trim();
    if (name.length > 0) {
      scripts[name] = typeof source === 'string' ? source : String(source ?? '');
    }
  }
  return scripts;
}

export function parseFormSpec(source: string): ParsedFormSpec {
  if (source.trim().length === 0) {
    return {
      spec: { fields: [], scripts: {}, initialScript: '', submitScript: '', submitLabel: 'Submit', showSubmit: true },
      error: null,
    };
  }

  try {
    const parsed = parseYaml(source);
    if (!isObject(parsed)) {
      return {
        spec: { fields: [], scripts: {}, initialScript: '', submitScript: '', submitLabel: 'Submit', showSubmit: true },
        error: 'Form YAML must be an object.',
      };
    }
    return {
      spec: {
        fields: Array.isArray(parsed.fields) ? parsed.fields.map(normalizeField) : [],
        scripts: normalizeScripts(parsed.scripts),
        initialScript: typeof parsed.initialScript === 'string' ? parsed.initialScript.trim() : '',
        submitScript: typeof parsed.submitScript === 'string' ? parsed.submitScript.trim() : '',
        submitLabel: typeof parsed.submitLabel === 'string' && parsed.submitLabel.trim().length > 0 ? parsed.submitLabel : 'Submit',
        showSubmit: parsed.showSubmit !== false,
      },
      error: null,
    };
  } catch (error) {
    return {
      spec: { fields: [], scripts: {}, initialScript: '', submitScript: '', submitLabel: 'Submit', showSubmit: true },
      error: error instanceof Error ? error.message : 'Invalid form YAML.',
    };
  }
}

export function serializeFormSpec(spec: FormSpec): string {
  const clean: Record<string, unknown> = {};
  clean.fields = spec.fields.map((field) => {
    const item: Record<string, unknown> = {
      name: field.name,
      label: field.label,
      type: field.type,
    };
    if (field.value !== '' && field.value !== false) item.value = field.value;
    if (field.placeholder.length > 0) item.placeholder = field.placeholder;
    if (field.required) item.required = true;
    if (field.options.length > 0) item.options = field.options.map((option) => ({ label: option.label, value: option.value }));
    if (Object.keys(field.triggers).length > 0) item.triggers = field.triggers;
    if (field.meta.css.length > 0) item.meta = { css: field.meta.css };
    return item;
  });
  if (Object.keys(spec.scripts).length > 0) clean.scripts = spec.scripts;
  if (spec.initialScript.length > 0) clean.initialScript = spec.initialScript;
  if (spec.submitScript.length > 0) clean.submitScript = spec.submitScript;
  if (spec.submitLabel !== 'Submit') clean.submitLabel = spec.submitLabel;
  if (!spec.showSubmit) clean.showSubmit = false;
  return stringifyYaml(clean).trimEnd();
}

function makeUniqueFieldName(fields: FormFieldDefinition[]): string {
  let index = fields.length + 1;
  const names = new Set(fields.map((field) => field.name));
  while (names.has(`field_${index}`)) {
    index += 1;
  }
  return `field_${index}`;
}

function makeUniqueScriptName(scripts: Record<string, string>): string {
  let index = Object.keys(scripts).length + 1;
  while (`script_${index}` in scripts) {
    index += 1;
  }
  return `script_${index}`;
}

function parseOptionsText(value: string): FormOption[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [labelRaw, valueRaw] = line.split('|', 2);
      const label = (labelRaw ?? '').trim();
      const optionValue = (valueRaw ?? '').trim() || label;
      return { label, value: optionValue };
    })
    .filter((option) => option.label.length > 0);
}

function formatOptionsText(options: FormOption[]): string {
  return options.map((option) => (option.value === option.label ? option.label : `${option.label} | ${option.value}`)).join('\n');
}

function createLiveState(spec: FormSpec): LiveFormState {
  const values: Record<string, string | boolean> = {};
  const options: Record<string, FormOption[]> = {};
  for (const field of spec.fields) {
    values[field.name] = field.value;
    options[field.name] = field.options.map((option) => ({ ...option }));
  }
  return { values, options, errors: {} };
}

function reconcileLiveState(live: LiveFormState, spec: FormSpec): void {
  const fieldNames = new Set(spec.fields.map((field) => field.name));
  for (const field of spec.fields) {
    if (!(field.name in live.values)) {
      live.values[field.name] = field.value;
    }
    if (!(field.name in live.options)) {
      live.options[field.name] = field.options.map((option) => ({ ...option }));
    }
  }
  for (const name of Object.keys(live.values)) {
    if (!fieldNames.has(name)) {
      delete live.values[name];
      delete live.options[name];
      delete live.errors[name];
    }
  }
}

function resultText(result: ScriptingRunResult): string {
  if (result.ok) {
    return `Executed ${result.linesExecuted} line${result.linesExecuted === 1 ? '' : 's'}, ${result.toolCalls} tool call${result.toolCalls === 1 ? '' : 's'}.`;
  }
  return `Script error: ${result.error ?? 'unknown error'}`;
}

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-form-plugin hvy-form-plugin-${ctx.mode}`;
  let live = createLiveState(parseFormSpec(ctx.block.text).spec);
  let initialized = false;
  let statusText = '';
  let statusError = false;
  let runQueue = Promise.resolve();
  let forceEditorRender = false;
  const inputTimers = new Map<string, number>();
  let openFieldMetaName: string | null = null;

  const parseCurrent = () => parseFormSpec(ctx.block.text);
  const commitSpec = (spec: FormSpec) => ctx.setText(serializeFormSpec(spec));

  const runNamedScript = (scriptName: string, reason: string): void => {
    const name = scriptName.trim();
    if (name.length === 0) {
      return;
    }
    const { spec } = parseCurrent();
    const source = spec.scripts[name];
    if (typeof source !== 'string') {
      statusText = `Script "${name}" is not defined.`;
      statusError = true;
      renderReader();
      return;
    }
    const formApi: ScriptingFormApi = {
      get_value: (fieldName) => live.values[fieldName],
      set_value: (fieldName, value) => {
        live.values[fieldName] = typeof value === 'boolean' ? value : String(value ?? '');
        renderReader();
      },
      get_values: () => ({ ...live.values }),
      set_options: (fieldName, options) => {
        live.options[fieldName] = Array.isArray(options)
          ? options
              .map((option) => ({
                label: String((option as ScriptingFormOption).label ?? ''),
                value: String((option as ScriptingFormOption).value ?? (option as ScriptingFormOption).label ?? ''),
              }))
              .filter((option) => option.label.length > 0)
          : [];
        renderReader();
      },
      get_options: (fieldName) => (live.options[fieldName] ?? []).map((option) => ({ ...option })),
      set_error: (fieldName, message) => {
        live.errors[fieldName] = String(message ?? '');
        renderReader();
      },
      clear_error: (fieldName) => {
        delete live.errors[fieldName];
        renderReader();
      },
    };
    runQueue = runQueue
      .then(() =>
        runUserScript({
          document: ctx.rawDocument,
          source,
          componentId: `${ctx.block.schema.id || ctx.block.id}:${name}:${reason}`,
          pluginVersion: String(ctx.block.schema.pluginConfig.version ?? FORM_PLUGIN_VERSION),
          form: formApi,
        })
      )
      .then((result) => {
        statusText = resultText(result);
        statusError = !result.ok;
        renderReader();
      })
      .catch((error) => {
        statusText = error instanceof Error ? error.message : 'Script failed.';
        statusError = true;
        renderReader();
      });
  };

  function renderEditor(): void {
    const { spec, error } = parseCurrent();
    const scriptNames = Object.keys(spec.scripts);
    root.innerHTML = '';

    if (error) {
      const errorBox = document.createElement('div');
      errorBox.className = 'hvy-form-error';
      errorBox.textContent = `Form YAML error: ${error}`;
      root.appendChild(errorBox);
    }

    const fieldSection = document.createElement('section');
    fieldSection.className = 'hvy-form-editor-section';
    const fieldHead = document.createElement('div');
    fieldHead.className = 'hvy-form-editor-head';
    fieldHead.innerHTML = '<strong>Fields</strong>';
    const addField = document.createElement('button');
    addField.type = 'button';
    addField.className = 'ghost';
    addField.dataset.formAction = 'add-field';
    addField.textContent = 'Add Field';
    fieldHead.appendChild(addField);
    fieldSection.appendChild(fieldHead);

    spec.fields.forEach((field, index) => {
      const article = document.createElement('article');
      article.className = 'hvy-form-field-editor';
      article.dataset.formFieldIndex = String(index);
      article.innerHTML = `
        <div class="hvy-form-field-editor-head">
          <strong>${escapeHtml(field.label || field.name)}</strong>
          <span>
            <button type="button" class="ghost" data-form-action="move-field-up" data-form-field-index="${index}">Up</button>
            <button type="button" class="ghost" data-form-action="move-field-down" data-form-field-index="${index}">Down</button>
            ${ctx.advanced ? `<button type="button" class="ghost" data-form-action="toggle-field-meta" data-form-field-index="${index}">Meta</button>` : ''}
            <button type="button" class="danger" data-form-action="remove-field" data-form-field-index="${index}">Remove</button>
          </span>
        </div>
        <div class="hvy-form-editor-grid">
          ${renderTextInput('Name', 'name', field.name, index)}
          ${renderTextInput('Label', 'label', field.label, index)}
          <label><span>Type</span><select data-form-field-index="${index}" data-form-field-prop="type">${FIELD_TYPES.map((type) => `<option value="${type}"${field.type === type ? ' selected' : ''}>${type}</option>`).join('')}</select></label>
          ${field.type === 'checkbox'
            ? `<label class="hvy-form-checkbox-label"><span>Default Checked</span><input type="checkbox" data-form-field-index="${index}" data-form-field-prop="value" ${field.value === true ? 'checked' : ''}></label>`
            : renderTextInput('Default Value', 'value', String(field.value ?? ''), index)}
          ${renderTextInput('Placeholder', 'placeholder', field.placeholder, index)}
          <label class="hvy-form-checkbox-label"><span>Required</span><input type="checkbox" data-form-field-index="${index}" data-form-field-prop="required" ${field.required ? 'checked' : ''}></label>
        </div>
        ${(field.type === 'select' || field.type === 'radio')
          ? `<label class="hvy-form-options-editor"><span>Options</span><textarea rows="4" data-form-field-index="${index}" data-form-field-prop="options" placeholder="Label | optional-value">${escapeHtml(formatOptionsText(field.options))}</textarea></label>`
          : ''}
      `;
      fieldSection.appendChild(article);
    });

    root.appendChild(fieldSection);
    if (ctx.advanced && openFieldMetaName) {
      const fieldIndex = spec.fields.findIndex((field) => field.name === openFieldMetaName);
      const field = spec.fields[fieldIndex];
      if (field) {
        const modal = document.createElement('div');
        modal.className = 'hvy-form-meta-modal-backdrop';
        modal.innerHTML = `
          <section class="hvy-form-meta-modal" role="dialog" aria-modal="true" aria-label="Field metadata">
            <div class="hvy-form-meta-modal-head">
              <strong>Meta: ${escapeHtml(field.label || field.name)}</strong>
              <button type="button" class="ghost" data-form-action="close-field-meta">Close</button>
            </div>
            <div class="hvy-form-meta-modal-body">
              <label>
                <span>CSS</span>
                <textarea rows="5" data-form-field-index="${fieldIndex}" data-form-field-prop="metaCss" placeholder="margin: 0.5rem 0;">${escapeHtml(field.meta.css)}</textarea>
              </label>
              ${renderScriptSelect('Input Script', 'input', field.triggers.input ?? '', fieldIndex, scriptNames)}
              ${renderScriptSelect('Change Script', 'change', field.triggers.change ?? '', fieldIndex, scriptNames)}
              ${renderScriptSelect('Blur Script', 'blur', field.triggers.blur ?? '', fieldIndex, scriptNames)}
            </div>
          </section>
        `;
        root.appendChild(modal);
      } else {
        openFieldMetaName = null;
      }
    }

    const scriptSection = document.createElement('section');
    scriptSection.className = 'hvy-form-editor-section';
    const scriptHead = document.createElement('div');
    scriptHead.className = 'hvy-form-editor-head';
    scriptHead.innerHTML = '<strong>Scripts</strong>';
    const addScript = document.createElement('button');
    addScript.type = 'button';
    addScript.className = 'ghost';
    addScript.dataset.formAction = 'add-script';
    addScript.textContent = 'Add Script';
    scriptHead.appendChild(addScript);
    scriptSection.appendChild(scriptHead);
    const scriptControls = document.createElement('div');
    scriptControls.className = 'hvy-form-editor-grid';
    scriptControls.innerHTML = `
      ${renderTopScriptSelect('Initial Script', 'initialScript', spec.initialScript, scriptNames)}
      ${renderTopScriptSelect('Submit Script', 'submitScript', spec.submitScript, scriptNames)}
      <label><span>Submit Label</span><input data-form-top-text="submitLabel" value="${escapeAttr(spec.submitLabel)}"></label>
      <label class="hvy-form-checkbox-label"><span>Show Submit</span><input type="checkbox" data-form-top-checkbox="showSubmit" ${spec.showSubmit ? 'checked' : ''}></label>
    `;
    scriptSection.appendChild(scriptControls);
    for (const [name, source] of Object.entries(spec.scripts)) {
      const article = document.createElement('article');
      article.className = 'hvy-form-script-editor';
      article.innerHTML = `
        <div class="hvy-form-field-editor-head">
          <label><span>Script Name</span><input data-form-script-name="${escapeAttr(name)}" value="${escapeAttr(name)}"></label>
          <button type="button" class="danger" data-form-action="remove-script" data-form-script-name="${escapeAttr(name)}">Remove</button>
        </div>
        <textarea rows="7" spellcheck="false" data-form-script-source="${escapeAttr(name)}">${escapeHtml(source)}</textarea>
      `;
      scriptSection.appendChild(article);
    }
    root.appendChild(scriptSection);
  }

  function renderReader(): void {
    const { spec, error } = parseCurrent();
    reconcileLiveState(live, spec);
    root.innerHTML = '';
    if (error) {
      const errorBox = document.createElement('div');
      errorBox.className = 'hvy-form-error';
      errorBox.textContent = `Form YAML error: ${error}`;
      root.appendChild(errorBox);
      return;
    }

    const form = document.createElement('form');
    form.className = 'hvy-form-reader-form';
    form.noValidate = false;
    spec.fields.forEach((field) => form.appendChild(renderReaderField(field)));
    if (spec.showSubmit) {
      const actions = document.createElement('div');
      actions.className = 'hvy-form-actions';
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.className = 'secondary';
      submit.textContent = spec.submitLabel || 'Submit';
      actions.appendChild(submit);
      form.appendChild(actions);
    }
    root.appendChild(form);

    if (statusText.length > 0) {
      const status = document.createElement('div');
      status.className = `hvy-form-status${statusError ? ' hvy-form-status-error' : ''}`;
      status.textContent = statusText;
      root.appendChild(status);
    }

    if (!initialized) {
      initialized = true;
      runNamedScript(spec.initialScript, 'initial');
    }
  }

  function renderReaderField(field: FormFieldDefinition): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = `hvy-form-field hvy-form-field-${field.type}`;
    if (field.meta.css.trim().length > 0) {
      wrap.setAttribute('style', sanitizeInlineCss(field.meta.css));
    }
    wrap.dataset.formFieldName = field.name;
    if (field.type !== 'hidden') {
      const label = document.createElement('span');
      label.className = 'hvy-form-field-label';
      label.textContent = field.label;
      wrap.appendChild(label);
    }

    const value = live.values[field.name] ?? field.value;
    if (field.type === 'textarea') {
      const textarea = document.createElement('textarea');
      textarea.name = field.name;
      textarea.value = String(value ?? '');
      textarea.placeholder = field.placeholder;
      textarea.required = field.required;
      appendControl(wrap, textarea, field);
    } else if (field.type === 'select') {
      const select = document.createElement('select');
      select.name = field.name;
      select.required = field.required;
      for (const option of live.options[field.name] ?? field.options) {
        const node = document.createElement('option');
        node.value = option.value;
        node.textContent = option.label;
        node.selected = option.value === value;
        select.appendChild(node);
      }
      appendControl(wrap, select, field);
    } else if (field.type === 'radio') {
      const group = document.createElement('div');
      group.className = 'hvy-form-radio-group';
      for (const option of live.options[field.name] ?? field.options) {
        const radioLabel = document.createElement('label');
        radioLabel.className = 'hvy-form-radio-option';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = field.name;
        radio.value = option.value;
        radio.checked = option.value === value;
        radio.required = field.required;
        wireControl(radio, field);
        radioLabel.appendChild(radio);
        radioLabel.appendChild(document.createTextNode(option.label));
        group.appendChild(radioLabel);
      }
      wrap.appendChild(group);
    } else {
      const input = document.createElement('input');
      input.type = field.type;
      input.name = field.name;
      input.placeholder = field.placeholder;
      input.required = field.required;
      if (field.type === 'checkbox') {
        input.checked = value === true || value === 'true';
      } else {
        input.value = String(value ?? '');
      }
      appendControl(wrap, input, field);
    }

    const error = live.errors[field.name];
    if (error) {
      const errorNode = document.createElement('span');
      errorNode.className = 'hvy-form-field-error';
      errorNode.textContent = error;
      wrap.appendChild(errorNode);
    }
    return wrap;
  }

  function appendControl(wrap: HTMLElement, control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, field: FormFieldDefinition): void {
    wireControl(control, field);
    wrap.appendChild(control);
  }

  function wireControl(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, field: FormFieldDefinition): void {
    control.dataset.formControl = 'true';
    control.dataset.formFieldName = field.name;
    control.addEventListener('input', () => {
      updateLiveValue(control, field);
      const script = field.triggers.input ?? '';
      if (script.length > 0) {
        const key = field.name;
        const existing = inputTimers.get(key);
        if (existing) {
          window.clearTimeout(existing);
        }
        inputTimers.set(key, window.setTimeout(() => runNamedScript(script, `input:${field.name}`), 250));
      }
    });
    control.addEventListener('change', () => {
      updateLiveValue(control, field);
      runNamedScript(field.triggers.change ?? '', `change:${field.name}`);
    });
    control.addEventListener('blur', () => {
      updateLiveValue(control, field);
      runNamedScript(field.triggers.blur ?? '', `blur:${field.name}`);
    });
  }

  function updateLiveValue(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, field: FormFieldDefinition): void {
    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      live.values[field.name] = control.checked;
      return;
    }
    live.values[field.name] = control.value;
  }

  const onEditorInput = (event: Event) => {
    if (ctx.mode !== 'editor') return;
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (!target) return;
    const { spec } = parseCurrent();
    if (target.dataset.formFieldIndex && target.dataset.formFieldProp) {
      const index = Number.parseInt(target.dataset.formFieldIndex, 10);
      const field = spec.fields[index];
      if (!field) return;
      const prop = target.dataset.formFieldProp;
      if (prop === 'type') field.type = normalizeFieldType(target.value);
      if (prop === 'required' && target instanceof HTMLInputElement) field.required = target.checked;
      if (prop === 'value') field.value = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value;
      if (prop === 'options' && target instanceof HTMLTextAreaElement) field.options = parseOptionsText(target.value);
      if (prop === 'name') field.name = target.value.trim();
      if (prop === 'label') field.label = target.value;
      if (prop === 'placeholder') field.placeholder = target.value;
      if (prop === 'metaCss') field.meta.css = target.value;
      commitSpec(spec);
      return;
    }
    if (target.dataset.formFieldIndex && target.dataset.formTrigger) {
      const index = Number.parseInt(target.dataset.formFieldIndex, 10);
      const field = spec.fields[index];
      const trigger = target.dataset.formTrigger as FormTriggerName;
      if (!field) return;
      if (target.value.trim().length > 0) {
        field.triggers[trigger] = target.value.trim();
      } else {
        delete field.triggers[trigger];
      }
      commitSpec(spec);
      return;
    }
    if (target.dataset.formTopScript) {
      const key = target.dataset.formTopScript as 'initialScript' | 'submitScript';
      spec[key] = target.value.trim();
      commitSpec(spec);
      return;
    }
    if (target.dataset.formTopText === 'submitLabel') {
      spec.submitLabel = target.value;
      commitSpec(spec);
      return;
    }
    if (target.dataset.formTopCheckbox === 'showSubmit' && target instanceof HTMLInputElement) {
      spec.showSubmit = target.checked;
      commitSpec(spec);
      return;
    }
    if (target.dataset.formScriptSource) {
      spec.scripts[target.dataset.formScriptSource] = target.value;
      commitSpec(spec);
      return;
    }
    if (target.dataset.formScriptName) {
      const oldName = target.dataset.formScriptName;
      const nextName = target.value.trim();
      if (nextName.length === 0 || nextName === oldName || nextName in spec.scripts) return;
      spec.scripts[nextName] = spec.scripts[oldName] ?? '';
      delete spec.scripts[oldName];
      if (spec.initialScript === oldName) spec.initialScript = nextName;
      if (spec.submitScript === oldName) spec.submitScript = nextName;
      for (const field of spec.fields) {
        for (const trigger of ['input', 'change', 'blur'] as const) {
          if (field.triggers[trigger] === oldName) field.triggers[trigger] = nextName;
        }
      }
      commitSpec(spec);
    }
  };

  const onClick = (event: Event) => {
    if (ctx.mode !== 'editor') return;
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-form-action]');
    if (!button) return;
    const { spec } = parseCurrent();
    const action = button.dataset.formAction;
    if (action === 'add-field') {
      const name = makeUniqueFieldName(spec.fields);
      spec.fields.push({ ...DEFAULT_FIELD, name, label: `Field ${spec.fields.length + 1}` });
      forceEditorRender = true;
    }
    if (action === 'remove-field') {
      const index = Number.parseInt(button.dataset.formFieldIndex ?? '', 10);
      if (!Number.isNaN(index)) spec.fields.splice(index, 1);
      forceEditorRender = true;
    }
    if (action === 'move-field-up' || action === 'move-field-down') {
      const index = Number.parseInt(button.dataset.formFieldIndex ?? '', 10);
      const targetIndex = action === 'move-field-up' ? index - 1 : index + 1;
      if (targetIndex >= 0 && targetIndex < spec.fields.length) {
        const [field] = spec.fields.splice(index, 1);
        if (field) spec.fields.splice(targetIndex, 0, field);
      }
      forceEditorRender = true;
    }
    if (action === 'toggle-field-meta') {
      const index = Number.parseInt(button.dataset.formFieldIndex ?? '', 10);
      const field = spec.fields[index];
      if (!field) return;
      openFieldMetaName = field.name;
      forceEditorRender = true;
      renderEditor();
      return;
    }
    if (action === 'close-field-meta') {
      openFieldMetaName = null;
      forceEditorRender = true;
      renderEditor();
      return;
    }
    if (action === 'add-script') {
      spec.scripts[makeUniqueScriptName(spec.scripts)] = '# Python form script';
      forceEditorRender = true;
    }
    if (action === 'remove-script') {
      const name = button.dataset.formScriptName ?? '';
      delete spec.scripts[name];
      if (spec.initialScript === name) spec.initialScript = '';
      if (spec.submitScript === name) spec.submitScript = '';
      forceEditorRender = true;
    }
    commitSpec(spec);
  };

  const onSubmit = (event: Event) => {
    event.preventDefault();
    const { spec } = parseCurrent();
    runNamedScript(spec.submitScript, 'submit');
  };

  const refresh = () => {
    const { spec } = parseCurrent();
    reconcileLiveState(live, spec);
    if (ctx.mode === 'editor') {
      if (!forceEditorRender && root.contains(document.activeElement)) {
        return;
      }
      forceEditorRender = false;
      renderEditor();
    } else {
      renderReader();
    }
  };

  if (ctx.mode === 'editor') {
    root.addEventListener('input', onEditorInput);
    root.addEventListener('change', onEditorInput);
    root.addEventListener('click', onClick);
  } else {
    root.addEventListener('submit', onSubmit);
  }

  refresh();

  return {
    element: root,
    refresh,
    unmount: () => {
      root.removeEventListener('input', onEditorInput);
      root.removeEventListener('change', onEditorInput);
      root.removeEventListener('click', onClick);
      root.removeEventListener('submit', onSubmit);
      for (const timer of inputTimers.values()) {
        window.clearTimeout(timer);
      }
    },
  };
}

function renderTextInput(label: string, prop: string, value: string, index: number): string {
  return `<label><span>${escapeHtml(label)}</span><input data-form-field-index="${index}" data-form-field-prop="${escapeAttr(prop)}" value="${escapeAttr(value)}"></label>`;
}

function renderScriptSelect(label: string, trigger: FormTriggerName, selected: string, index: number, scriptNames: string[]): string {
  return `<label><span>${escapeHtml(label)}</span><select data-form-field-index="${index}" data-form-trigger="${trigger}">${renderScriptOptions(selected, scriptNames)}</select></label>`;
}

function renderTopScriptSelect(label: string, key: string, selected: string, scriptNames: string[]): string {
  return `<label><span>${escapeHtml(label)}</span><select data-form-top-script="${escapeAttr(key)}">${renderScriptOptions(selected, scriptNames)}</select></label>`;
}

function renderScriptOptions(selected: string, scriptNames: string[]): string {
  return [
    `<option value=""${selected.length === 0 ? ' selected' : ''}>None</option>`,
    ...scriptNames.map((name) => `<option value="${escapeAttr(name)}"${selected === name ? ' selected' : ''}>${escapeHtml(name)}</option>`),
  ].join('');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

export const formPluginFactory: HvyPluginFactory = build;

export const formPluginRegistration: HvyPluginRegistration = {
  id: FORM_PLUGIN_ID,
  displayName: 'Form',
  create: formPluginFactory,
};
