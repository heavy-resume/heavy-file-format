import {
  builtInPlugins,
  createHostedAttachmentAdapter,
  deserializeDocumentBytes,
  mountHvyViewer,
} from './hvy-embed.js?v=__HVY_EMBED_CACHE_BUST__';

const root = document.querySelector('#hvyRoot');
const status = document.querySelector('#status');

try {
  const [documentResponse, manifestResponse] = await Promise.all([
    fetch('./document.hvy'),
    fetch('./attachments.json'),
  ]);
  if (!documentResponse.ok) {
    throw new Error(`Could not load document.hvy (${documentResponse.status}).`);
  }
  if (!manifestResponse.ok) {
    throw new Error(`Could not load attachments.json (${manifestResponse.status}).`);
  }
  const [documentBytes, manifest] = await Promise.all([
    documentResponse.arrayBuffer(),
    manifestResponse.json(),
  ]);
  const documentModel = deserializeDocumentBytes(new Uint8Array(documentBytes), '.hvy');
  mountHvyViewer({
    root,
    document: documentModel,
    attachmentStore: createHostedAttachmentAdapter(manifest, { baseUrl: '.' }),
    plugins: builtInPlugins,
    paletteId: null,
  });
  if (status) {
    status.hidden = true;
  }
} catch (error) {
  if (status) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}
