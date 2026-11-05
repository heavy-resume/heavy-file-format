import './form-range-field.css';

export interface FormRangeBounds {
  min: number;
  max: number;
  step: number;
}

export const DEFAULT_FORM_RANGE_BOUNDS: FormRangeBounds = { min: 0, max: 100, step: 1 };

export function normalizeFormRangeBound(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim().length > 0 ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeFormRangeStep(value: unknown, fallback: number): number {
  const parsed = normalizeFormRangeBound(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

export function normalizeFormRangeBounds(value: Record<string, unknown>): FormRangeBounds {
  return {
    min: normalizeFormRangeBound(value.min, DEFAULT_FORM_RANGE_BOUNDS.min),
    max: normalizeFormRangeBound(value.max, DEFAULT_FORM_RANGE_BOUNDS.max),
    step: normalizeFormRangeStep(value.step, DEFAULT_FORM_RANGE_BOUNDS.step),
  };
}

/** The authored default: a decimal string, or empty to start at the midpoint. */
export function normalizeFormRangeDefault(value: unknown): string {
  const parsed = normalizeFormRangeBound(value, Number.NaN);
  return Number.isNaN(parsed) ? '' : String(parsed);
}

function decimalPlaces(value: number): number {
  const [mantissa = '', exponent = '0'] = String(value).split('e');
  return Math.max(0, (mantissa.split('.')[1]?.length ?? 0) - Number(exponent));
}

/** Resolves any value to the one the slider can hold, matching HTML range sanitization. */
export function resolveFormRangeValue(value: unknown, bounds: FormRangeBounds): string {
  const { min, max, step } = bounds;
  if (max <= min) {
    return String(min);
  }
  const requested = normalizeFormRangeBound(value, min + (max - min) / 2);
  const clamped = Math.min(max, Math.max(min, requested));
  const stepCount = Math.round((clamped - min) / step);
  // Rounding to the bounds' own precision keeps 3 * 0.1 from landing past a max of 0.3.
  const decimals = Math.max(decimalPlaces(min), decimalPlaces(step));
  const valueAtStep = (count: number) => Number((min + count * step).toFixed(decimals));
  const snapped = valueAtStep(stepCount);
  return String(snapped > max ? valueAtStep(stepCount - 1) : snapped);
}

function fillPercent(value: string, { min, max }: FormRangeBounds): string {
  return max > min ? `${((Number(value) - min) / (max - min)) * 100}%` : '0%';
}

// Reserves the widest reachable value so the track does not shift under the pointer mid-drag.
function readoutWidthCh({ min, max, step }: FormRangeBounds): number {
  const decimals = Math.max(decimalPlaces(min), decimalPlaces(step));
  const integerWidth = Math.max(String(Math.trunc(min)).length, String(Math.trunc(max)).length);
  return integerWidth + (decimals > 0 ? decimals + 1 : 0);
}

interface CreateFormRangeControlOptions {
  name: string;
  bounds: FormRangeBounds;
  value: string;
}

export function createFormRangeControl(options: CreateFormRangeControlOptions): { control: HTMLElement; input: HTMLInputElement } {
  const control = document.createElement('span');
  control.className = 'hvy-form-range-control';
  const input = document.createElement('input');
  input.type = 'range';
  input.name = options.name;
  input.className = 'hvy-form-range-input';
  // Browsers sanitize value against these, so they have to be set first.
  input.min = String(options.bounds.min);
  input.max = String(options.bounds.max);
  input.step = String(options.bounds.step);
  input.value = options.value;
  const readout = document.createElement('output');
  readout.className = 'hvy-form-range-readout';
  // The slider already exposes its value; left visible here it would also join the label's accessible name.
  readout.setAttribute('aria-hidden', 'true');
  readout.style.minWidth = `${readoutWidthCh(options.bounds)}ch`;
  const syncDisplay = () => {
    readout.textContent = input.value;
    input.style.setProperty('--hvy-form-range-fill', fillPercent(input.value, options.bounds));
  };
  syncDisplay();
  input.addEventListener('input', syncDisplay);
  control.append(input, readout);
  return { control, input };
}

export interface FormRangeDragTracker {
  watch(input: HTMLInputElement): void;
  isDragging(): boolean;
  dispose(): void;
}

// Removing a slider from the DOM ends its drag and focus cannot restore that, so
// anything that may rerender needs to know when the pointer is holding one.
export function createFormRangeDragTracker(): FormRangeDragTracker {
  let dragging = false;
  const release = () => {
    dragging = false;
    window.removeEventListener('pointerup', release);
    window.removeEventListener('pointercancel', release);
  };
  return {
    watch(input) {
      input.addEventListener('pointerdown', () => {
        dragging = true;
        window.addEventListener('pointerup', release);
        window.addEventListener('pointercancel', release);
      });
    },
    isDragging: () => dragging,
    dispose: release,
  };
}

export function renderFormRangeEditorInputs(field: FormRangeBounds & { value: unknown }, index: number): string {
  const numberInput = (label: string, prop: string, value: string, attrs = '') =>
    `<label><span>${label}</span><input type="number" step="any"${attrs} value="${value}" data-form-field-index="${index}" data-form-field-prop="${prop}"></label>`;
  return [
    numberInput('Default Value', 'value', normalizeFormRangeDefault(field.value), ' placeholder="Midpoint"'),
    numberInput('Minimum', 'min', String(field.min)),
    numberInput('Maximum', 'max', String(field.max)),
    numberInput('Step', 'step', String(field.step), ' min="0"'),
  ].join('');
}
