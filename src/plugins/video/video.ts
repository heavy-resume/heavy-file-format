import './video.css';

import { escapeAttr, escapeHtml } from '../../utils';
import { refreshIcon } from '../../icons';
import { VIDEO_PLUGIN_ID } from '../registry';
import type { HvyPlugin, HvyPluginContext, HvyPluginFactory, HvyPluginInstance } from '../types';
import type { VisualBlock } from '../../editor/types';
import type { VisualDocument } from '../../types';
import videoDocumentation from './about-video.txt?raw';
import {
  DEFAULT_VIDEO_CONFIG,
  VIDEO_PLUGIN_DEFAULT_URL,
  normalizeVideoUrl,
  readVideoConfig,
  type NormalizedVideo,
  type VideoConfig,
} from './video-model';

interface EditorHandles {
  url: HTMLInputElement;
  title: HTMLInputElement;
  refreshButton: HTMLButtonElement;
  status: HTMLDivElement;
  preview: HTMLDivElement;
}

interface VideoPreviewState {
  stateKey: string;
  title: string;
  stale: boolean;
  youtubeObserverCleanup: (() => void) | null;
}

interface YouTubePlayerApi {
  Player: new(element: HTMLIFrameElement, options: {
    events?: {
      onError?: (event: { data: number }) => void;
    };
  }) => { destroy?: () => void };
}

type YouTubePlayerInstance = InstanceType<YouTubePlayerApi['Player']>;

declare global {
  interface Window {
    YT?: YouTubePlayerApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youTubeApiPromise: Promise<YouTubePlayerApi> | null = null;

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-video hvy-video-${ctx.mode}`;
  let handles: EditorHandles | null = null;
  const previewState: VideoPreviewState = { stateKey: '', title: '', stale: false, youtubeObserverCleanup: null };
  const preview = document.createElement('div');

  if (ctx.mode === 'editor') {
    const built = buildEditorDom();
    handles = built.handles;
    root.appendChild(built.root);
  } else {
    root.appendChild(preview);
  }

  const sync = () => {
    const config = readVideoConfig(ctx.block.schema.pluginConfig);
    if (handles) {
      syncEditorInputs(handles, config);
      renderVideoPreview(handles.preview, config, previewState, ctx);
      syncPreviewRefreshState(handles, config, previewState);
    } else {
      renderVideoPreview(preview, config, previewState, ctx, { force: true });
    }
  };

  const onInput = (event: Event) => {
    const target = event.target as HTMLInputElement | null;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.videoField === 'url') {
      ctx.setConfig({ url: target.value });
    } else if (target.dataset.videoField === 'title') {
      ctx.setConfig({ title: target.value });
    }
  };

  const onChange = (event: Event) => {
    const target = event.target as HTMLInputElement | null;
    if (!(target instanceof HTMLInputElement) || target.dataset.videoField !== 'url') return;
    const normalized = normalizeVideoUrl(target.value);
    if (normalized) {
      ctx.setConfig({ url: normalized.canonicalUrl });
    }
  };

  const onClick = (event: Event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-video-action="refresh-preview"]');
    if (!button || !handles) return;
    const normalized = normalizeVideoUrl(handles.url.value);
    if (normalized && normalized.canonicalUrl !== ctx.block.schema.pluginConfig.url) {
      ctx.setConfig({ url: normalized.canonicalUrl });
    }
    const config = readVideoConfig(ctx.block.schema.pluginConfig);
    renderVideoPreview(handles.preview, config, previewState, ctx, { force: true });
    syncPreviewRefreshState(handles, config, previewState);
  };

  if (ctx.mode === 'editor') {
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('click', onClick);
  }

  sync();
  return {
    element: root,
    refresh: sync,
    unmount: () => {
      previewState.youtubeObserverCleanup?.();
      previewState.youtubeObserverCleanup = null;
      if (ctx.mode === 'editor') {
        root.removeEventListener('input', onInput);
        root.removeEventListener('change', onChange);
        root.removeEventListener('click', onClick);
      }
    },
  };
}

function buildEditorDom(): { root: HTMLDivElement; handles: EditorHandles } {
  const root = document.createElement('div');
  root.className = 'hvy-video-editor';
  root.setAttribute('data-editor-activation-autofocus', 'false');
  root.innerHTML = `
    <div class="hvy-video-controls">
      <label class="hvy-video-field">
        <span>Video URL</span>
        <input type="url" data-video-field="url" inputmode="url" spellcheck="false">
      </label>
      <label class="hvy-video-field">
        <span>Title</span>
        <input type="text" data-video-field="title">
      </label>
      <button type="button" class="ghost hvy-video-refresh-button" data-video-action="refresh-preview" aria-label="Refresh video preview" title="Refresh video preview">${refreshIcon()}</button>
    </div>
    <div class="hvy-video-status" data-video-status></div>
    <div class="hvy-video-preview"></div>
  `;
  return {
    root,
    handles: {
      url: requireElement(root, '[data-video-field="url"]', HTMLInputElement),
      title: requireElement(root, '[data-video-field="title"]', HTMLInputElement),
      refreshButton: requireElement(root, '[data-video-action="refresh-preview"]', HTMLButtonElement),
      status: requireElement(root, '[data-video-status]', HTMLDivElement),
      preview: requireElement(root, '.hvy-video-preview', HTMLDivElement),
    },
  };
}

function syncEditorInputs(handles: EditorHandles, config: VideoConfig): void {
  const active = document.activeElement;
  setValueIfNotFocused(handles.url, config.url, active);
  setValueIfNotFocused(handles.title, config.title, active);
}

function setValueIfNotFocused(input: HTMLInputElement, value: string, active: Element | null): void {
  if (input !== active && input.value !== value) {
    input.value = value;
  }
}

function syncPreviewRefreshState(handles: EditorHandles, config: VideoConfig, state: VideoPreviewState): void {
  const normalized = normalizeVideoUrl(config.url);
  const stateKey = getVideoPreviewStateKey(config, normalized);
  const stale = state.stateKey.length > 0 && state.stateKey !== stateKey;
  state.stale = stale;
  handles.preview.classList.toggle('is-stale', stale);
  handles.refreshButton.classList.toggle('is-stale', stale);
  handles.refreshButton.disabled = !config.url.trim();
  handles.status.textContent = stale ? 'Refresh preview to apply URL changes.' : '';
}

function renderVideoPreview(
  host: HTMLElement,
  config: VideoConfig,
  state: VideoPreviewState,
  ctx: HvyPluginContext,
  options: { force?: boolean } = {}
): void {
  const normalized = normalizeVideoUrl(config.url);
  const stateKey = getVideoPreviewStateKey(config, normalized);
  if (!options.force && state.stateKey.length > 0 && state.stateKey !== stateKey) {
    state.stale = true;
    host.classList.add('is-stale');
    return;
  }
  state.stale = false;
  host.classList.remove('is-stale');
  if (state.stateKey !== stateKey) {
    state.youtubeObserverCleanup?.();
    state.youtubeObserverCleanup = null;
  }
  if (!config.url.trim()) {
    if (state.stateKey !== stateKey) {
      host.innerHTML = '<div class="hvy-video-empty">Add a YouTube, Vimeo, or Wistia URL.</div>';
      state.stateKey = stateKey;
      state.title = '';
    }
    return;
  }
  if (!normalized) {
    if (state.stateKey !== stateKey) {
      host.innerHTML = '<div class="hvy-video-error">Use a supported HTTPS video URL from YouTube, Vimeo, or Wistia.</div>';
      state.stateKey = stateKey;
      state.title = '';
    }
    return;
  }
  const title = config.title.trim() || `${formatProvider(normalized.provider)} video`;
  host.classList.remove('hvy-link-observer-surface');
  const embedUrl = createRuntimeEmbedUrl(normalized);
  if (state.stateKey !== stateKey) {
    host.innerHTML = `<div class="hvy-video-frame">
      <iframe src="${escapeAttr(embedUrl)}" title="${escapeAttr(title)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="${escapeAttr(getIframeAllowPolicy(normalized))}" allowfullscreen></iframe>
    </div>`;
    state.stateKey = stateKey;
    state.title = title;
    observeYouTubeEmbedFailure(host, normalized, title, state, ctx);
    return;
  }
  if (state.title !== title) {
    host.querySelector('iframe')?.setAttribute('title', title);
    state.title = title;
  }
}

function getVideoPreviewStateKey(config: VideoConfig, normalized: ReturnType<typeof normalizeVideoUrl>): string {
  return normalized ? `video:${normalized.embedUrl}` : config.url.trim() ? 'error' : 'empty';
}

function renderExternalVideoLink(video: NormalizedVideo, title: string): string {
  const thumbnail = video.thumbnailUrl
    ? `<img class="hvy-video-external-thumbnail" src="${escapeAttr(video.thumbnailUrl)}" alt="">`
    : '<div class="hvy-video-external-thumbnail hvy-video-external-thumbnail-empty"></div>';
  return `<div class="hvy-video-external">
    <div class="hvy-video-external-media">
      ${thumbnail}
      <div class="hvy-video-external-icon" aria-hidden="true"></div>
    </div>
    <div class="hvy-video-external-copy">
      <strong>${escapeHtml(title)}</strong>
      <span>YouTube playback opens outside this desktop preview.</span>
    </div>
    <a class="hvy-video-external-link" href="${escapeAttr(video.canonicalUrl)}" target="_blank" rel="noopener noreferrer">Open on YouTube</a>
  </div>`;
}

function observeYouTubeEmbedFailure(
  host: HTMLElement,
  video: NormalizedVideo,
  title: string,
  state: VideoPreviewState,
  ctx: HvyPluginContext
): void {
  if (video.provider !== 'youtube') {
    return;
  }
  const iframe = host.querySelector<HTMLIFrameElement>('iframe');
  if (!iframe) {
    return;
  }
  let mounted = true;
  let player: YouTubePlayerInstance | null = null;
  state.youtubeObserverCleanup = () => {
    mounted = false;
    try {
      player?.destroy?.();
    } catch {
      // Ignore YouTube cleanup failures; the iframe may already be gone.
    }
  };
  void loadYouTubeIframeApi()
    .then((api) => {
      if (!mounted || !iframe.isConnected) {
        return;
      }
      player = new api.Player(iframe, {
        events: {
          onError: (event) => {
            if (!mounted || !isYouTubeExternalFallbackError(event.data)) {
              return;
            }
            state.youtubeObserverCleanup?.();
            state.youtubeObserverCleanup = null;
            host.innerHTML = renderExternalVideoLink(video, title);
            host.classList.add('hvy-link-observer-surface');
            ctx.observeLinks(host);
          },
        },
      });
    })
    .catch(() => {
      // If the API is blocked, keep the iframe. The player can still work
      // without JS API observability.
    });
}

function isYouTubeExternalFallbackError(code: number): boolean {
  return code === 101 || code === 150 || code === 153;
}

function loadYouTubeIframeApi(): Promise<YouTubePlayerApi> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube iframe API requires a browser window.'));
  }
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  youTubeApiPromise ??= new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => {
      window.onYouTubeIframeAPIReady = previousReady;
      reject(new Error('Timed out loading YouTube iframe API.'));
    }, 8000);
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      window.clearTimeout(timeout);
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error('YouTube iframe API loaded without Player.'));
      }
    };
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    if (existing) {
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timeout);
      window.onYouTubeIframeAPIReady = previousReady;
      reject(new Error('Could not load YouTube iframe API.'));
    };
    document.head.appendChild(script);
  });
  return youTubeApiPromise;
}

function createRuntimeEmbedUrl(video: NormalizedVideo): string {
  if (video.provider !== 'youtube' || typeof window === 'undefined' || !window.location.origin.startsWith('http')) {
    return video.embedUrl;
  }
  const url = new URL(video.embedUrl);
  url.searchParams.set('origin', window.location.origin);
  return url.toString();
}

function getIframeAllowPolicy(video: NormalizedVideo): string {
  if (video.provider === 'youtube') {
    return 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  }
  return 'fullscreen; picture-in-picture; encrypted-media';
}

function formatProvider(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function requireElement<T extends Element>(
  root: ParentNode,
  selector: string,
  constructor: { new(...args: never[]): T }
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof constructor)) {
    throw new Error(`Missing video plugin element "${selector}".`);
  }
  return element;
}

function normalizeVideoBlocks(document: VisualDocument): boolean {
  let changed = false;
  const visitBlocks = (blocks: VisualBlock[]) => {
    for (const block of blocks) {
      if (block.schema.component === 'plugin' && block.schema.plugin === VIDEO_PLUGIN_ID) {
        const url = typeof block.schema.pluginConfig.url === 'string' ? block.schema.pluginConfig.url : '';
        const normalized = normalizeVideoUrl(url);
        if (normalized && normalized.canonicalUrl !== url) {
          block.schema.pluginConfig = {
            ...block.schema.pluginConfig,
            url: normalized.canonicalUrl,
          };
          changed = true;
        }
      }
      visitBlocks(block.schema.containerBlocks ?? []);
      visitBlocks(block.schema.componentListBlocks ?? []);
      visitBlocks(block.schema.gridItems?.map((item) => item.block) ?? []);
      visitBlocks(block.schema.expandableStubBlocks?.children ?? []);
      visitBlocks(block.schema.expandableContentBlocks?.children ?? []);
      if (block.schema.encryptedBlock) {
        visitBlocks([block.schema.encryptedBlock]);
      }
    }
  };
  const visitSections = (sections: VisualDocument['sections']) => {
    for (const section of sections) {
      visitBlocks(section.blocks);
      visitSections(section.children);
    }
  };
  visitSections(document.sections);
  return changed;
}

export const videoPluginFactory: HvyPluginFactory = build;

export const videoPlugin: HvyPlugin = {
  id: VIDEO_PLUGIN_ID,
  displayName: 'Video',
  documentation: {
    filename: 'about-video.txt',
    text: videoDocumentation,
  },
  aiHint: 'Video plugin. Store a supported HTTPS YouTube, Vimeo, or Wistia URL in pluginConfig.url and optional accessible title in pluginConfig.title. Do not use URL parameters for behavior.',
  aiHelp: [
    `Use \`<!--hvy:plugin {"plugin":"${VIDEO_PLUGIN_ID}","pluginConfig":${JSON.stringify(DEFAULT_VIDEO_CONFIG)}}-->\`.`,
    'Supported providers are YouTube, Vimeo, and Wistia.',
    'Store only canonical provider URLs in pluginConfig.url; clients build non-autoplay iframe URLs from plugin configuration.',
  ].join(' '),
  create: videoPluginFactory,
  hooks: {
    documentLoad: {
      run(ctx) {
        if (normalizeVideoBlocks(ctx.document)) {
          ctx.refreshPlugins(VIDEO_PLUGIN_ID);
        }
      },
    },
    documentChange: {
      run(ctx) {
        if (normalizeVideoBlocks(ctx.document)) {
          ctx.refreshPlugins(VIDEO_PLUGIN_ID);
        }
      },
    },
  },
};

/** @deprecated Use videoPlugin. */
export const videoPluginRegistration = videoPlugin;

export { VIDEO_PLUGIN_DEFAULT_URL, normalizeVideoBlocks, normalizeVideoUrl, readVideoConfig };
