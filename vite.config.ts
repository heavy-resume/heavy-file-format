import { readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { createViteChatProxyPlugin } from './vite-chat-proxy-plugin';
import { createHvyBuiltInPluginsPlugin } from './vite-built-in-plugins';
import { createBrythonMinimalVfsPlugin } from './src/plugins/scripting/brython-minimal-vfs-plugin';

const IMPORT_REFERENCE_API_PATH = '/api/import-reference-document';
const IMPORT_REFERENCE_FILE_PATH = resolve(process.cwd(), 'src/ai-import-hvy-format-reference.hvy');
const HVY_GUIDE_API_PATH = '/api/hvy-guide-document';
const HVY_GUIDE_FILE_PATH = resolve(process.cwd(), 'hvy-guide.hvy');
const SCRIPTING_HELP_API_PATH = '/api/scripting-help-document';
const SCRIPTING_HELP_FILE_PATH = resolve(process.cwd(), 'src/plugins/scripting/help.hvy');
const SEPA_RECREATION_API_PATH = '/api/sepa-recreation-document';
const SEPA_RECREATION_FILE_PATH = resolve(process.cwd(), 'examples/SEPA_Recreation.phvy');

export function createImportReferenceDocumentPlugin(): Plugin {
  return {
    name: 'hvy-source-document-save',
    configureServer(server) {
      server.middlewares.use(handleSourceDocumentRequest);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleSourceDocumentRequest);
    },
  };
}

function handleSourceDocumentRequest(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  const sourceDocument = getSourceDocumentForRequest(req.url);
  if (!sourceDocument) {
    next();
    return;
  }
  if (req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/octet-stream');
    res.end(readFileSync(sourceDocument.filePath));
    return;
  }
  if (req.method === 'PUT') {
    void readRequestBytes(req)
      .then((body) => {
        writeFileSync(sourceDocument.filePath, body);
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true }));
      })
      .catch((error: unknown) => {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : `Could not save ${sourceDocument.label}.` }));
      });
    return;
  }
  res.statusCode = 405;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: 'Method not allowed.' }));
}

function getSourceDocumentForRequest(url: string | undefined): { filePath: string; label: string } | null {
  if (url?.startsWith(IMPORT_REFERENCE_API_PATH)) {
    return { filePath: IMPORT_REFERENCE_FILE_PATH, label: 'import reference document' };
  }
  if (url?.startsWith(HVY_GUIDE_API_PATH)) {
    return { filePath: HVY_GUIDE_FILE_PATH, label: 'HVY guide document' };
  }
  if (url?.startsWith(SCRIPTING_HELP_API_PATH)) {
    return { filePath: SCRIPTING_HELP_FILE_PATH, label: 'scripting help document' };
  }
  if (url?.startsWith(SEPA_RECREATION_API_PATH)) {
    return { filePath: SEPA_RECREATION_FILE_PATH, label: 'SEPA Recreation document' };
  }
  return null;
}

function readRequestBytes(req: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    plugins: [
      createViteChatProxyPlugin(env),
      createImportReferenceDocumentPlugin(),
      createBrythonMinimalVfsPlugin(),
      createHvyBuiltInPluginsPlugin(env),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/src/editor/components/image/image-preset-css.ts')) {
              return 'image-preset-css';
            }
            if (id.includes('node_modules/highlight.js')) {
              return 'vendor-highlight';
            }
            if (
              id.includes('node_modules/marked') ||
              id.includes('node_modules/dompurify') ||
              id.includes('node_modules/turndown')
            ) {
              return 'vendor-markdown';
            }
            if (id.includes('node_modules/yaml')) {
              return 'vendor-yaml';
            }
            if (id.includes('/src/editor/')) {
              return 'app-editor';
            }
            if (id.includes('/src/reader/')) {
              return 'app-reader';
            }
            if (
              id.includes('/src/chat') ||
              id.includes('/src/ai-') ||
              id.includes('/src/chat-')
            ) {
              return 'app-ai-chat';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      host: true,
      port: 5173,
    },
  };
});
