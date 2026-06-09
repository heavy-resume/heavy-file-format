import type { HvyAttachmentDescriptor, HvyAttachmentHostAdapter } from './attachment-store';

export interface HostedAttachmentManifestEntry extends HvyAttachmentDescriptor {
  url: string;
}

export interface HostedAttachmentManifest {
  attachments: HostedAttachmentManifestEntry[];
}

export function createHostedAttachmentAdapter(
  manifest: HostedAttachmentManifest,
  options: { baseUrl?: string } = {}
): HvyAttachmentHostAdapter {
  const baseUrl = options.baseUrl ?? '.';
  const entries = Array.isArray(manifest.attachments) ? manifest.attachments : [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return {
    list() {
      return entries.map(({ id, meta, length }) => ({ id, meta, length }));
    },
    async recall(id) {
      const url = resolveManifestEntryUrl(byId.get(id), baseUrl);
      if (!url) {
        return null;
      }
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      return response.arrayBuffer();
    },
    store() {},
    remove() {},
    resolveUrl(id) {
      return resolveManifestEntryUrl(byId.get(id), baseUrl);
    },
  };
}

function resolveManifestEntryUrl(
  entry: HostedAttachmentManifestEntry | undefined,
  baseUrl: string
): string | null {
  if (!entry || typeof entry.url !== 'string' || entry.url.length === 0) {
    return null;
  }
  if (/^(?:https?:|data:|blob:|\/)/i.test(entry.url)) {
    return entry.url;
  }
  return `${baseUrl.replace(/\/$/, '')}/${entry.url.replace(/^\.\//, '')}`;
}
