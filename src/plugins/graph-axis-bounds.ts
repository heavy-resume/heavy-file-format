import {
  GRAPH_AXIS_BOUND_FIELDS,
  graphTypeHasNumericXAxis,
  graphTypeHasValueScale,
  graphTypeSupportsAxes,
  type GraphAxisBoundField,
  type GraphType,
} from './graph-chart-config';

const GRAPH_AXIS_BOUND_LABELS: Record<GraphAxisBoundField, string> = {
  xAxisMin: 'X min',
  xAxisMax: 'X max',
  yAxisMin: 'Y min',
  yAxisMax: 'Y max',
};

/** Radial charts have a single value scale, so their bounds drop the axis letter. */
const GRAPH_RADIAL_BOUND_LABELS: Partial<Record<GraphAxisBoundField, string>> = {
  yAxisMin: 'Min',
  yAxisMax: 'Max',
};

function graphAxisBoundLabel(type: GraphType, field: GraphAxisBoundField): string {
  return (!graphTypeSupportsAxes(type) && GRAPH_RADIAL_BOUND_LABELS[field]) || GRAPH_AXIS_BOUND_LABELS[field];
}

const GRAPH_AXIS_BOUND_PAIRS: readonly [GraphAxisBoundField, GraphAxisBoundField][] = [
  ['xAxisMin', 'xAxisMax'],
  ['yAxisMin', 'yAxisMax'],
];

export function isGraphAxisBoundField(field: string): field is GraphAxisBoundField {
  return (GRAPH_AXIS_BOUND_FIELDS as readonly string[]).includes(field);
}

/** An empty or unparseable entry clears the bound so the chart fits that side to the data. */
export function readGraphAxisBoundInput(input: HTMLInputElement): number | undefined {
  if (input.value.trim() === '') return undefined;
  const value = input.valueAsNumber;
  return Number.isFinite(value) ? value : undefined;
}

function readStoredBound(rawConfig: Record<string, unknown>, field: GraphAxisBoundField): number | null {
  const value = rawConfig[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function renderGraphAxisBoundControls(type: GraphType, rawConfig: Record<string, unknown>): string {
  const fields = GRAPH_AXIS_BOUND_FIELDS.map((field) => {
    const value = readStoredBound(rawConfig, field);
    return `<label class="hvy-graph-field" data-graph-control="${field}">
        <span class="hvy-graph-field-label">${graphAxisBoundLabel(type, field)}</span>
        <input type="number" step="any" data-graph-field="${field}" value="${value ?? ''}" placeholder="Auto">
      </label>`;
  }).join('');
  return `<div class="hvy-graph-axis-bound-controls"${graphTypeHasValueScale(type) ? '' : ' hidden'}>${fields}</div>`;
}

/**
 * Inputs mirror the stored pluginConfig rather than the normalized config, so a
 * temporarily inverted pair being typed is flagged instead of wiped.
 */
export function syncGraphAxisBoundControls(root: HTMLElement, type: GraphType, rawConfig: Record<string, unknown>): void {
  const group = root.querySelector<HTMLElement>('.hvy-graph-axis-bound-controls');
  if (!group) return;
  group.toggleAttribute('hidden', !graphTypeHasValueScale(type));
  const numericX = graphTypeHasNumericXAxis(type);
  group.dataset.graphNumericX = numericX ? 'true' : 'false';
  GRAPH_AXIS_BOUND_PAIRS.forEach(([minField, maxField]) => {
    const min = readStoredBound(rawConfig, minField);
    const max = readStoredBound(rawConfig, maxField);
    const inverted = min !== null && max !== null && min >= max;
    ([[minField, min], [maxField, max]] as const).forEach(([field, stored]) => {
      const control = group.querySelector<HTMLElement>(`[data-graph-control="${field}"]`);
      control?.toggleAttribute('hidden', !numericX && (field === 'xAxisMin' || field === 'xAxisMax'));
      const input = control?.querySelector<HTMLInputElement>('input');
      const label = control?.querySelector<HTMLElement>('.hvy-graph-field-label');
      const labelText = graphAxisBoundLabel(type, field);
      if (label && label.textContent !== labelText) label.textContent = labelText;
      if (!input) return;
      if (inverted) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
      if ((readGraphAxisBoundInput(input) ?? null) !== stored) {
        input.value = stored === null ? '' : String(stored);
      }
    });
  });
}
