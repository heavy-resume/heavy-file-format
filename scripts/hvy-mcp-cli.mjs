import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve('heavy-file-format-ref-impl/package.json'));
let bundledRunner;

export async function runHvyCliOnFile(request) {
  const runner = await loadBundledRunner();
  return runner.runHvyCliOnFile(normalizeRequest(request));
}

export async function searchHvyFile(request) {
  const runner = await loadBundledRunner();
  if (typeof request?.filePath !== 'string' || typeof request?.query !== 'string') {
    throw new Error('searchHvyFile requires filePath and query.');
  }
  return runner.searchHvyFile(request);
}

export async function applyHvyPatchOnFile(request) {
  const runner = await loadBundledRunner();
  if (typeof request?.filePath !== 'string' || typeof request?.patch !== 'string') {
    throw new Error('applyHvyPatchOnFile requires filePath and patch.');
  }
  return runner.applyHvyPatchOnFile(request);
}

export async function walkHvyFile(request) {
  const runner = await loadBundledRunner();
  if (typeof request?.filePath !== 'string') {
    throw new Error('walkHvyFile requires filePath.');
  }
  return runner.walkHvyFile(request);
}

export async function buildHvyEmbeddingsOnFile(request) {
  const runner = await loadBundledRunner();
  if (typeof request?.filePath !== 'string' || !request?.embeddingProvider) {
    throw new Error('buildHvyEmbeddingsOnFile requires filePath and embeddingProvider.');
  }
  return runner.buildHvyEmbeddingsOnFile(request);
}

function normalizeRequest(request) {
  const filePath = typeof request?.filePath === 'string' ? request.filePath : '';
  const cwd = typeof request?.cwd === 'string' && request.cwd ? request.cwd : '/';
  const commands = Array.isArray(request?.commands)
    ? request.commands.filter((command) => typeof command === 'string')
    : [];
  if (!filePath || commands.length === 0) {
    throw new Error('runHvyCliOnFile requires filePath and at least one command.');
  }
  return { filePath, cwd, commands };
}

async function loadBundledRunner() {
  bundledRunner ??= buildBundledRunner();
  return bundledRunner;
}

async function buildBundledRunner() {
  const entry = `
    import { readFileSync, writeFileSync } from 'node:fs';
    import { extname } from 'node:path';
    import { createHvyCliSession, executeHvyCliCommand } from './src/cli-core/commands.ts';
    import { createHvyAgentTools } from './src/agent-tools.ts';
    import { materializePreparedEmbeddingAttachments } from './src/chat/embedding-context.ts';
    import { walkHvyDocument } from './src/search/hvy-document-walk.ts';
    import { deserializeDocument, deserializeDocumentBytesWithDiagnostics, serializeDocument, serializeDocumentBytes } from './src/serialization.ts';

    const HVY_TAIL_SENTINEL = '--HVY-TAIL--';
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    export async function runHvyCliOnFile(request) {
      const filePath = request.filePath;
      const commands = request.commands;
      const extension = extname(filePath).toLowerCase();
      if (!['.hvy', '.thvy', '.phvy', '.md', '.markdown'].includes(extension)) {
        throw new Error('Expected .hvy, .thvy, .phvy, .md, or .markdown input.');
      }
      const documentExtension = extension === '.markdown' ? '.md' : extension;
      const source = splitEditableHvyBytes(readFileSync(filePath));
      const document = deserializeDocument(source.text, documentExtension);
      const session = createHvyCliSession();
      session.cwd = request.cwd || '/';
      const results = [];
      let mutated = false;

      for (const command of commands) {
        const result = await executeHvyCliCommand(document, session, command);
        mutated = mutated || result.mutated;
        results.push({
          command,
          cwd: result.cwd,
          output: result.output,
          mutated: result.mutated,
        });
      }

      if (mutated) {
        writeFileSync(filePath, appendOpaqueTailBytes(serializeDocument(document), source.tailBytes));
      }

      return {
        cwd: session.cwd,
        mutated,
        results,
      };
    }

    export async function searchHvyFile(request) {
      const document = readDocumentWithAttachments(request.filePath);
      return createHvyAgentTools({
        document,
        embeddingProvider: request.embeddingProvider ? createEmbeddingProvider(request.embeddingProvider) : null,
        chatContext: request.embeddingProvider ? {
          mode: 'embedding-retrieval',
          embeddingModel: request.embeddingModel,
          embeddingDimensions: request.embeddingDimensions,
          embeddingBatchSize: request.embeddingBatchSize,
        } : null,
      }).search({
        query: request.query,
        limit: request.limit,
        cursor: request.cursor,
        semantic: request.semantic,
      });
    }

    export function applyHvyPatchOnFile(request) {
      const source = readDocument(request.filePath);
      const result = createHvyAgentTools({ document: source.document }).applyPatch(request.patch);
      if (result.appliedFileCount > 0) {
        writeFileSync(request.filePath, appendOpaqueTailBytes(serializeDocument(source.document), source.tailBytes));
      }
      return result;
    }

    export function walkHvyFile(request) {
      const { document } = readDocument(request.filePath);
      return walkHvyDocument({
        document,
        limit: request.limit,
        cursor: request.cursor,
      });
    }

    export async function buildHvyEmbeddingsOnFile(request) {
      const extension = extname(request.filePath).toLowerCase();
      if (extension !== '.hvy') {
        throw new Error('buildHvyEmbeddingsOnFile supports .hvy documents.');
      }
      const bytes = readFileSync(request.filePath);
      const document = deserializeDocumentBytesWithDiagnostics(bytes, '.hvy').document;
      const embeddingProvider = createEmbeddingProvider(request.embeddingProvider);
      const stats = await createHvyAgentTools({
        document,
        embeddingProvider,
        chatContext: {
          mode: 'embedding-retrieval',
          embeddingModel: request.embeddingModel,
          embeddingDimensions: request.embeddingDimensions,
          embeddingBatchSize: request.embeddingBatchSize,
          persistEmbeddingsToAttachments: true,
        },
      }).buildEmbeddings();
      materializePreparedEmbeddingAttachments(document);
      writeFileSync(request.filePath, serializeDocumentBytes(document));
      return {
        ...stats,
        path: request.filePath,
        model: request.embeddingModel,
        ...(request.embeddingDimensions ? { dimensions: request.embeddingDimensions } : {}),
      };
    }

    function createEmbeddingProvider(provider) {
      return async (request) => {
        const baseUrl = provider.baseUrl.replace(/\\/+$/, '');
        const model = request.model.trim();
        let url = \`${'${baseUrl}'}/embeddings\`;
        let headers = {
          'Content-Type': 'application/json',
          ...(provider.apiKey?.trim() ? { Authorization: \`Bearer ${'${provider.apiKey.trim()}'}\` } : {}),
        };
        let body = {
          model,
          input: request.inputs.map((input) => input.text),
          ...(request.dimensions !== undefined ? { dimensions: request.dimensions } : {}),
        };
        if (provider.provider === 'cohere') {
          url = \`${'${baseUrl}'}/v2/embed\`;
          body = {
            model,
            input_type: 'search_document',
            embedding_types: ['float'],
            inputs: request.inputs.map((input) => ({ content: [{ type: 'text', text: input.text }] })),
          };
        } else if (provider.provider === 'gemini') {
          const modelPath = model.startsWith('models/') ? model : \`models/${'${model}'}\`;
          url = \`${'${baseUrl}'}/${'${modelPath}'}:batchEmbedContents\`;
          headers = {
            'Content-Type': 'application/json',
            ...(provider.apiKey?.trim() ? { 'x-goog-api-key': provider.apiKey.trim() } : {}),
          };
          body = {
            requests: request.inputs.map((input) => ({
              model: modelPath,
              content: { parts: [{ text: input.text }] },
              ...(request.dimensions !== undefined
                ? { embedContentConfig: { outputDimensionality: request.dimensions } }
                : {}),
            })),
          };
        }
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: request.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const message = payload?.error?.message || payload?.message || response.statusText;
          throw new Error(\`Embedding request failed (${'${response.status}'}): ${'${message}'}\`);
        }
        const vectors = provider.provider === 'gemini'
          ? payload?.embeddings?.map((embedding) => embedding.values ?? [])
          : provider.provider === 'cohere'
            ? (Array.isArray(payload?.embeddings) ? payload.embeddings : payload?.embeddings?.float)
            : (Array.isArray(payload?.embeddings) ? payload.embeddings : payload?.data?.map((entry) => entry.embedding ?? []));
        if (!Array.isArray(vectors) || vectors.length !== request.inputs.length) {
          throw new Error('Embedding response did not include one vector per input.');
        }
        return request.inputs.map((input, index) => ({ id: input.id, vector: vectors[index] ?? [] }));
      };
    }

    function readDocument(filePath) {
      const extension = extname(filePath).toLowerCase();
      if (!['.hvy', '.thvy', '.phvy', '.md', '.markdown'].includes(extension)) {
        throw new Error('Expected .hvy, .thvy, .phvy, .md, or .markdown input.');
      }
      const documentExtension = extension === '.markdown' ? '.md' : extension;
      const source = splitEditableHvyBytes(readFileSync(filePath));
      return {
        document: deserializeDocument(source.text, documentExtension),
        tailBytes: source.tailBytes,
      };
    }

    function readDocumentWithAttachments(filePath) {
      const extension = extname(filePath).toLowerCase();
      if (!['.hvy', '.thvy', '.phvy', '.md', '.markdown'].includes(extension)) {
        throw new Error('Expected .hvy, .thvy, .phvy, .md, or .markdown input.');
      }
      const documentExtension = extension === '.markdown' ? '.md' : extension;
      return deserializeDocumentBytesWithDiagnostics(readFileSync(filePath), documentExtension).document;
    }

    function splitEditableHvyBytes(bytes) {
      const normalized = decoder.decode(bytes).replace(/\\r\\n/g, '\\n');
      const sentinelNeedle = \`\\n\${HVY_TAIL_SENTINEL}\\n\`;
      const sentinelIndex = normalized.lastIndexOf(sentinelNeedle);
      if (sentinelIndex < 0) {
        return { text: decoder.decode(bytes), tailBytes: new Uint8Array() };
      }

      let directiveStart = sentinelIndex;
      while (directiveStart > 0) {
        const prevNewline = normalized.lastIndexOf('\\n', directiveStart - 1);
        const lineStart = prevNewline + 1;
        const candidate = normalized.slice(lineStart, directiveStart);
        if (/^<!--hvy:tail\\s+\\{.*\\}\\s*-->$/.test(candidate)) {
          directiveStart = prevNewline;
        } else {
          break;
        }
      }

      if (directiveStart === sentinelIndex) {
        return { text: decoder.decode(bytes), tailBytes: new Uint8Array() };
      }

      const text = normalized.slice(0, directiveStart);
      const tailByteOffset = encoder.encode(normalized.slice(0, directiveStart)).length;
      return { text, tailBytes: bytes.slice(tailByteOffset) };
    }

    function appendOpaqueTailBytes(serializedText, tailBytes) {
      const text = tailBytes.length > 0
        ? serializedText.replace(/\\n+$/, '')
        : serializedText;
      const textBytes = encoder.encode(text);
      const separator = tailBytes.length > 0 && !text.endsWith('\\n') ? encoder.encode('\\n') : new Uint8Array();
      const combined = new Uint8Array(textBytes.length + separator.length + tailBytes.length);
      combined.set(textBytes, 0);
      combined.set(separator, textBytes.length);
      combined.set(tailBytes, textBytes.length + separator.length);
      return combined;
    }
  `;

  const result = await build({
    stdin: {
      contents: entry,
      resolveDir: packageRoot,
      sourcefile: 'hvy-mcp-cli-runner.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    loader: {
      '.css': 'empty',
      '.md': 'text',
      '.txt': 'text',
    },
    plugins: [
      {
        name: 'raw-query-loader',
        setup(buildApi) {
          buildApi.onResolve({ filter: /\?raw$/ }, (resolveArgs) => ({
            path: resolveAssetPath(resolveArgs.path.replace(/\?raw$/, ''), resolveArgs.resolveDir),
            namespace: 'raw-query',
          }));
          buildApi.onResolve({ filter: /\?inline$/ }, (resolveArgs) => ({
            path: resolveAssetPath(resolveArgs.path.replace(/\?inline$/, ''), resolveArgs.resolveDir),
            namespace: 'raw-query',
          }));
          buildApi.onResolve({ filter: /\?url$/ }, (resolveArgs) => ({
            path: resolveAssetPath(resolveArgs.path.replace(/\?url$/, ''), resolveArgs.resolveDir),
            namespace: 'url-query',
          }));
          buildApi.onLoad({ filter: /.*/, namespace: 'raw-query' }, async (loadArgs) => ({
            contents: await readFile(loadArgs.path, 'utf8').catch(() => ''),
            loader: 'text',
          }));
          buildApi.onLoad({ filter: /.*/, namespace: 'url-query' }, (loadArgs) => ({
            contents: loadArgs.path,
            loader: 'text',
          }));
        },
      },
      {
        name: 'virtual-empty-loader',
        setup(buildApi) {
          buildApi.onResolve({ filter: /^virtual:/ }, (resolveArgs) => ({
            path: resolveArgs.path,
            namespace: 'virtual-empty',
          }));
          buildApi.onLoad({ filter: /.*/, namespace: 'virtual-empty' }, () => ({
            contents: 'export default {};',
            loader: 'js',
          }));
        },
      },
      {
        name: 'vite-glob-loader',
        setup(buildApi) {
          buildApi.onLoad({ filter: /src\/component-help\.ts$/ }, async (loadArgs) => {
            const contents = await readFile(loadArgs.path, 'utf8');
            const modules = globTextFiles(join(packageRoot, 'src/component-docs'), /^about-.+\.txt$/, './component-docs');
            return {
              contents: contents.replace(
                /const componentDocModules = import\.meta\.glob\([^;]+;\n/s,
                `const componentDocModules = ${JSON.stringify(modules)};\n`,
              ),
              loader: 'ts',
            };
          });
          buildApi.onLoad({ filter: /src\/cli-core\/reference-library\.ts$/ }, async (loadArgs) => {
            const contents = await readFile(loadArgs.path, 'utf8');
            const cheatsheets = globTextFiles(join(packageRoot, 'src/cli-core/cheatsheets'), /^.+\.md$/, './cheatsheets');
            const recipes = globTextFiles(join(packageRoot, 'src/cli-core/recipes'), /^.+\.hvy$/, './recipes');
            return {
              contents: contents
                .replace(/const cheatsheetModules = import\.meta\.glob\([^;]+;\n/s, `const cheatsheetModules = ${JSON.stringify(cheatsheets)};\n`)
                .replace(/const recipeModules = import\.meta\.glob\([^;]+;\n/s, `const recipeModules = ${JSON.stringify(recipes)};\n`),
              loader: 'ts',
            };
          });
        },
      },
    ],
    write: false,
    logLevel: 'silent',
  });

  const bundled = result.outputFiles[0]?.text;
  if (!bundled) {
    throw new Error('Unable to build MCP CLI runner.');
  }

  const runnerPath = join(tmpdir(), `hvy-mcp-cli-runner-${process.pid}.cjs`);
  await writeFile(runnerPath, bundled);
  return require(runnerPath);
}

function globTextFiles(directory, pattern, importPrefix) {
  return Object.fromEntries(
    readdirSync(directory)
      .filter((name) => pattern.test(name))
      .map((name) => [`${importPrefix}/${name}`, readFileSync(join(directory, name), 'utf8')]),
  );
}

function resolveAssetPath(assetPath, resolveDirectory) {
  if (!assetPath.startsWith('.') && !assetPath.startsWith('/')) {
    return require.resolve(assetPath);
  }
  return new URL(assetPath, pathToFileURL(`${resolveDirectory}/`)).pathname;
}
