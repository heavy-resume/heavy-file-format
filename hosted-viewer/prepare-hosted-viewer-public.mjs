#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_BUST_PLACEHOLDER = '__HVY_EMBED_CACHE_BUST__';

async function main() {
  const publicDir = process.argv[2] ? resolve(process.argv[2]) : '';
  const distEmbedDir = process.argv[3] ? resolve(process.argv[3]) : '';
  if (!publicDir || !distEmbedDir) {
    throw new Error('Usage: node hosted-viewer/prepare-hosted-viewer-public.mjs PUBLIC_DIR DIST_EMBED_DIR');
  }

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  await mkdir(publicDir, { recursive: true });
  await copyFile(join(repoRoot, 'hosted-viewer/index.html'), join(publicDir, 'index.html'));
  await copyFile(join(repoRoot, 'hosted-viewer/viewer.css'), join(publicDir, 'viewer.css'));
  await copyFile(join(repoRoot, 'hosted-viewer/viewer.js'), join(publicDir, 'viewer.js'));
  await cp(distEmbedDir, publicDir, { recursive: true });
  await copyEmbedCss(publicDir);
  await injectEmbedCacheBust(publicDir);
}

async function copyEmbedCss(publicDir) {
  const assetsDir = join(publicDir, 'assets');
  const { readdir } = await import('node:fs/promises');
  const cssFile = (await readdir(assetsDir)).find((filename) => filename.endsWith('.css'));
  if (!cssFile) {
    throw new Error(`Could not find built HVY embed CSS in ${assetsDir}`);
  }
  await copyFile(join(assetsDir, cssFile), join(publicDir, 'hvy-embed.css'));
}

async function injectEmbedCacheBust(publicDir) {
  const embedEntryPath = join(publicDir, 'hvy-embed.js');
  const viewerPath = join(publicDir, 'viewer.js');
  const embedBytes = await readFile(embedEntryPath);
  const cacheBust = createHash('sha256').update(embedBytes).digest('hex').slice(0, 12);
  const viewerSource = await readFile(viewerPath, 'utf8');
  if (!viewerSource.includes(CACHE_BUST_PLACEHOLDER)) {
    throw new Error(`Missing ${CACHE_BUST_PLACEHOLDER} in hosted viewer.js`);
  }
  await writeFile(viewerPath, viewerSource.replaceAll(CACHE_BUST_PLACEHOLDER, cacheBust));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
