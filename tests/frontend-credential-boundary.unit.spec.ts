import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';
import { build, type Rollup } from 'vite';

import { resolveServerProviderApiKey } from '../proxy/chat-proxy';
import { HVY_EMBED_ENVIRONMENT_BOUNDARY } from '../vite.embed.config';

afterEach(() => {
  vi.unstubAllEnvs();
});

test('expected result: the server proxy rejects client-prefixed API credentials', () => {
  expect(() => resolveServerProviderApiKey('openai', {
    VITE_OPENAI_API_KEY: 'browser-visible-openai-secret',
  })).toThrow('OPENAI_API_KEY is not configured');
  expect(() => resolveServerProviderApiKey('anthropic', {
    VITE_ANTHROPIC_API_KEY: 'browser-visible-anthropic-secret',
  })).toThrow('ANTHROPIC_API_KEY is not configured');
  expect(() => resolveServerProviderApiKey('qwen', {
    VITE_QWEN_API_KEY: 'browser-visible-qwen-secret',
    VITE_DASHSCOPE_API_KEY: 'browser-visible-dashscope-secret',
  })).toThrow('QWEN_API_KEY or DASHSCOPE_API_KEY is not configured');

  expect(resolveServerProviderApiKey('openai', { OPENAI_API_KEY: 'server-openai-secret' })).toBe('server-openai-secret');
  expect(resolveServerProviderApiKey('anthropic', { ANTHROPIC_API_KEY: 'server-anthropic-secret' })).toBe('server-anthropic-secret');
  expect(resolveServerProviderApiKey('qwen', { DASHSCOPE_API_KEY: 'server-dashscope-secret' })).toBe('server-dashscope-secret');
});

test('expected result: frontend source never reads the complete Vite environment object', async () => {
  const sourceFiles = await listTypeScriptFiles(join(process.cwd(), 'src'));
  const unsafeReads = [];

  for (const file of sourceFiles) {
    const source = await readFile(file, 'utf8');
    if (/import\.meta\.env(?!\s*(?:\?\.|\.)[A-Za-z_$])/.test(source)) {
      unsafeReads.push(file);
    }
    expect(source).not.toMatch(/VITE_(?:OPENAI|ANTHROPIC|QWEN|DASHSCOPE)_API_KEY/);
  }

  expect(unsafeReads).toEqual([]);
});

test('expected result: embed output excludes env-file and process API secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hvy-embed-env-boundary-'));
  vi.stubEnv('VITE_OPENAI_API_KEY', 'process-openai-secret-sentinel');

  try {
    await writeFile(join(root, '.env'), [
      'VITE_ANTHROPIC_API_KEY=env-file-anthropic-secret-sentinel',
      'VITE_HVY_CHAT_MODEL=env-file-model-sentinel',
    ].join('\n'));

    const result = await build({
      configFile: false,
      logLevel: 'silent',
      root,
      ...HVY_EMBED_ENVIRONMENT_BOUNDARY,
      plugins: [{
        name: 'hvy-embed-env-boundary-test-entry',
        resolveId(id) {
          return id === 'virtual:hvy-embed-env-boundary-test-entry' ? id : null;
        },
        load(id) {
          return id === 'virtual:hvy-embed-env-boundary-test-entry'
            ? 'globalThis.__hvyEnvironment = import.meta.env;'
            : null;
        },
      }],
      build: {
        write: false,
        minify: false,
        rollupOptions: { input: 'virtual:hvy-embed-env-boundary-test-entry' },
      },
    });
    const expectedResult = (Array.isArray(result) ? result : [result])
      .flatMap((output) => output.output)
      .filter((output): output is Rollup.OutputChunk => output.type === 'chunk')
      .map((output) => output.code)
      .join('\n');

    expect(expectedResult).not.toContain('process-openai-secret-sentinel');
    expect(expectedResult).not.toContain('env-file-anthropic-secret-sentinel');
    expect(expectedResult).not.toContain('env-file-model-sentinel');
    expect(expectedResult).not.toContain('VITE_OPENAI_API_KEY');
    expect(expectedResult).not.toContain('VITE_ANTHROPIC_API_KEY');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listTypeScriptFiles(path));
    } else if (extname(entry.name) === '.ts') {
      files.push(path);
    }
  }
  return files;
}
