import QRCodeStyling from 'qr-code-styling';

import './qr-code.css';

import { getMatchingImagePresetCss, mergeImagePresetCss } from '../../editor/components/image/image-preset-css';
import type { VisualBlock } from '../../editor/types';
import { escapeHtml } from '../../utils';
import { QR_CODE_PLUGIN_ID } from '../registry';
import type { HvyPlugin, HvyPluginContext, HvyPluginFactory, HvyPluginInstance, HvyPluginPdfStaticRenderContext } from '../types';
import qrCodeDocumentation from './about-qr-code.txt?raw';
import {
  createQrCodePluginConfig,
  createQrCodeStaticImageFilename,
  createQrCodeStylingOptions,
  DEFAULT_QR_CODE_CONFIG,
  QR_CODE_CORNER_DOT_TYPES,
  QR_CODE_CORNER_SQUARE_TYPES,
  QR_CODE_DOT_TYPES,
  QR_CODE_MANUAL_ERROR_CORRECTION_LEVELS,
  QR_CODE_PLUGIN_DEFAULT_TEXT,
  readQrCodeConfig,
  type QrCodeConfig,
  type QrCodeManualErrorCorrectionLevel,
} from './qr-code-model';

interface EditorHandles {
  text: HTMLTextAreaElement;
  caption: HTMLTextAreaElement;
  foregroundColor: HTMLInputElement;
  backgroundColor: HTMLInputElement;
  dotsType: HTMLSelectElement;
  cornersSquareType: HTMLSelectElement;
  cornersDotType: HTMLSelectElement;
  preview: HTMLDivElement;
  sizePresetButtons: HTMLButtonElement[];
}

const QR_CODE_SIZE_PRESETS = ['small', 'medium', 'large', 'fit-width', 'fit-height'] as const;

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-qr-code hvy-qr-code-${ctx.mode}`;
  let editorHandles: EditorHandles | null = null;
  let previewHost: HTMLElement | null = null;
  let renderVersion = 0;

  if (ctx.mode === 'editor') {
    const built = buildEditorDom(ctx);
    editorHandles = built.handles;
    previewHost = built.handles.preview;
    root.appendChild(built.root);
  } else {
    previewHost = document.createElement('div');
    previewHost.className = 'hvy-qr-code-reader';
    root.appendChild(previewHost);
  }

  const sync = () => {
    const config = readQrCodeConfig(ctx.block.schema.pluginConfig);
    const text = ctx.block.text;
    if (editorHandles) {
      syncEditorInputs(editorHandles, text, config, ctx.block.schema.css);
    }
    void renderQrCodePreview(previewHost, text, config, ++renderVersion);
  };

  const onInput = (event: Event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
    if (!target) return;
    const field = target.dataset.qrField;
    if (!field) return;
    if (field === 'text') {
      ctx.setText(target.value);
      return;
    }
    ctx.setConfig({ [field]: target.value });
  };

  const onClick = (event: Event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLButtonElement>('[data-qr-preset]');
    if (!button) return;
    const preset = button.dataset.qrPreset ?? '';
    const merged = mergeImagePresetCss(ctx.block.schema.css, preset);
    if (merged === null) return;
    ctx.setCss(merged);
  };

  if (ctx.mode === 'editor') {
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);
    root.addEventListener('click', onClick);
  }

  sync();

  return {
    element: root,
    refresh: sync,
    unmount: () => {
      renderVersion += 1;
      if (ctx.mode === 'editor') {
        root.removeEventListener('input', onInput);
        root.removeEventListener('change', onInput);
        root.removeEventListener('click', onClick);
      }
    },
  };
}

function buildEditorDom(ctx: HvyPluginContext): { root: HTMLDivElement; handles: EditorHandles } {
  const root = document.createElement('div');
  root.className = 'hvy-qr-code-editor';
  root.setAttribute('data-editor-activation-autofocus', 'false');
  root.innerHTML = `
    <div class="hvy-qr-code-toolbar">
      <div class="toolbar-segment" role="group" aria-label="QR alignment">
        ${renderPresetButton('left', 'Left')}
        ${renderPresetButton('center', 'Center')}
        ${renderPresetButton('right', 'Right')}
      </div>
      <div class="toolbar-segment" role="group" aria-label="QR size">
        ${renderPresetButton('small', 'Small')}
        ${renderPresetButton('medium', 'Medium')}
        ${renderPresetButton('large', 'Large')}
        ${renderPresetButton('fit-width', 'Fit Width')}
        ${renderPresetButton('fit-height', 'Fit Height')}
      </div>
    </div>
    <div class="hvy-qr-code-editor-grid">
      <div class="hvy-qr-code-fields">
        <label class="hvy-qr-code-field">
          <span>QR text</span>
          <textarea rows="5" data-qr-field="text" spellcheck="false"></textarea>
        </label>
        <label class="hvy-qr-code-field">
          <span>Caption</span>
          <textarea rows="2" data-qr-field="caption"></textarea>
        </label>
        <div class="hvy-qr-code-style-grid">
          ${renderColorField('foregroundColor', 'Foreground')}
          ${renderColorField('backgroundColor', 'Background')}
          ${renderSelectField('dotsType', 'Dots', QR_CODE_DOT_TYPES)}
          ${renderSelectField('cornersSquareType', 'Corner frames', QR_CODE_CORNER_SQUARE_TYPES)}
          ${renderSelectField('cornersDotType', 'Corner dots', QR_CODE_CORNER_DOT_TYPES)}
        </div>
      </div>
      <div class="hvy-qr-code-preview-panel">
        <div class="hvy-qr-code-preview"></div>
      </div>
    </div>
  `;
  const handles = {
    text: requireElement(root, '[data-qr-field="text"]', HTMLTextAreaElement),
    caption: requireElement(root, '[data-qr-field="caption"]', HTMLTextAreaElement),
    foregroundColor: requireElement(root, '[data-qr-field="foregroundColor"]', HTMLInputElement),
    backgroundColor: requireElement(root, '[data-qr-field="backgroundColor"]', HTMLInputElement),
    dotsType: requireElement(root, '[data-qr-field="dotsType"]', HTMLSelectElement),
    cornersSquareType: requireElement(root, '[data-qr-field="cornersSquareType"]', HTMLSelectElement),
    cornersDotType: requireElement(root, '[data-qr-field="cornersDotType"]', HTMLSelectElement),
    preview: requireElement(root, '.hvy-qr-code-preview', HTMLDivElement),
    sizePresetButtons: Array.from(root.querySelectorAll<HTMLButtonElement>('[data-qr-size-preset]')),
  };
  syncEditorInputs(handles, ctx.block.text, readQrCodeConfig(ctx.block.schema.pluginConfig), ctx.block.schema.css);
  return { root, handles };
}

function renderPresetButton(preset: string, label: string): string {
  const sizePresetAttr = QR_CODE_SIZE_PRESETS.includes(preset as typeof QR_CODE_SIZE_PRESETS[number]) ? ' data-qr-size-preset="true" aria-pressed="false"' : '';
  return `<button type="button" class="ghost" data-qr-preset="${preset}"${sizePresetAttr}>${label}</button>`;
}

function renderColorField(field: keyof QrCodeConfig, label: string): string {
  return `<label class="hvy-qr-code-field">
    <span>${label}</span>
    <input type="color" data-qr-field="${field}">
  </label>`;
}

function renderSelectField(field: keyof QrCodeConfig, label: string, options: readonly string[]): string {
  return `<label class="hvy-qr-code-field">
    <span>${label}</span>
    <select data-qr-field="${field}">
      ${options.map((option) => `<option value="${option}">${formatOptionLabel(option)}</option>`).join('')}
    </select>
  </label>`;
}

function syncEditorInputs(handles: EditorHandles, text: string, config: QrCodeConfig, css: string): void {
  const active = document.activeElement;
  setValueIfNotFocused(handles.text, text, active);
  setValueIfNotFocused(handles.caption, config.caption, active);
  setValueIfNotFocused(handles.foregroundColor, config.foregroundColor, active);
  setValueIfNotFocused(handles.backgroundColor, config.backgroundColor, active);
  setValueIfNotFocused(handles.dotsType, config.dotsType, active);
  setValueIfNotFocused(handles.cornersSquareType, config.cornersSquareType, active);
  setValueIfNotFocused(handles.cornersDotType, config.cornersDotType, active);
  syncSizePresetButtons(handles.sizePresetButtons, css);
}

function setValueIfNotFocused(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string, active: Element | null): void {
  if (input !== active && input.value !== value) {
    input.value = value;
  }
}

function syncSizePresetButtons(buttons: HTMLButtonElement[], css: string): void {
  const activePreset = getMatchingImagePresetCss(css, QR_CODE_SIZE_PRESETS);
  for (const button of buttons) {
    const active = button.dataset.qrPreset === activePreset;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

async function renderQrCodePreview(host: HTMLElement | null, text: string, config: QrCodeConfig, version: number): Promise<void> {
  if (!host) return;
  const trimmed = text.trim();
  if (!trimmed) {
    host.innerHTML = '<div class="hvy-qr-code-empty">Add QR text to generate a code.</div>';
    return;
  }
  host.innerHTML = '<div class="hvy-qr-code-loading">Rendering QR code...</div>';
  try {
    const { qr } = createQrCodeStylingForPayload(trimmed, config);
    host.replaceChildren();
    const figure = document.createElement('figure');
    figure.className = 'hvy-qr-code-figure';
    const imageWrap = document.createElement('div');
    qr.append(imageWrap);
    figure.appendChild(imageWrap);
    if (config.caption.trim()) {
      const caption = document.createElement('figcaption');
      caption.className = 'image-caption';
      caption.textContent = config.caption;
      figure.appendChild(caption);
    }
    if (version > 0) {
      host.replaceChildren(figure);
    }
  } catch (error) {
    host.innerHTML = `<div class="hvy-qr-code-error">${escapeHtml(formatQrError(error))}</div>`;
  }
}

function formatQrError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return 'Unable to render QR code.';
}

function requireElement<T extends Element>(
  root: ParentNode,
  selector: string,
  constructor: { new(...args: never[]): T }
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof constructor)) {
    throw new Error(`Missing QR code editor element "${selector}".`);
  }
  return element;
}

function formatOptionLabel(value: string): string {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export async function renderQrCodeStaticBlock(ctx: HvyPluginPdfStaticRenderContext): Promise<VisualBlock> {
  const config = readQrCodeConfig(ctx.block.schema.pluginConfig);
  const text = ctx.block.text.trim();
  if (!text) {
    throw new Error('QR code plugin cannot be exported without QR text.');
  }
  const svgBytes = await renderQrCodeSvgBytes(text, config, 0);
  const sourceId = ctx.block.schema.id || ctx.block.id || 'qr-code';
  const imageFile = createQrCodeStaticImageFilename(sourceId);
  ctx.attachments.set(`image:${imageFile}`, { mediaType: 'image/svg+xml' }, svgBytes);

  const block: VisualBlock = {
    id: `${ctx.block.id}-static`,
    text: '',
    schema: createStaticImageSchema(`${sourceId}-static`, imageFile, config.caption, ctx.block.schema.css),
    schemaMode: false,
  };
  return block;
}

function createStaticImageSchema(id: string, imageFile: string, caption: string, css: string): VisualBlock['schema'] {
  return {
    kind: 'image',
    id,
    component: 'image',
    editorOnly: false,
    lock: false,
    align: 'left',
    slot: 'center',
    css,
    sortKeys: {},
    groupKeys: {},
    tags: '',
    description: '',
    hideIfYes: '',
    visibleScript: '',
    placeholder: '',
    fillIn: false,
    showCopy: false,
    metaOpen: false,
    xrefTitle: '',
    xrefDetail: '',
    imageFile,
    imageAlt: 'Generated QR code',
    caption,
  } as unknown as VisualBlock['schema'];
}

export async function renderQrCodeSvgBytes(text: string, config: QrCodeConfig, margin = 24): Promise<Uint8Array> {
  const { qr } = createQrCodeStylingForPayload(text, config, margin);
  const data = await qr.getRawData('svg');
  if (!data) {
    throw new Error('QR code renderer did not return SVG data.');
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  if (typeof (data as { arrayBuffer?: unknown }).arrayBuffer === 'function') {
    return new Uint8Array(await (data as Blob).arrayBuffer());
  }
  return new TextEncoder().encode(String(data));
}

function createQrCodeStylingForPayload(text: string, config: QrCodeConfig, margin = 24): { qr: QRCodeStyling; errorCorrectionLevel: QrCodeManualErrorCorrectionLevel } {
  let lastError: unknown = null;
  for (const errorCorrectionLevel of [...QR_CODE_MANUAL_ERROR_CORRECTION_LEVELS].reverse()) {
    try {
      return {
        qr: new QRCodeStyling(createQrCodeStylingOptions(text, config, 640, errorCorrectionLevel, margin)),
        errorCorrectionLevel,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('Unable to render QR code with any error correction level.');
}

export const qrCodePluginFactory: HvyPluginFactory = build;

export const qrCodePlugin: HvyPlugin = {
  id: QR_CODE_PLUGIN_ID,
  displayName: 'QR Code',
  documentation: {
    filename: 'about-qr-code.txt',
    text: qrCodeDocumentation,
  },
  aiHint: 'QR code plugin. Encoded QR text lives in plugin.txt; caption and visual style live in pluginConfig; size/alignment live in block css.',
  aiHelp: [
    `Use \`<!--hvy:plugin {"plugin":"${QR_CODE_PLUGIN_ID}","pluginConfig":${JSON.stringify(createQrCodePluginConfig(DEFAULT_QR_CODE_CONFIG))}}-->\`.`,
    'Store the QR payload text in the plugin body.',
    'Use pluginConfig.caption for the visible caption and pluginConfig style fields for QR appearance.',
  ].join(' '),
  create: qrCodePluginFactory,
  pdf: {
    renderStatic: renderQrCodeStaticBlock,
  },
};

/** @deprecated Use qrCodePlugin. */
export const qrCodePluginRegistration = qrCodePlugin;

export { QR_CODE_PLUGIN_DEFAULT_TEXT, readQrCodeConfig };
