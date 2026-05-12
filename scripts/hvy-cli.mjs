#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';

const args = process.argv.slice(2);
const separatorIndex = args.indexOf('--');
const optionArgs = separatorIndex >= 0 ? args.slice(0, separatorIndex) : args.slice(0, 1);
const commands = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : args.slice(1);
let fileArg = '';
for (let index = 0; index < optionArgs.length; index += 1) {
  const arg = optionArgs[index];
  if ((arg === '--file' || arg === '-f') && optionArgs[index + 1]) {
    fileArg = optionArgs[index + 1];
    index += 1;
    continue;
  }
  if (!arg.startsWith('-') && !fileArg) {
    fileArg = arg;
  }
}

if (!fileArg || commands.length === 0) {
  console.error('Usage: node scripts/hvy-cli.mjs --file <file.hvy|file.thvy|file.md> -- <command> [command...]');
  console.error('       node scripts/hvy-cli.mjs <file.hvy|file.thvy|file.md> -- <command> [command...]');
  process.exit(1);
}

const entry = `
  import { readFileSync } from 'node:fs';
  import { extname } from 'node:path';
  import { createHvyCliSession, executeHvyCliCommand } from './src/cli-core/commands.ts';
  import { deserializeDocument } from './src/serialization.ts';

  async function main() {
    const filePath = ${JSON.stringify(fileArg)};
    const commands = ${JSON.stringify(commands)};
    const extension = extname(filePath).toLowerCase();
    if (!['.hvy', '.thvy', '.md', '.markdown'].includes(extension)) {
      throw new Error('Expected .hvy, .thvy, .md, or .markdown input.');
    }
    const document = deserializeDocument(readFileSync(filePath, 'utf8'), extension === '.markdown' ? '.md' : extension);
    const session = createHvyCliSession();

    for (const command of commands) {
      const result = await executeHvyCliCommand(document, session, command);
      if (commands.length > 1) {
        console.log('$ ' + command);
      }
      if (result.output) {
        console.log(result.output.replace(/\\n$/, ''));
      }
      if (result.error) {
        process.exitCode = 1;
      }
    }
  }

  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
`;

const result = await build({
  stdin: {
    contents: entry,
    resolveDir: process.cwd(),
    sourcefile: 'hvy-cli-runner.ts',
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
        buildApi.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: new URL(args.path.replace(/\?raw$/, ''), pathToFileURL(`${args.resolveDir}/`)).pathname,
          namespace: 'raw-query',
        }));
        buildApi.onResolve({ filter: /\?inline$/ }, (args) => ({
          path: new URL(args.path.replace(/\?inline$/, ''), pathToFileURL(`${args.resolveDir}/`)).pathname,
          namespace: 'raw-query',
        }));
        buildApi.onResolve({ filter: /\?url$/ }, (args) => ({
          path: new URL(args.path.replace(/\?url$/, ''), pathToFileURL(`${args.resolveDir}/`)).pathname,
          namespace: 'url-query',
        }));
        buildApi.onLoad({ filter: /.*/, namespace: 'raw-query' }, async (args) => ({
          contents: await readFile(args.path, 'utf8').catch(() => ''),
          loader: 'text',
        }));
        buildApi.onLoad({ filter: /.*/, namespace: 'url-query' }, (args) => ({
          contents: args.path,
          loader: 'text',
        }));
      },
    },
    {
      name: 'virtual-empty-loader',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^virtual:/ }, (args) => ({
          path: args.path,
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
        buildApi.onLoad({ filter: /src\/component-help\.ts$/ }, async (args) => {
          const contents = await readFile(args.path, 'utf8');
          const modules = globTextFiles('src/component-docs', /^about-.+\.txt$/, './component-docs');
          return {
            contents: contents.replace(
              /const componentDocModules = import\.meta\.glob\([^;]+;\n/s,
              `const componentDocModules = ${JSON.stringify(modules)};\n`
            ),
            loader: 'ts',
          };
        });
        buildApi.onLoad({ filter: /src\/cli-core\/reference-library\.ts$/ }, async (args) => {
          const contents = await readFile(args.path, 'utf8');
          const cheatsheets = globTextFiles('src/cli-core/cheatsheets', /^.+\.md$/, './cheatsheets');
          const recipes = globTextFiles('src/cli-core/recipes', /^.+\.hvy$/, './recipes');
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
  throw new Error('Unable to build CLI runner.');
}

const runnerPath = join(tmpdir(), `hvy-cli-runner-${process.pid}.cjs`);
await writeFile(runnerPath, bundled);
await import(pathToFileURL(runnerPath).href);

function globTextFiles(directory, pattern, importPrefix) {
  return Object.fromEntries(
    readdirSync(directory)
      .filter((name) => pattern.test(name))
      .map((name) => [`${importPrefix}/${name}`, readFileSyncText(join(directory, name))])
  );
}

function readFileSyncText(path) {
  return readFileSync(path, 'utf8');
}
