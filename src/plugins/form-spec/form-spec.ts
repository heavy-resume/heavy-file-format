import { parse as parseYaml } from 'yaml';
import { stringifyYamlUnfolded } from '../../hvy/yaml-stringify';
import type { JsonObject } from '../../hvy/types';
import { SCRIPTING_LIBRARY_OPTIONS, type ScriptingLibraryName } from '../scripting/python-program';
import { normalizeFormPhotoMeta, type FormPhotoValue } from '../form-photo-field/form-photo-field';
import {
  DEFAULT_FORM_RANGE_BOUNDS,
  normalizeFormRangeBounds,
  normalizeFormRangeDefault,
} from '../form-range-field/form-range-field';

export const FORM_PLUGIN_VERSION = '0.1';

export const FORM_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'range',
  'select',
  'checkbox',
  'radio',
  'date',
  'email',
  'tel',
  'url',
  'password',
  'hidden',
  'photo',
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];
export type FormTriggerName = 'input' | 'change' | 'blur';
export type FormSubmitAction = 'script' | 'ai-generate';

const FIELD_TYPE_ALIASES: Record<string, FormFieldType> = {
  dropdown: 'select',
};

export interface FormOption {
  label: string;
  value: string;
}

export interface FormFieldDefinition {
  label: string;
  type: FormFieldType;
  value: FormFieldValue;
  placeholder: string;
  required: boolean;
  disabled: boolean;
  rows: number;
  min: number;
  max: number;
  step: number;
  options: FormOption[];
  triggers: Partial<Record<FormTriggerName, string>>;
  meta: {
    css: string;
    accept: string[];
    maxBytes: number;
    maxWidth: number;
    maxHeight: number;
  };
}

export interface FormSpec {
  fields: FormFieldDefinition[];
  scripts: Record<string, string>;
  formCss: string;
  actionsCss: string;
  submitCss: string;
  initialScript: string;
  changeScript: string;
  submitAction: FormSubmitAction;
  submitSourceScript: string;
  submitScript: string;
  submitPrompt: string;
  submitInputCharLimit: number;
  submitOutputCharLimit: number;
  submitLabel: string;
  showSubmit: boolean;
  submitDisabled: boolean;
  submitDisabledReason: string;
  scriptLibraries: ScriptingLibraryName[];
  scriptStepBudget: number;
}

export interface ParsedFormSpec {
  spec: FormSpec;
  error: string | null;
}

export type FormFieldValue = string | boolean | FormPhotoValue | null;

function defaultFormSpec(): FormSpec {
  return {
    fields: [],
    scripts: {},
    formCss: '',
    actionsCss: '',
    submitCss: '',
    initialScript: '',
    changeScript: '',
    submitAction: 'script',
    submitSourceScript: '',
    submitScript: '',
    submitPrompt: '',
    submitInputCharLimit: 4000,
    submitOutputCharLimit: 4000,
    submitLabel: 'Submit',
    showSubmit: true,
    submitDisabled: false,
    submitDisabledReason: '',
    scriptLibraries: [],
    scriptStepBudget: 100_000,
  };
}

export const DEFAULT_FORM_FIELD: FormFieldDefinition = {
  label: 'Field',
  type: 'text',
  value: '',
  placeholder: '',
  required: false,
  disabled: false,
  rows: 0,
  ...DEFAULT_FORM_RANGE_BOUNDS,
  options: [],
  triggers: {},
  meta: {
    css: '',
    accept: [],
    maxBytes: 0,
    maxWidth: 0,
    maxHeight: 0,
  },
};

// DEFAULT_FORM_FIELD has to define every FormFieldDefinition key, so this cannot fall behind the type.
export const FORM_FIELD_KEYS: ReadonlySet<string> = new Set(Object.keys(DEFAULT_FORM_FIELD));

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export interface FormFieldTypeIssue {
  label: string;
  index: number;
  rawType: string;
  canonicalType: FormFieldType | null;
}

export function getCanonicalFormFieldType(value: unknown): FormFieldType | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (FIELD_TYPE_ALIASES[normalized]) {
    return FIELD_TYPE_ALIASES[normalized];
  }
  return FORM_FIELD_TYPES.includes(normalized as FormFieldType) ? (normalized as FormFieldType) : null;
}

export function findFormFieldTypeIssues(source: string): FormFieldTypeIssue[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch {
    return [];
  }
  if (!isObject(parsed) || !Array.isArray(parsed.fields)) {
    return [];
  }
  const issues: FormFieldTypeIssue[] = [];
  parsed.fields.forEach((field, index) => {
    if (!isObject(field) || typeof field.type !== 'string') {
      return;
    }
    const rawType = field.type.trim();
    const canonicalType = getCanonicalFormFieldType(rawType);
    if (canonicalType === null || rawType !== canonicalType) {
      issues.push({
        label: typeof field.label === 'string' && field.label.trim() ? field.label.trim() : `Field ${index + 1}`,
        index,
        rawType,
        canonicalType,
      });
    }
  });
  return issues;
}

export function normalizeFieldType(value: unknown): FormFieldType {
  return getCanonicalFormFieldType(value) ?? 'text';
}

export function normalizeFieldRows(value: unknown): number {
  const numberValue = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : 0;
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
  const label = typeof raw.label === 'string' && raw.label.trim().length > 0 ? raw.label.trim() : `Field ${index + 1}`;
  const type = normalizeFieldType(raw.type);
  const rawValue = raw.value;
  const fieldValue = type === 'checkbox'
    ? rawValue === true || rawValue === 'true'
    : type === 'photo'
      ? null
      : type === 'range'
        ? normalizeFormRangeDefault(rawValue)
        : typeof rawValue === 'string' ? rawValue : String(rawValue ?? '');
  const options = Array.isArray(raw.options) ? raw.options.map(normalizeOption).filter((option): option is FormOption => option !== null) : [];
  const meta = isObject(raw.meta) ? raw.meta : {};
  return {
    label,
    type,
    value: fieldValue,
    placeholder: typeof raw.placeholder === 'string' ? raw.placeholder : '',
    required: raw.required === true,
    disabled: raw.disabled === true,
    rows: type === 'textarea' ? normalizeFieldRows(raw.rows) : 0,
    ...normalizeFormRangeBounds(raw),
    options,
    triggers: normalizeTriggers(raw.triggers),
    meta: normalizeFormPhotoMeta(meta),
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

export function normalizeSubmitAction(value: unknown): FormSubmitAction {
  return value === 'ai-generate' ? 'ai-generate' : 'script';
}

function normalizeScriptLibraries(value: unknown): ScriptingLibraryName[] {
  const raw = Array.isArray(value) ? value : [];
  const allowed = new Set(SCRIPTING_LIBRARY_OPTIONS);
  const libraries: ScriptingLibraryName[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      continue;
    }
    const normalized = item.trim();
    if (allowed.has(normalized as ScriptingLibraryName) && !libraries.includes(normalized as ScriptingLibraryName)) {
      libraries.push(normalized as ScriptingLibraryName);
    }
  }
  return libraries;
}

export function normalizePositiveInt(value: unknown, fallback: number): number {
  const numberValue = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : fallback;
}


function parseFormConfig(config?: JsonObject): Pick<FormSpec, 'formCss' | 'actionsCss' | 'submitCss' | 'initialScript' | 'changeScript' | 'submitAction' | 'submitSourceScript' | 'submitScript' | 'submitPrompt' | 'submitInputCharLimit' | 'submitOutputCharLimit' | 'submitLabel' | 'showSubmit' | 'submitDisabled' | 'submitDisabledReason' | 'scriptLibraries' | 'scriptStepBudget'> {
  return {
    formCss: typeof config?.formCss === 'string' ? config.formCss : '',
    actionsCss: typeof config?.actionsCss === 'string' ? config.actionsCss : '',
    submitCss: typeof config?.submitCss === 'string' ? config.submitCss : '',
    initialScript: typeof config?.initialScript === 'string' ? config.initialScript.trim() : '',
    changeScript: typeof config?.changeScript === 'string' ? config.changeScript.trim() : '',
    submitAction: normalizeSubmitAction(config?.submitAction),
    submitSourceScript: typeof config?.submitSourceScript === 'string' ? config.submitSourceScript.trim() : '',
    submitScript: typeof config?.submitScript === 'string' ? config.submitScript.trim() : '',
    submitPrompt: typeof config?.submitPrompt === 'string' ? config.submitPrompt : '',
    submitInputCharLimit: normalizePositiveInt(config?.submitInputCharLimit, 4000),
    submitOutputCharLimit: normalizePositiveInt(config?.submitOutputCharLimit, 4000),
    submitLabel: typeof config?.submitLabel === 'string' && config.submitLabel.trim().length > 0 ? config.submitLabel : 'Submit',
    showSubmit: config?.showSubmit !== false,
    submitDisabled: config?.submitDisabled === true,
    submitDisabledReason: typeof config?.submitDisabledReason === 'string' ? config.submitDisabledReason : '',
    scriptLibraries: normalizeScriptLibraries(config?.scriptLibraries),
    scriptStepBudget: normalizePositiveInt(config?.scriptStepBudget ?? config?.maxLines, 100_000),
  };
}

export function serializeFormConfig(spec: FormSpec): JsonObject {
  return {
    version: FORM_PLUGIN_VERSION,
    formCss: spec.formCss,
    actionsCss: spec.actionsCss,
    submitCss: spec.submitCss,
    initialScript: spec.initialScript,
    changeScript: spec.changeScript,
    submitAction: spec.submitAction,
    submitSourceScript: spec.submitSourceScript,
    submitScript: spec.submitScript,
    submitPrompt: spec.submitPrompt,
    submitInputCharLimit: spec.submitInputCharLimit,
    submitOutputCharLimit: spec.submitOutputCharLimit,
    submitLabel: spec.submitLabel,
    showSubmit: spec.showSubmit,
    submitDisabled: spec.submitDisabled,
    submitDisabledReason: spec.submitDisabledReason,
    scriptLibraries: spec.scriptLibraries,
    scriptStepBudget: spec.scriptStepBudget,
  };
}

// Forms parse on every refresh and their source rarely changes. Only the YAML result is
// reused: parseFormSpec builds a new spec from it each call, because callers edit specs.
const FORM_YAML_CACHE_LIMIT = 2048;
const formYamlCache = new Map<string, { parsed: unknown } | { error: unknown }>();

function parseFormYaml(source: string): unknown {
  let entry = formYamlCache.get(source);
  if (entry) {
    formYamlCache.delete(source);
  } else {
    try {
      entry = { parsed: parseYaml(source) };
    } catch (error) {
      entry = { error };
    }
  }
  formYamlCache.set(source, entry);
  if (formYamlCache.size > FORM_YAML_CACHE_LIMIT) {
    formYamlCache.delete(formYamlCache.keys().next().value as string);
  }
  if ('error' in entry) {
    throw entry.error;
  }
  return entry.parsed;
}

export function parseFormSpec(source: string, config?: JsonObject): ParsedFormSpec {
  const behavior = parseFormConfig(config);
  if (source.trim().length === 0) {
    return {
      spec: { ...defaultFormSpec(), ...behavior },
      error: null,
    };
  }

  try {
    const parsed = parseFormYaml(source);
    if (!isObject(parsed)) {
      return {
        spec: { ...defaultFormSpec(), ...behavior },
        error: 'Form YAML must be an object.',
      };
    }
    return {
      spec: {
        fields: Array.isArray(parsed.fields) ? parsed.fields.map(normalizeField) : [],
        scripts: normalizeScripts(parsed.scripts),
        ...behavior,
      },
      error: null,
    };
  } catch (error) {
    return {
      spec: { ...defaultFormSpec(), ...behavior },
      error: error instanceof Error ? error.message : 'Invalid form YAML.',
    };
  }
}

export function serializeFormSpec(spec: FormSpec): string {
  const clean: Record<string, unknown> = {};
  clean.fields = spec.fields.map((field) => {
    const item: Record<string, unknown> = {
      label: field.label,
      type: field.type,
    };
    const value = field.type === 'range' ? normalizeFormRangeDefault(field.value) : field.value;
    if (field.type !== 'photo' && value !== '' && value !== false && value !== null) item.value = field.type === 'range' ? Number(value) : value;
    if (field.placeholder.length > 0) item.placeholder = field.placeholder;
    if (field.required) item.required = true;
    if (field.disabled) item.disabled = true;
    if (field.type === 'textarea' && field.rows > 0) item.rows = field.rows;
    if (field.type === 'range') {
      item.min = field.min;
      item.max = field.max;
      item.step = field.step;
    }
    if (field.options.length > 0) item.options = field.options.map((option) => ({ label: option.label, value: option.value }));
    if (Object.keys(field.triggers).length > 0) item.triggers = field.triggers;
    const meta: Record<string, unknown> = {};
    if (field.meta.css.length > 0) meta.css = field.meta.css;
    if (field.type === 'photo') {
      if (field.meta.accept.length > 0) meta.accept = field.meta.accept;
      if (field.meta.maxBytes > 0) meta.maxBytes = field.meta.maxBytes;
      if (field.meta.maxWidth > 0) meta.maxWidth = field.meta.maxWidth;
      if (field.meta.maxHeight > 0) meta.maxHeight = field.meta.maxHeight;
    }
    if (Object.keys(meta).length > 0) item.meta = meta;
    return item;
  });
  if (Object.keys(spec.scripts).length > 0) clean.scripts = spec.scripts;
  return stringifyYamlUnfolded(clean).trimEnd();
}

export function makeUniqueFieldLabel(fields: FormFieldDefinition[]): string {
  let index = fields.length + 1;
  const labels = new Set(fields.map((field) => field.label));
  while (labels.has(`Field ${index}`)) {
    index += 1;
  }
  return `Field ${index}`;
}

export function makeUniqueScriptName(scripts: Record<string, string>): string {
  let index = Object.keys(scripts).length + 1;
  while (`script_${index}` in scripts) {
    index += 1;
  }
  return `script_${index}`;
}

export function parseOptionsText(value: string): FormOption[] {
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

export function formatOptionsText(options: FormOption[]): string {
  return options.map((option) => (option.value === option.label ? option.label : `${option.label} | ${option.value}`)).join('\n');
}

export function normalizePhotoValue(value: unknown): FormPhotoValue | null {
  if (!isObject(value)) return null;
  const attachmentId = typeof value.attachmentId === 'string' ? value.attachmentId : '';
  const imageFile = typeof value.imageFile === 'string' ? value.imageFile : '';
  const mediaType = typeof value.mediaType === 'string' ? value.mediaType : '';
  return attachmentId && imageFile && mediaType ? { attachmentId, imageFile, mediaType } : null;
}
