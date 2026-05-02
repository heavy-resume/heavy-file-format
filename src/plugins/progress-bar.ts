import type {
  HvyPluginContext,
  HvyPluginFactory,
  HvyPluginInstance,
  HvyPluginRegistration,
} from './types';
import { PROGRESS_BAR_PLUGIN_ID } from './registry';
import { colorValueToPickerHex, getResolvedThemeColor } from '../theme';

import './progress-bar.css';

interface ProgressBarConfig {
  min: number;
  max: number;
  value: number;
  color: string;
}

const DEFAULT_CONFIG: ProgressBarConfig = {
  min: 0,
  max: 100,
  value: 0,
  color: '#4a8fab',
};

function getDefaultProgressBarColor(): string {
  const accent = getResolvedThemeColor('--hvy-accent-1');
  return accent.trim().length > 0 ? colorValueToPickerHex(accent) : DEFAULT_CONFIG.color;
}

function readConfig(raw: Record<string, unknown>): ProgressBarConfig {
  const min = Number.isFinite(Number(raw.min)) ? Number(raw.min) : DEFAULT_CONFIG.min;
  const max = Number.isFinite(Number(raw.max)) ? Number(raw.max) : DEFAULT_CONFIG.max;
  const value = Number.isFinite(Number(raw.value)) ? Number(raw.value) : DEFAULT_CONFIG.value;
  const color = typeof raw.color === 'string' && raw.color.length > 0 ? raw.color : getDefaultProgressBarColor();
  return { min, max, value, color };
}

function clampPercent(config: ProgressBarConfig): number {
  const span = config.max - config.min;
  if (!Number.isFinite(span) || span <= 0) {
    return 0;
  }
  const ratio = (config.value - config.min) / span;
  return Math.max(0, Math.min(100, ratio * 100));
}

// Evaluate a JS template-literal (without the surrounding backticks) against a
// fixed scope. Identifiers not in `scope` resolve to undefined via a Proxy +
// `with`. Not a real sandbox; see plan doc for the worker/Brython upgrade
// path.
function evaluateLabelFormatter(template: string, scope: Record<string, unknown>): string {
  if (template.trim().length === 0) {
    return '';
  }
  const escaped = template.replaceAll('`', '\\`');
  const proxy = new Proxy(scope, {
    has: () => true,
    get: (target, key) => (key in target ? target[key as string] : undefined),
  });
  try {
    const fn = new Function('__scope__', `with (__scope__) { return \`${escaped}\`; }`);
    const result = fn(proxy);
    return typeof result === 'string' ? result : String(result ?? '');
  } catch (error) {
    return error instanceof Error ? `[label error: ${error.message}]` : '[label error]';
  }
}

interface ReaderHandles {
  fill: HTMLDivElement;
  label: HTMLDivElement;
}

interface EditorHandles {
  inputs: Record<'min' | 'max' | 'value' | 'color' | 'formatter', HTMLInputElement>;
  preview: ReaderHandles;
}

function buildReaderDom(): { root: HTMLDivElement; handles: ReaderHandles } {
  const root = document.createElement('div');
  root.className = 'hvy-progress-bar-track';
  const fill = document.createElement('div');
  fill.className = 'hvy-progress-bar-fill';
  const label = document.createElement('div');
  label.className = 'hvy-progress-bar-label';
  root.appendChild(fill);
  root.appendChild(label);
  return { root, handles: { fill, label } };
}

function applyPreview(handles: ReaderHandles, config: ProgressBarConfig, label: string): void {
  const percent = clampPercent(config);
  handles.fill.style.width = `${percent.toFixed(2)}%`;
  handles.fill.style.background = config.color;
  handles.label.textContent = label;
  handles.label.style.display = label.length > 0 ? '' : 'none';
}

function buildEditorDom(): { root: HTMLDivElement; handles: EditorHandles } {
  const root = document.createElement('div');
  root.className = 'hvy-progress-bar-editor';

  const controls = document.createElement('div');
  controls.className = 'hvy-progress-bar-controls';

  const makeNumberInput = (field: 'min' | 'max' | 'value', label: string): HTMLInputElement => {
    const wrap = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.dataset.pbField = field;
    wrap.appendChild(span);
    wrap.appendChild(input);
    controls.appendChild(wrap);
    return input;
  };

  const minInput = makeNumberInput('min', 'Min');
  const maxInput = makeNumberInput('max', 'Max');
  const valueInput = makeNumberInput('value', 'Value');

  const colorWrap = document.createElement('label');
  const colorSpan = document.createElement('span');
  colorSpan.textContent = 'Color';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.dataset.pbField = 'color';
  colorWrap.appendChild(colorSpan);
  colorWrap.appendChild(colorInput);
  controls.appendChild(colorWrap);

  const formatterWrap = document.createElement('label');
  formatterWrap.className = 'hvy-progress-bar-formatter';
  const formatterSpan = document.createElement('span');
  formatterSpan.innerHTML =
    'Label (template literal: <code>${value}</code>, <code>${min}</code>, <code>${max}</code>, <code>${percent}</code>)';
  const formatterInput = document.createElement('input');
  formatterInput.type = 'text';
  formatterInput.dataset.pbField = 'formatter';
  formatterInput.placeholder = '${value}%';
  formatterWrap.appendChild(formatterSpan);
  formatterWrap.appendChild(formatterInput);

  const previewFrame = document.createElement('div');
  previewFrame.className = 'hvy-progress-bar-preview-frame';
  const { root: previewRoot, handles: previewHandles } = buildReaderDom();
  previewFrame.appendChild(previewRoot);

  root.appendChild(controls);
  root.appendChild(formatterWrap);
  root.appendChild(previewFrame);

  return {
    root,
    handles: {
      inputs: {
        min: minInput,
        max: maxInput,
        value: valueInput,
        color: colorInput,
        formatter: formatterInput,
      },
      preview: previewHandles,
    },
  };
}

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-progress-bar hvy-progress-bar-${ctx.mode}`;

  let editorHandles: EditorHandles | null = null;
  let readerHandles: ReaderHandles | null = null;

  if (ctx.mode === 'reader') {
    const built = buildReaderDom();
    readerHandles = built.handles;
    root.appendChild(built.root);
  } else {
    const built = buildEditorDom();
    editorHandles = built.handles;
    root.appendChild(built.root);
  }

  // Apply current state to inputs (skipping any input the user is editing)
  // and always update the preview bar.
  const sync = () => {
    const config = readConfig(ctx.block.schema.pluginConfig);
    const formatter = ctx.block.text;
    const percent = clampPercent(config);
    const label = evaluateLabelFormatter(formatter, {
      min: config.min,
      max: config.max,
      value: config.value,
      percent: Number(percent.toFixed(2)),
    });

    if (readerHandles) {
      applyPreview(readerHandles, config, label);
      return;
    }
    if (!editorHandles) return;

    const active = document.activeElement;
    const setIfNotFocused = (input: HTMLInputElement, next: string) => {
      if (input !== active && input.value !== next) {
        input.value = next;
      }
    };
    setIfNotFocused(editorHandles.inputs.min, String(config.min));
    setIfNotFocused(editorHandles.inputs.max, String(config.max));
    setIfNotFocused(editorHandles.inputs.value, String(config.value));
    setIfNotFocused(editorHandles.inputs.color, config.color);
    setIfNotFocused(editorHandles.inputs.formatter, formatter);
    applyPreview(editorHandles.preview, config, label);
  };

  const onInput = (event: Event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    const field = target.dataset.pbField;
    if (!field) return;

    if (field === 'formatter') {
      ctx.setText(target.value);
      return;
    }
    if (field === 'color') {
      // Color picker fires `input` continuously while the user drags inside
      // the picker dialog. Committing each one would re-render the app and
      // close the picker. Update only the live preview here; commit on
      // `change` (when the dialog closes).
      if (editorHandles) {
        const config = readConfig({ ...ctx.block.schema.pluginConfig, color: target.value });
        const formatter = ctx.block.text;
        const percent = clampPercent(config);
        const label = evaluateLabelFormatter(formatter, {
          min: config.min,
          max: config.max,
          value: config.value,
          percent: Number(percent.toFixed(2)),
        });
        applyPreview(editorHandles.preview, config, label);
      }
      return;
    }
    const numeric = Number(target.value);
    if (!Number.isFinite(numeric)) return;
    ctx.setConfig({ [field]: numeric });
  };

  const onChange = (event: Event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    if (target.dataset.pbField !== 'color') return;
    ctx.setConfig({ color: target.value });
  };

  if (ctx.mode === 'editor') {
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
  }

  sync();

  return {
    element: root,
    refresh: sync,
    unmount: () => {
      if (ctx.mode === 'editor') {
        root.removeEventListener('input', onInput);
        root.removeEventListener('change', onChange);
      }
    },
  };
}

export const progressBarPluginFactory: HvyPluginFactory = build;

export const progressBarPluginRegistration: HvyPluginRegistration = {
  id: PROGRESS_BAR_PLUGIN_ID,
  displayName: 'Progress Bar',
  aiHint: 'Functional progress meter; numeric value/min/max live in pluginConfig.',
  aiHelp: [
    `Use \`<!--hvy:plugin {"plugin":"${PROGRESS_BAR_PLUGIN_ID}","pluginConfig":{"value":50,"min":0,"max":100}}-->\`.`,
    'Set numeric `pluginConfig.value`, optional `min`, `max`, and visual options in `pluginConfig`.',
    'The component body may contain display text or a value template.',
  ].join(' '),
  create: progressBarPluginFactory,
};
