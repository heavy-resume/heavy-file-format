export const VIDEO_PLUGIN_DEFAULT_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

export const VIDEO_PROVIDERS = ['youtube', 'vimeo', 'wistia'] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

export interface VideoConfig {
  url: string;
  title: string;
}

export interface NormalizedVideo {
  provider: VideoProvider;
  id: string;
  canonicalUrl: string;
  embedUrl: string;
  thumbnailUrl?: string;
}

export const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  url: VIDEO_PLUGIN_DEFAULT_URL,
  title: '',
};

const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const VIMEO_ID_RE = /^[0-9]{6,14}$/;
const WISTIA_ID_RE = /^[a-zA-Z0-9]{10}$/;

export function readVideoConfig(raw: Record<string, unknown> | null | undefined): VideoConfig {
  const url = typeof raw?.url === 'string' ? raw.url : DEFAULT_VIDEO_CONFIG.url;
  const normalized = normalizeVideoUrl(url);
  return {
    url: normalized?.canonicalUrl ?? url.trim(),
    title: typeof raw?.title === 'string' ? raw.title : DEFAULT_VIDEO_CONFIG.title,
  };
}

export function normalizeVideoUrl(input: string): NormalizedVideo | null {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const pathParts = parsed.pathname.split('/').filter(Boolean);

  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'm.youtube.com') {
    const id = extractYouTubeId(parsed, pathParts);
    return id ? createYouTubeVideo(id) : null;
  }
  if (host === 'youtu.be') {
    const id = pathParts[0] ?? '';
    return YOUTUBE_ID_RE.test(id) ? createYouTubeVideo(id) : null;
  }
  if (host === 'vimeo.com' || host.endsWith('.vimeo.com') || host === 'player.vimeo.com') {
    const id = extractVimeoId(pathParts);
    return id ? createVimeoVideo(id) : null;
  }
  if (host === 'wistia.com' || host.endsWith('.wistia.com') || host === 'fast.wistia.net') {
    const id = extractWistiaId(pathParts);
    return id ? createWistiaVideo(id) : null;
  }
  return null;
}

function extractYouTubeId(url: URL, pathParts: string[]): string | null {
  if (pathParts[0] === 'watch') {
    const id = url.searchParams.get('v') ?? '';
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }
  if (['embed', 'shorts', 'live'].includes(pathParts[0] ?? '')) {
    const id = pathParts[1] ?? '';
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }
  return null;
}

function extractVimeoId(pathParts: string[]): string | null {
  const id = pathParts[0] === 'video' ? pathParts[1] ?? '' : pathParts.find((part) => VIMEO_ID_RE.test(part)) ?? '';
  return VIMEO_ID_RE.test(id) ? id : null;
}

function extractWistiaId(pathParts: string[]): string | null {
  const mediasIndex = pathParts.findIndex((part) => part === 'medias');
  const iframeIndex = pathParts.findIndex((part) => part === 'iframe');
  const id = mediasIndex >= 0
    ? pathParts[mediasIndex + 1] ?? ''
    : iframeIndex >= 0
      ? pathParts[iframeIndex + 1] ?? ''
      : pathParts.find((part) => WISTIA_ID_RE.test(part)) ?? '';
  return WISTIA_ID_RE.test(id) ? id : null;
}

function createYouTubeVideo(id: string): NormalizedVideo {
  return {
    provider: 'youtube',
    id,
    canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=0&rel=0`,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

function createVimeoVideo(id: string): NormalizedVideo {
  return {
    provider: 'vimeo',
    id,
    canonicalUrl: `https://vimeo.com/${id}`,
    embedUrl: `https://player.vimeo.com/video/${id}?autoplay=0`,
  };
}

function createWistiaVideo(id: string): NormalizedVideo {
  return {
    provider: 'wistia',
    id,
    canonicalUrl: `https://wistia.com/medias/${id}`,
    embedUrl: `https://fast.wistia.net/embed/iframe/${id}?autoPlay=false`,
  };
}
