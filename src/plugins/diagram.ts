import DOMPurify from 'dompurify';

import './diagram.css';

import { DEFAULT_DIAGRAM_SYNTAX } from './diagram-defaults';
import { DIAGRAM_PLUGIN_ID } from './registry';
import type { HvyPlugin, HvyPluginContext, HvyPluginFactory, HvyPluginInstance } from './types';
import diagramDocumentation from './diagram.about.txt?raw';

export interface DiagramConfig {
  syntax: 'mermaid';
}

type MermaidApi = typeof import('mermaid').default;

export { DEFAULT_DIAGRAM_SOURCE } from './diagram-defaults';

export const DEFAULT_DIAGRAM_CONFIG: DiagramConfig = {
  syntax: DEFAULT_DIAGRAM_SYNTAX,
};

let mermaidModulePromise: Promise<MermaidApi> | null = null;
let diagramRenderCounter = 0;

function loadMermaidModule(): Promise<MermaidApi> {
  mermaidModulePromise ??= import('mermaid').then((module) => module.default);
  return mermaidModulePromise;
}

export function readDiagramConfig(raw: Record<string, unknown> | null | undefined): DiagramConfig {
  const syntax = raw?.syntax === 'mermaid' ? 'mermaid' : DEFAULT_DIAGRAM_CONFIG.syntax;
  return { syntax };
}

export function createDiagramRenderId(): string {
  diagramRenderCounter += 1;
  return `hvy-diagram-${diagramRenderCounter}`;
}

function readDiagramSource(ctx: HvyPluginContext): string {
  return ctx.block.text;
}

function configureMermaid(mermaid: MermaidApi, root: HTMLElement): void {
  const computed = getComputedStyle(root);
  const read = (name: string, fallback: string) => computed.getPropertyValue(name).trim() || fallback;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: {
      background: read('--hvy-surface', '#ffffff'),
      mainBkg: read('--hvy-surface', '#ffffff'),
      primaryColor: read('--hvy-surface-alt', '#f5f7fa'),
      primaryTextColor: read('--hvy-text', '#1a2530'),
      primaryBorderColor: read('--hvy-border', '#d7dde5'),
      lineColor: read('--hvy-text-alt', '#667085'),
      secondaryColor: read('--hvy-bg-alt', '#eef2f6'),
      tertiaryColor: read('--hvy-surface', '#ffffff'),
      fontFamily: computed.fontFamily,
    },
  });
}

function sanitizeSvg(svg: string): string {
  return typeof DOMPurify.sanitize === 'function'
    ? DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
    : svg;
}

function renderFrame(svg: string): string {
  return `<div class="hvy-diagram-frame">${svg}</div>`;
}

function renderLoading(): string {
  return '<div class="hvy-diagram-loading">Rendering diagram...</div>';
}

function renderEmpty(): string {
  return '<div class="hvy-diagram-empty">Add Mermaid text to render a diagram.</div>';
}

function renderError(message: string): string {
  return `<div class="hvy-diagram-error">${escapeHtml(message)}</div>`;
}

function getRenderHost(ctx: HvyPluginContext, root: HTMLElement): HTMLElement {
  if (ctx.mode === 'reader') {
    return root;
  }
  return root.querySelector<HTMLElement>('[data-diagram-preview="true"]') ?? root;
}

function syncEditorShell(root: HTMLElement, source: string): void {
  if (!root.querySelector('.hvy-diagram-editor')) {
    root.innerHTML = renderEditorShell(source);
  }
  const textarea = root.querySelector<HTMLTextAreaElement>('[data-diagram-field="source"]');
  if (textarea && document.activeElement !== textarea && textarea.value !== source) {
    textarea.value = source;
  }
}

function renderEditorShell(source: string): string {
  return `<div class="hvy-diagram-editor" data-editor-activation-autofocus="false">
    <div class="hvy-diagram-source-panel">
      <label for="hvyDiagramSource">Mermaid</label>
      <textarea id="hvyDiagramSource" data-diagram-field="source" spellcheck="false">${escapeHtml(source)}</textarea>
    </div>
    <div class="hvy-diagram-preview-panel" data-diagram-preview="true"></div>
  </div>`;
}

function formatMermaidError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return 'Unable to render Mermaid diagram.';
}

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-diagram hvy-diagram-${ctx.mode}`;
  let renderVersion = 0;

  const renderPreview = () => {
    const version = ++renderVersion;
    const source = readDiagramSource(ctx);
    if (ctx.mode === 'editor') {
      syncEditorShell(root, source);
    }
    const host = getRenderHost(ctx, root);
    if (!source.trim()) {
      host.innerHTML = renderEmpty();
      return;
    }
    host.innerHTML = renderLoading();
    void loadMermaidModule()
      .then(async (mermaid) => {
        if (version !== renderVersion) return;
        configureMermaid(mermaid, root);
        const rendered = await mermaid.render(createDiagramRenderId(), source);
        if (version !== renderVersion) return;
        host.innerHTML = renderFrame(sanitizeSvg(rendered.svg));
        rendered.bindFunctions?.(host);
      })
      .catch((error: unknown) => {
        if (version !== renderVersion) return;
        host.innerHTML = renderError(formatMermaidError(error));
      });
  };

  const onInput = (event: Event) => {
    const target = event.target as HTMLTextAreaElement | null;
    if (!(target instanceof HTMLTextAreaElement) || target.dataset.diagramField !== 'source') {
      return;
    }
    ctx.setText(target.value);
  };

  if (ctx.mode === 'editor') {
    root.addEventListener('input', onInput);
  }

  renderPreview();
  return {
    element: root,
    refresh: renderPreview,
    unmount: () => {
      renderVersion += 1;
      if (ctx.mode === 'editor') {
        root.removeEventListener('input', onInput);
      }
    },
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const diagramPluginFactory: HvyPluginFactory = build;

export const diagramPlugin: HvyPlugin = {
  id: DIAGRAM_PLUGIN_ID,
  displayName: 'Diagram',
  documentation: {
    filename: 'about-diagram.txt',
    text: diagramDocumentation,
  },
  aiHint: 'Diagram plugin. Mermaid source lives in plugin.txt; pluginConfig.syntax defaults to mermaid.',
  aiHelp: [
    `Use \`<!--hvy:plugin {"plugin":"${DIAGRAM_PLUGIN_ID}","pluginConfig":{"syntax":"mermaid"}}-->\`.`,
    'Store Mermaid source in the plugin body.',
    'The default syntax is Mermaid flowchart/sequence/class/state/etc. as supported by Mermaid.',
  ].join(' '),
  create: diagramPluginFactory,
};

/** @deprecated Use diagramPlugin. */
export const diagramPluginRegistration = diagramPlugin;
