import { strToU8, zipSync } from 'fflate';
import { describe, expect, test, vi } from 'vitest';

import {
  loadHvyPluginModule,
  parseHvyPluginPackageManifest,
  type HvyPluginPackageManifest,
} from '../src/plugin-package';
import { loadHvyPluginZip, readHvyPluginZipManifest } from '../src/plugin-package-zip';

const manifest: HvyPluginPackageManifest = {
  formatVersion: '0.1',
  id: 'com.example.timeline',
  uuid: 'timeline-primary',
  version: '1.4.2',
  displayName: 'Timeline',
  entry: 'plugin.mjs',
  styles: ['plugin.css'],
  permissions: [],
  hvyApiVersion: '0.1',
};

const pythonManifest: HvyPluginPackageManifest = {
  ...manifest,
  formatVersion: '0.2',
  entry: 'plugin.py',
  pythonImports: ['random', 're', 'datetime'],
};

describe('source-independent plugin package loading', () => {
  test('before, module load, after: validates the optional runtime uuid against the manifest', async () => {
    const before = JSON.stringify(manifest);
    const expectedResult = await loadHvyPluginModule({
      manifest,
      importEntry: async () => ({
        default: {
          id: manifest.id,
          uuid: manifest.uuid,
          version: manifest.version,
          hvyApiVersion: manifest.hvyApiVersion,
          displayName: manifest.displayName,
        },
      }),
    });
    const after = JSON.stringify(manifest);

    expect(before).toBe(after);
    expect(expectedResult.id).toBe('com.example.timeline');
  });

  test('rejects a runtime plugin with the right id but the wrong uuid', async () => {
    await expect(loadHvyPluginModule({
      manifest,
      importEntry: async () => ({
        default: {
          id: manifest.id,
          uuid: 'different-plugin',
          version: manifest.version,
          hvyApiVersion: manifest.hvyApiVersion,
          displayName: manifest.displayName,
        },
      }),
    })).rejects.toThrow('does not match manifest');
  });

  test('parses optional uuid and required semantic-version metadata', () => {
    expect(parseHvyPluginPackageManifest(JSON.stringify(manifest))).toEqual(manifest);
  });

  test('keeps format-0.1 JavaScript entry path handling unchanged', () => {
    const previousEntryConvention = { ...manifest, entry: 'bundled/plugin.entry' };
    expect(parseHvyPluginPackageManifest(JSON.stringify(previousEntryConvention))).toEqual(previousEntryConvention);
  });

  test('accepts a package without a uuid', async () => {
    const { uuid: _uuid, ...manifestWithoutUuid } = manifest;
    const expectedResult = await loadHvyPluginModule({
      manifest: manifestWithoutUuid,
      importEntry: async () => ({
        default: {
          id: manifestWithoutUuid.id,
          version: manifestWithoutUuid.version,
          hvyApiVersion: manifestWithoutUuid.hvyApiVersion,
          displayName: manifestWithoutUuid.displayName,
        },
      }),
    });

    expect(expectedResult.uuid).toBeUndefined();
  });

  test('rejects a uuid longer than 64 characters', () => {
    expect(() => parseHvyPluginPackageManifest(JSON.stringify({
      ...manifest,
      uuid: 'x'.repeat(65),
    }))).toThrow('cannot exceed 64 characters');
  });

  test('accepts format-0.2 Python entries and their bundled import requests', () => {
    expect(parseHvyPluginPackageManifest(JSON.stringify(pythonManifest))).toEqual(pythonManifest);
  });

  test('rejects Python entries in format-0.1 packages', () => {
    expect(() => parseHvyPluginPackageManifest(JSON.stringify({
      ...pythonManifest,
      formatVersion: '0.1',
    }))).toThrow('require package format "0.2"');
  });

  test('rejects unavailable and duplicate Python import requests', () => {
    expect(() => parseHvyPluginPackageManifest(JSON.stringify({
      ...pythonManifest,
      pythonImports: ['urllib'],
    }))).toThrow('unsupported Python import "urllib"');
    expect(() => parseHvyPluginPackageManifest(JSON.stringify({
      ...pythonManifest,
      pythonImports: ['re', 're'],
    }))).toThrow('contains duplicate "re"');
  });
});

describe('optional ZIP plugin package loading', () => {
  test('reads authorization metadata without importing plugin code', () => {
    const importModule = vi.fn();
    const archive = zipSync({
      'hvy-plugin.json': strToU8(JSON.stringify({ ...manifest, authorization: 'required' })),
      'plugin.mjs': strToU8('throw new Error("must not execute");'),
      'plugin.css': strToU8(''),
    });

    expect(readHvyPluginZipManifest(archive)).toEqual({ ...manifest, authorization: 'required' });
    expect(importModule).not.toHaveBeenCalled();
  });

  test('before, ZIP load, after: loads the bundled entry and rewrites packaged CSS resources', async () => {
    const archive = zipSync({
      'hvy-plugin.json': strToU8(JSON.stringify(manifest)),
      'plugin.mjs': strToU8('export default {};'),
      'plugin.css': strToU8('.marker { background-image: url("./assets/marker.svg"); }'),
      'assets/marker.svg': strToU8('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    });
    const revoked: string[] = [];
    let nextUrl = 0;
    const before = archive.slice();
    const expectedResult = await loadHvyPluginZip(archive, {
      createObjectUrl: () => `blob:test-${nextUrl++}`,
      revokeObjectUrl: (url) => revoked.push(url),
      importModule: vi.fn(async () => ({
        default: {
          id: manifest.id,
          uuid: manifest.uuid,
          version: manifest.version,
          hvyApiVersion: manifest.hvyApiVersion,
          displayName: manifest.displayName,
        },
      })),
    });
    const after = archive;

    expect(after).toEqual(before);
    expect(expectedResult.plugin.id).toBe(manifest.id);
    expect(expectedResult.styles[0]).toContain('url("blob:test-1")');
    expectedResult.dispose();
    expect(revoked).toEqual(['blob:test-0', 'blob:test-1']);
  });

  test('rejects traversal paths before importing code', async () => {
    const archive = zipSync({
      'hvy-plugin.json': strToU8(JSON.stringify(manifest)),
      '../plugin.mjs': strToU8('export default {};'),
    });

    await expect(loadHvyPluginZip(archive, {
      importModule: vi.fn(),
    })).rejects.toThrow('not normalized');
  });

  test('before, Python adapter load, after: loads format-0.2 without importing JavaScript and disposes it', async () => {
    const archive = zipSync({
      'hvy-plugin.json': strToU8(JSON.stringify(pythonManifest)),
      'plugin.py': strToU8('plugin = {}'),
      'helpers.py': strToU8('FAKE_VALUE = 4'),
      'plugin.css': strToU8(''),
    });
    const importModule = vi.fn();
    const dispose = vi.fn();
    const loadPython = vi.fn(async () => ({
      plugin: {
        id: pythonManifest.id,
        uuid: pythonManifest.uuid,
        version: pythonManifest.version,
        hvyApiVersion: pythonManifest.hvyApiVersion,
        displayName: pythonManifest.displayName,
      },
      dispose,
    }));
    const before = archive.slice();

    const expectedResult = await loadHvyPluginZip(archive, { importModule, loadPython });

    expect(archive).toEqual(before);
    expect(loadPython).toHaveBeenCalledOnce();
    expect(loadPython.mock.calls[0]?.[0].files['helpers.py']).toBeDefined();
    expect(importModule).not.toHaveBeenCalled();
    expectedResult.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
