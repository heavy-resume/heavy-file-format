import './model-3d.css';

import { downloadBlob } from '../../utils';
import { cubeIcon, downloadIcon, refreshIcon } from '../../icons';
import { createBuiltInPluginMetadata, MODEL_3D_PLUGIN_ID } from '../registry';
import type { HvyPlugin, HvyPluginContext, HvyPluginFactory, HvyPluginInstance } from '../types';
import model3dDocumentation from './about-model-3d.txt?raw';
import {
  DEFAULT_MODEL_3D_CONFIG,
  formatModel3dBytes,
  getModel3dAttachmentId,
  MODEL_3D_MAX_BYTES,
  MODEL_3D_MAX_HEIGHT,
  MODEL_3D_MIN_HEIGHT,
  readModel3dConfig,
  type Model3dConfig,
} from './model-3d-config';
import {
  findModel3dFormat,
  inferModel3dMediaType,
  listModel3dExtensions,
  sanitizeModel3dFilename,
} from './model-3d-formats';
import type { Model3dViewer } from './model-3d-scene';

interface Model3dRuntime {
  viewer: Model3dViewer | null;
  /** Identifies the loaded model so refresh() does not reparse needlessly. */
  loadedKey: string;
  /** Guards against an out-of-order async load overwriting a newer one. */
  loadToken: number;
  disposed: boolean;
}

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-model-3d hvy-model-3d-${ctx.mode}`;

  const stage = document.createElement('div');
  stage.className = 'hvy-model-3d-stage';
  const status = document.createElement('div');
  status.className = 'hvy-model-3d-status';
  const actions = document.createElement('div');
  actions.className = 'hvy-model-3d-actions';

  const runtime: Model3dRuntime = { viewer: null, loadedKey: '', loadToken: 0, disposed: false };
  const editor = ctx.mode === 'editor' ? buildEditorDom(ctx) : null;

  if (editor) root.appendChild(editor.root);
  root.append(stage, actions, status);

  const sync = () => {
    const config = readModel3dConfig(ctx.block.schema.pluginConfig);
    if (editor) editor.sync(config, ctx);
    stage.style.height = `${config.height}px`;
    renderActions(actions, config, ctx, runtime);
    void loadModel(stage, status, config, ctx, runtime);
  };

  sync();
  return {
    element: root,
    refresh: sync,
    unmount: () => {
      runtime.disposed = true;
      runtime.viewer?.dispose();
      runtime.viewer = null;
      editor?.unmount();
    },
  };
}

/**
 * Loads and renders the attached model. The three.js runtime is imported lazily
 * so documents without a 3D component never pay for the renderer.
 */
async function loadModel(
  stage: HTMLElement,
  status: HTMLElement,
  config: Model3dConfig,
  ctx: HvyPluginContext,
  runtime: Model3dRuntime
): Promise<void> {
  const viewerOptions = {
    autoRotate: config.autoRotate,
    showGrid: config.showGrid,
    wireframe: config.wireframe,
  };

  if (!config.modelFile) {
    teardown(runtime, stage);
    setStatus(status, 'empty', ctx.mode === 'editor'
      ? `Attach a 3D model. Supported: ${listModel3dExtensions().join(', ')}.`
      : 'No 3D model attached.');
    return;
  }

  const attachment = ctx.attachments.get(getModel3dAttachmentId(config.modelFile));
  if (!attachment) {
    teardown(runtime, stage);
    setStatus(status, 'error', `Missing 3D model attachment "${config.modelFile}".`);
    return;
  }

  const format = findModel3dFormat(config.modelFile);
  if (!format) {
    teardown(runtime, stage);
    setStatus(status, 'error', `Unsupported 3D format for "${config.modelFile}".`);
    return;
  }

  // Option-only changes must not reparse the file; that would drop the camera
  // position the reader has already set up.
  const loadedKey = `${config.modelFile}:${attachment.bytes.byteLength}`;
  if (runtime.viewer && runtime.loadedKey === loadedKey) {
    runtime.viewer.setOptions(viewerOptions);
    runtime.viewer.setAccessibleName(config.title.trim() || `${format.label} model: ${config.modelFile}`);
    runtime.viewer.syncTheme();
    return;
  }

  const token = ++runtime.loadToken;
  setStatus(status, 'loading', `Loading ${format.label} model…`);
  try {
    const { createModel3dViewer, parseModel3d } = await import('./model-3d-scene');
    if (runtime.disposed || token !== runtime.loadToken) return;
    const result = await parseModel3d(format, attachment.bytes, config.wireframe);
    if (runtime.disposed || token !== runtime.loadToken) return;

    if (!runtime.viewer) {
      runtime.viewer = createModel3dViewer(stage, viewerOptions);
    } else {
      runtime.viewer.setOptions(viewerOptions);
    }
    runtime.viewer.setModel(result);
    runtime.viewer.setAccessibleName(config.title.trim() || `${format.label} model: ${config.modelFile}`);
    runtime.loadedKey = loadedKey;
    setStatus(
      status,
      result.blockedResources.length > 0 ? 'warning' : 'ready',
      result.blockedResources.length > 0
        ? `Rendered without ${result.blockedResources.length} external resource${result.blockedResources.length === 1 ? '' : 's'} the model requested. Embedded models render fully.`
        : ''
    );
  } catch (error) {
    if (runtime.disposed || token !== runtime.loadToken) return;
    teardown(runtime, stage);
    setStatus(status, 'error', `Could not render this ${format.label} file. ${error instanceof Error ? error.message : ''}`.trim());
  }
}

function teardown(runtime: Model3dRuntime, stage: HTMLElement): void {
  runtime.viewer?.dispose();
  runtime.viewer = null;
  runtime.loadedKey = '';
  stage.replaceChildren();
}

function setStatus(status: HTMLElement, kind: string, message: string): void {
  status.dataset.kind = kind;
  status.textContent = message;
  status.hidden = message.length === 0;
}

function renderActions(
  actions: HTMLElement,
  config: Model3dConfig,
  ctx: HvyPluginContext,
  runtime: Model3dRuntime
): void {
  actions.replaceChildren();
  if (!config.modelFile) return;

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'ghost hvy-model-3d-action';
  reset.innerHTML = `${refreshIcon()}<span>Reset view</span>`;
  reset.addEventListener('click', () => runtime.viewer?.resetView());
  actions.appendChild(reset);

  if (!config.allowDownload) return;
  const attachment = ctx.attachments.get(getModel3dAttachmentId(config.modelFile));
  if (!attachment) return;

  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'ghost hvy-model-3d-action';
  download.innerHTML = `${downloadIcon()}<span>Download</span>`;
  download.title = `Download ${config.modelFile} (${formatModel3dBytes(attachment.bytes.byteLength)})`;
  download.addEventListener('click', () => {
    const bytes = ctx.attachments.get(getModel3dAttachmentId(config.modelFile))?.bytes;
    if (!bytes) return;
    downloadBlob(
      config.modelFile,
      new Blob([Uint8Array.from(bytes)], { type: config.mediaType || 'application/octet-stream' })
    );
  });
  actions.appendChild(download);
}

interface EditorDom {
  root: HTMLElement;
  sync(config: Model3dConfig, ctx: HvyPluginContext): void;
  unmount(): void;
}

function buildEditorDom(ctx: HvyPluginContext): EditorDom {
  const root = document.createElement('div');
  root.className = 'hvy-model-3d-editor';
  // The file input must not steal focus when the block is activated.
  root.setAttribute('data-editor-activation-autofocus', 'false');
  root.innerHTML = `
    <div class="hvy-model-3d-file-row">
      <label class="hvy-model-3d-picker">
        <input type="file" class="hvy-model-3d-file-input" accept="${listModel3dExtensions().join(',')}">
        <span class="hvy-model-3d-picker-button">${cubeIcon()}<span data-model3d-picker-label>Choose model</span></span>
      </label>
      <span class="hvy-model-3d-filename" data-model3d-filename></span>
    </div>
    <div class="hvy-model-3d-fields">
      <label class="hvy-model-3d-field">
        <span>Title</span>
        <input type="text" data-model3d-field="title" placeholder="Accessible name">
      </label>
      <label class="hvy-model-3d-field">
        <span>Height</span>
        <input type="number" data-model3d-field="height" min="${MODEL_3D_MIN_HEIGHT}" max="${MODEL_3D_MAX_HEIGHT}" step="20">
      </label>
    </div>
    <div class="hvy-model-3d-toggles">
      <button type="button" class="ghost hvy-model-3d-toggle" data-model3d-toggle="showGrid">Grid</button>
      <button type="button" class="ghost hvy-model-3d-toggle" data-model3d-toggle="autoRotate">Auto-rotate</button>
      <button type="button" class="ghost hvy-model-3d-toggle" data-model3d-toggle="wireframe">Wireframe</button>
      <button type="button" class="ghost hvy-model-3d-toggle" data-model3d-toggle="allowDownload">Download button</button>
    </div>
    <div class="hvy-model-3d-editor-error" data-model3d-error hidden></div>
  `;

  const fileInput = requireElement(root, '.hvy-model-3d-file-input', HTMLInputElement);
  const pickerLabel = requireElement(root, '[data-model3d-picker-label]', HTMLSpanElement);
  const filename = requireElement(root, '[data-model3d-filename]', HTMLSpanElement);
  const errorBox = requireElement(root, '[data-model3d-error]', HTMLDivElement);

  const showError = (message: string) => {
    errorBox.textContent = message;
    errorBox.hidden = message.length === 0;
  };

  const onFileChange = () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void attachModelFile(ctx, file)
      .then(() => showError(''))
      .catch((error) => showError(error instanceof Error ? error.message : 'Could not attach model.'))
      .finally(() => {
        fileInput.value = '';
      });
  };

  const onInput = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.model3dField === 'title') {
      ctx.setConfig({ title: target.value });
    } else if (target.dataset.model3dField === 'height') {
      const parsed = Number.parseInt(target.value, 10);
      if (Number.isFinite(parsed)) ctx.setConfig({ height: parsed });
    }
  };

  const onClick = (event: Event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-model3d-toggle]');
    if (!button) return;
    const key = button.dataset.model3dToggle as keyof Model3dConfig | undefined;
    if (!key) return;
    const config = readModel3dConfig(ctx.block.schema.pluginConfig);
    ctx.setConfig({ [key]: !config[key] });
  };

  fileInput.addEventListener('change', onFileChange);
  root.addEventListener('input', onInput);
  root.addEventListener('click', onClick);

  return {
    root,
    sync(config) {
      const active = document.activeElement;
      setValueIfNotFocused(requireElement(root, '[data-model3d-field="title"]', HTMLInputElement), config.title, active);
      setValueIfNotFocused(requireElement(root, '[data-model3d-field="height"]', HTMLInputElement), String(config.height), active);
      pickerLabel.textContent = config.modelFile ? 'Replace model' : 'Choose model';
      filename.textContent = config.modelFile;
      for (const button of root.querySelectorAll<HTMLButtonElement>('[data-model3d-toggle]')) {
        const key = button.dataset.model3dToggle as keyof Model3dConfig | undefined;
        const on = Boolean(key && config[key]);
        button.classList.toggle('is-active', on);
        button.setAttribute('aria-pressed', String(on));
      }
    },
    unmount() {
      fileInput.removeEventListener('change', onFileChange);
      root.removeEventListener('input', onInput);
      root.removeEventListener('click', onClick);
    },
  };
}

async function attachModelFile(ctx: HvyPluginContext, file: File): Promise<void> {
  if (file.size > MODEL_3D_MAX_BYTES) {
    throw new Error(`Model must be ${formatModel3dBytes(MODEL_3D_MAX_BYTES)} or smaller.`);
  }
  const requested = sanitizeModel3dFilename(file.name || 'model');
  const format = findModel3dFormat(requested);
  if (!format) {
    throw new Error(`Unsupported 3D format. Supported: ${listModel3dExtensions().join(', ')}.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const modelFile = uniqueModelFilename(ctx, requested);
  const mediaType = inferModel3dMediaType(modelFile);
  ctx.attachments.set(getModel3dAttachmentId(modelFile), { mediaType, plugin: MODEL_3D_PLUGIN_ID }, bytes);

  // Drop the previous attachment so replacing a model does not leave orphaned
  // bytes in the tail.
  const previous = readModel3dConfig(ctx.block.schema.pluginConfig).modelFile;
  if (previous && previous !== modelFile) {
    ctx.attachments.remove(getModel3dAttachmentId(previous));
  }
  ctx.setConfig({ modelFile, mediaType });
}

function uniqueModelFilename(ctx: HvyPluginContext, requested: string): string {
  const current = readModel3dConfig(ctx.block.schema.pluginConfig).modelFile;
  const ids = new Set(ctx.attachments.list().map((attachment) => attachment.id));
  // Re-uploading the same name into the same block is a replacement, not a
  // collision, so the current file never forces a suffix.
  ids.delete(getModel3dAttachmentId(current));
  const dot = requested.lastIndexOf('.');
  const stem = dot > 0 ? requested.slice(0, dot) : requested;
  const extension = dot > 0 ? requested.slice(dot) : '';
  let candidate = requested;
  let suffix = 2;
  while (ids.has(getModel3dAttachmentId(candidate))) {
    candidate = `${stem}-${suffix}${extension}`;
    suffix += 1;
  }
  return candidate;
}

function setValueIfNotFocused(input: HTMLInputElement, value: string, active: Element | null): void {
  if (input !== active && input.value !== value) input.value = value;
}

function requireElement<T extends Element>(
  root: ParentNode,
  selector: string,
  constructor: { new(...args: never[]): T }
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof constructor)) {
    throw new Error(`Missing 3D model plugin element "${selector}".`);
  }
  return element;
}

export const model3dPluginFactory: HvyPluginFactory = build;

export const model3dPlugin: HvyPlugin = {
  ...createBuiltInPluginMetadata(MODEL_3D_PLUGIN_ID),
  displayName: '3D Model',
  documentation: {
    filename: 'about-model-3d.txt',
    text: model3dDocumentation,
  },
  aiHint: '3D model plugin. Renders a 3D model stored as an HVY tail attachment with id model-3d:<modelFile>. pluginConfig.modelFile names the attached file; the model bytes cannot be authored as text.',
  aiHelp: [
    `Use \`<!--hvy:plugin {"plugin":"${MODEL_3D_PLUGIN_ID}","pluginConfig":${JSON.stringify(DEFAULT_MODEL_3D_CONFIG)}}-->\`.`,
    `Supported extensions: ${listModel3dExtensions().join(', ')}.`,
    'Model bytes must already exist as a tail attachment; set pluginConfig.modelFile to that attachment filename. Do not invent attachment bytes.',
    'pluginConfig also supports title, height, showGrid, autoRotate, wireframe, and allowDownload.',
  ].join(' '),
  create: model3dPluginFactory,
};

export { getModel3dAttachmentId, readModel3dConfig };
