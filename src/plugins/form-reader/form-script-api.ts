import type { ScriptingFormApi, ScriptingFormOption } from '../scripting/runtime';
import { reconcileSelectValue, type LiveFormState } from '../form-live-state/form-live-state';
import { normalizePhotoValue, type FormSpec } from '../form-spec/form-spec';

interface FormScriptApiOptions {
  live: LiveFormState;
  getSpec(): FormSpec;
  /** Called after a script changes live state the reader shows. */
  render(): void;
}

export function createFormScriptApi({ live, getSpec, render }: FormScriptApiOptions): ScriptingFormApi {
  return {
    get_value: (fieldName) => live.values[fieldName],
    set_value: (fieldName, value) => {
      const field = getSpec().fields.find((candidate) => candidate.label === fieldName);
      live.values[fieldName] = field?.type === 'photo'
        ? normalizePhotoValue(value)
        : typeof value === 'boolean' ? value : String(value ?? '');
      render();
    },
    get_values: () => ({ ...live.values }),
    set_options: (fieldName, options) => {
      live.options[fieldName] = Array.isArray(options)
        ? options
            .map(normalizeScriptingFormOption)
            .filter((option) => option.label.length > 0)
        : [];
      if (getSpec().fields.find((field) => field.label === fieldName)?.type === 'select') {
        live.values[fieldName] = reconcileSelectValue(live.values[fieldName] ?? '', live.options[fieldName]!);
      }
      render();
    },
    get_options: (fieldName) => (live.options[fieldName] ?? []).map((option) => ({ ...option })),
    set_error: (fieldName, message) => {
      live.errors[fieldName] = String(message ?? '');
      render();
    },
    clear_error: (fieldName) => {
      delete live.errors[fieldName];
      render();
    },
    set_field_disabled: (fieldName, disabled) => {
      live.disabled[fieldName] = disabled === true;
      render();
    },
    get_field_disabled: (fieldName) => live.disabled[fieldName] === true,
    set_submit_disabled: (disabled, reason) => {
      live.submit = { disabled: disabled === true, reason: disabled === true ? String(reason ?? '') : '' };
      render();
    },
    get_submit_disabled: () => live.submit.disabled,
  };
}

function normalizeScriptingFormOption(option: unknown): ScriptingFormOption {
  if (Array.isArray(option)) {
    const value = String(option[0] ?? '');
    const label = String(option[1] ?? option[0] ?? '');
    return { label, value };
  }
  if (option && typeof option === 'object') {
    const record = option as { label?: unknown; value?: unknown };
    const label = String(record.label ?? '');
    const value = String(record.value ?? record.label ?? '');
    return { label, value };
  }
  const value = String(option ?? '');
  return { label: value, value };
}
