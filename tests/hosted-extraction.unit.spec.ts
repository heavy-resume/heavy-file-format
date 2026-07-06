import { execFile } from 'node:child_process';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { injectPreviewMetadata } from '../hosted-viewer/server.mjs';

const execFileAsync = promisify(execFile);

test('expected result: hosted extraction keeps document kilobyte-scale while extracting large image bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hvy-hosted-extract-'));
  const source = join(dir, 'gallery.hvy');
  const outDir = join(dir, 'site');
  const prefix = `---
hvy_version: 0.1
---

<!--hvy: {"id":"gallery"}-->
#! Gallery

<!--hvy:image {"imageFile":"large.png","imageAlt":"Large"}-->
<!--hvy:tail {"id":"image:large.png","mediaType":"image/png","length":47185920}-->
--HVY-TAIL--
`;
  const prefixBytes = new TextEncoder().encode(prefix);
  const imageBytes = new Uint8Array(45 * 1024 * 1024);
  imageBytes[0] = 137;
  imageBytes[1] = 80;
  imageBytes[imageBytes.length - 1] = 82;
  const sourceBytes = new Uint8Array(prefixBytes.length + imageBytes.length);
  sourceBytes.set(prefixBytes, 0);
  sourceBytes.set(imageBytes, prefixBytes.length);
  await writeFile(source, sourceBytes);

  await execFileAsync(process.execPath, ['scripts/extract-hvy-assets.mjs', source, '--out', outDir], {
    cwd: process.cwd(),
  });

  const documentText = await readFile(join(outDir, 'document.hvy'), 'utf8');
  const manifest = JSON.parse(await readFile(join(outDir, 'attachments.json'), 'utf8'));
  const preview = JSON.parse(await readFile(join(outDir, 'preview.json'), 'utf8'));
  const extractedImage = await stat(join(outDir, 'image', 'large.png'));

  expect(documentText).toContain('<!--hvy:image {"imageFile":"large.png","imageAlt":"Large"}-->');
  expect(documentText).not.toContain('--HVY-TAIL--');
  expect(Buffer.byteLength(documentText)).toBeLessThan(1024);
  expect(preview).toEqual({ title: 'HVY Viewer' });
  expect(manifest.attachments).toEqual([
    {
      id: 'image:large.png',
      meta: { mediaType: 'image/png' },
      length: 45 * 1024 * 1024,
      url: 'image/large.png',
    },
  ]);
  expect(extractedImage.size).toBe(45 * 1024 * 1024);
});

test('expected result: hosted extraction accepts conventional database tail with omitted final length', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hvy-hosted-db-extract-'));
  const source = join(dir, 'scripted.hvy');
  const outDir = join(dir, 'site');
  const prefix = `---
hvy_version: 0.1
---

<!--hvy: {"id":"scripted"}-->
#! Scripted

<!--hvy:plugin {"plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
print("hello")
<!--hvy:tail {"plugin":"hvy.scripting","mediaType":"application/vnd.sqlite3","encoding":"gzip"}-->
--HVY-TAIL--
`;
  const prefixBytes = new TextEncoder().encode(prefix);
  const dbBytes = new Uint8Array([31, 139, 8, 0, 1, 2, 3]);
  const sourceBytes = new Uint8Array(prefixBytes.length + dbBytes.length);
  sourceBytes.set(prefixBytes, 0);
  sourceBytes.set(dbBytes, prefixBytes.length);
  await writeFile(source, sourceBytes);

  await execFileAsync(process.execPath, ['scripts/extract-hvy-assets.mjs', source, '--out', outDir], {
    cwd: process.cwd(),
  });

  const manifest = JSON.parse(await readFile(join(outDir, 'attachments.json'), 'utf8'));
  const extractedDb = await readFile(join(outDir, 'attachment', 'db'));

  expect(manifest.attachments).toEqual([
    {
      id: 'db',
      meta: {
        plugin: 'hvy.scripting',
        mediaType: 'application/vnd.sqlite3',
        encoding: 'gzip',
      },
      length: 7,
      url: 'attachment/db',
    },
  ]);
  expect(Array.from(extractedDb)).toEqual([31, 139, 8, 0, 1, 2, 3]);
});

test('expected result: hosted extraction writes preview metadata from front matter without tail bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hvy-hosted-preview-extract-'));
  const source = join(dir, 'preview.hvy');
  const outDir = join(dir, 'site');
  const prefix = `---
hvy_version: 0.1
title: Preview Title
description: Hosted preview description.
tags: [alpha, beta]
---

<!--hvy: {"id":"preview"}-->
#! Preview

<!--hvy:image {"imageFile":"large.png","imageAlt":"Large"}-->
<!--hvy:tail {"id":"image:large.png","mediaType":"image/png","length":15}-->
--HVY-TAIL--
`;
  const prefixBytes = new TextEncoder().encode(prefix);
  const tailBytes = new TextEncoder().encode('tail title leak');
  const sourceBytes = new Uint8Array(prefixBytes.length + tailBytes.length);
  sourceBytes.set(prefixBytes, 0);
  sourceBytes.set(tailBytes, prefixBytes.length);
  await writeFile(source, sourceBytes);

  await execFileAsync(process.execPath, ['scripts/extract-hvy-assets.mjs', source, '--out', outDir], {
    cwd: process.cwd(),
  });

  const preview = JSON.parse(await readFile(join(outDir, 'preview.json'), 'utf8'));

  expect(preview).toEqual({
    title: 'Preview Title',
    description: 'Hosted preview description.',
    tags: ['alpha', 'beta'],
  });
});

test('expected result: hosted viewer html injects escaped static preview tags', () => {
  const html = `<!doctype html>
<html>
  <head>
    <!--HVY_PREVIEW_META_START-->
    <title>HVY Viewer</title>
    <!--HVY_PREVIEW_META_END-->
  </head>
</html>`;

  const expectedResult = injectPreviewMetadata(html, {
    title: 'A&B "Title"',
    description: 'Less < more & quoted "summary"',
  });

  expect(expectedResult).toContain('<title>A&amp;B &quot;Title&quot;</title>');
  expect(expectedResult).toContain('<meta name="description" content="Less &lt; more &amp; quoted &quot;summary&quot;" />');
  expect(expectedResult).toContain('<meta property="og:title" content="A&amp;B &quot;Title&quot;" />');
  expect(expectedResult).toContain('<meta property="og:description" content="Less &lt; more &amp; quoted &quot;summary&quot;" />');
  expect(expectedResult).toContain('<meta property="og:type" content="article" />');
  expect(expectedResult).toContain('<meta name="twitter:card" content="summary" />');
  expect(expectedResult).toContain('<meta name="twitter:title" content="A&amp;B &quot;Title&quot;" />');
  expect(expectedResult).toContain('<meta name="twitter:description" content="Less &lt; more &amp; quoted &quot;summary&quot;" />');
});
