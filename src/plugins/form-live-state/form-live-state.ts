import type { FormFieldDefinition, FormFieldValue, FormOption, FormSpec } from '../form';

interface FieldDefinitionSnapshot {
  type: FormFieldDefinition['type'];
  value: string;
  options: string;
}

export interface LiveSubmitState {
  disabled: boolean;
  reason: string;
}

export interface LiveFormState {
  values: Record<string, FormFieldValue>;
  options: Record<string, FormOption[]>;
  errors: Record<string, string>;
  definitions: Map<string, FieldDefinitionSnapshot>;
  submit: LiveSubmitState;
  submitDefinition: string;
}

export function reconcileSelectValue(value: FormFieldValue, options: FormOption[]): string {
  const current = String(value ?? '');
  return options.some((option) => option.value === current)
    ? current
    : options[0]?.value ?? '';
}

export function createLiveState(spec: FormSpec): LiveFormState {
  const live: LiveFormState = {
    values: {},
    options: {},
    errors: {},
    definitions: new Map(),
    submit: { disabled: false, reason: '' },
    submitDefinition: '',
  };
  reconcileLiveState(live, spec);
  return live;
}

export function reconcileLiveState(live: LiveFormState, spec: FormSpec): void {
  // Like field values, scripts may override the submit state until the
  // document's own submit defaults change.
  const submitDefinition = JSON.stringify([spec.submitDisabled, spec.submitDisabledReason]);
  if (live.submitDefinition !== submitDefinition) {
    live.submit = { disabled: spec.submitDisabled, reason: spec.submitDisabledReason };
    live.submitDefinition = submitDefinition;
  }
  const fieldLabels = new Set(spec.fields.map((field) => field.label));
  for (const field of spec.fields) {
    const previous = live.definitions.get(field.label);
    const next = { type: field.type, value: JSON.stringify(field.value), options: JSON.stringify(field.options) };
    const typeChanged = !previous || previous.type !== next.type;
    const valueChanged = typeChanged || previous.value !== next.value;
    const optionsChanged = typeChanged || previous.options !== next.options;

    // Compare document definitions, not live values: input and scripts may have
    // changed live state without changing the document's defaults or options.
    if (valueChanged) {
      live.values[field.label] = typeof field.value === 'object' && field.value !== null
        ? { ...field.value }
        : field.value;
    }
    if (optionsChanged) {
      live.options[field.label] = field.options.map((option) => ({ ...option }));
    }
    if (field.type === 'select' || (field.type === 'radio' && optionsChanged && previous)) {
      live.values[field.label] = reconcileSelectValue(live.values[field.label]!, live.options[field.label]!);
    }
    if (valueChanged || optionsChanged) {
      delete live.errors[field.label];
    }
    live.definitions.set(field.label, next);
  }
  for (const label of Object.keys(live.values)) {
    if (!fieldLabels.has(label)) {
      delete live.values[label];
      delete live.options[label];
      delete live.errors[label];
      live.definitions.delete(label);
    }
  }
}
