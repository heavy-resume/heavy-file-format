import type {
  HvyPluginContext,
  HvyPluginFactory,
  HvyPluginInstance,
  HvyPluginRegistration,
} from './types';
import { PROGRESS_BAR_PLUGIN_ID } from './registry';

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
  color: '#3b82f6',
};

function readConfig(raw: Record<string, unknown>): ProgressBarConfig {
  const min = Number.isFinite(Number(raw.min)) ? Number(raw.min) : DEFAULT_CONFIG.min;
  const max = Number.isFinite(Number(raw.max)) ? Number(raw.max) : DEFAULT_CONFIG.max;
  const value = Number.isFinite(Number(raw.value)) ? Number(raw.value) : DEFAULT_CONFIG.value;
  const color = typeof raw.color === 'string' && raw.color.length > 0 ? raw.color : DEFAULT_CONFIG.color;
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
// `with`. This is NOT a real sandbox — `globalThis` and constructor-chain
// tricks can still escape — but it blocks casual reach for `window`/`document`
// when the document author writes a label formatter in good faith. A future
// pass can swap this for a worker-based sandbox; the call signature stays the
// same.
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function renderBar(config: ProgressBarConfig, label: string): string {
  const percent = clampPercent(config);
  const barColor = escapeAttr(config.color);
  return (
    `<div class="hvy-progress-bar-track">` +
    `<div class="hvy-progress-bar-fill" style="width:${percent.toFixed(2)}%;background:${barColor};"></div>` +
    (label.length > 0 ? `<div class="hvy-progress-bar-label">${escapeHtml(label)}</div>` : '') +
    `</div>`
  );
}

function renderEditorMarkup(config: ProgressBarConfig, formatter: string, label: string): string {
  return (
    `<div class="hvy-progress-bar-editor">` +
    `<div class="hvy-progress-bar-controls">` +
    `<label><span>Min</span><input data-pb-field="min" type="number" value="${escapeAttr(String(config.min))}" /></label>` +
    `<label><span>Max</span><input data-pb-field="max" type="number" value="${escapeAttr(String(config.max))}" /></label>` +
    `<label><span>Value</span><input data-pb-field="value" type="number" value="${escapeAttr(String(config.value))}" /></label>` +
    `<label><span>Color</span><input data-pb-field="color" type="color" value="${escapeAttr(config.color)}" /></label>` +
    `</div>` +
    `<label class="hvy-progress-bar-formatter"><span>Label (template literal: <code>\${value}</code>, <code>\${min}</code>, <code>\${max}</code>, <code>\${percent}</code>)</span>` +
    `<input data-pb-field="formatter" type="text" value="${escapeAttr(formatter)}" placeholder="\${value}%" /></label>` +
    `<div class="hvy-progress-bar-preview-frame">` +
    renderBar(config, label) +
    `</div>` +
    `</div>`
  );
}

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-progress-bar hvy-progress-bar-${ctx.mode}`;

  const refresh = () => {
    const block = ctx.block;
    const config = readConfig(block.schema.pluginConfig);
    const formatter = block.text;
    const percent = clampPercent(config);
    const label = evaluateLabelFormatter(formatter, {
      min: config.min,
      max: config.max,
      value: config.value,
      percent: Number(percent.toFixed(2)),
    });

    if (ctx.mode === 'reader') {
      root.innerHTML = renderBar(config, label);
      return;
    }
    root.innerHTML = renderEditorMarkup(config, formatter, label);
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
      ctx.setConfig({ color: target.value });
      return;
    }
    const numeric = Number(target.value);
    if (!Number.isFinite(numeric)) return;
    ctx.setConfig({ [field]: numeric });
  };

  if (ctx.mode === 'editor') {
    root.addEventListener('input', onInput);
  }

  refresh();

  return {
    element: root,
    refresh: () => {
      // Don't blow away the DOM while the user is editing one of the inputs;
      // the local input handler already updated state, and the new render
      // would reset cursor position.
      const active = document.activeElement;
      if (active instanceof HTMLElement && root.contains(active) && active.tagName === 'INPUT') {
        return;
      }
      refresh();
    },
    unmount: () => {
      if (ctx.mode === 'editor') {
        root.removeEventListener('input', onInput);
      }
    },
  };
}

export const progressBarPluginFactory: HvyPluginFactory = build;

export const progressBarPluginRegistration: HvyPluginRegistration = {
  id: PROGRESS_BAR_PLUGIN_ID,
  displayName: 'Progress Bar',
  create: progressBarPluginFactory,
};
