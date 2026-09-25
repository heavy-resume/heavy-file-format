import { describe, expect, test } from 'vitest';

import {
  DEFAULT_MODEL_3D_CONFIG,
  formatModel3dBytes,
  getModel3dAttachmentId,
  MODEL_3D_MAX_HEIGHT,
  MODEL_3D_MIN_HEIGHT,
  readModel3dConfig,
} from '../src/plugins/model-3d/model-3d-config';
import {
  findModel3dFormat,
  inferModel3dMediaType,
  isSupportedModel3dFilename,
  listModel3dExtensions,
  MODEL_3D_FORMATS,
  sanitizeModel3dFilename,
} from '../src/plugins/model-3d/model-3d-formats';
import { configurePluginBlock } from '../src/plugins/plugin-block';
import { MODEL_3D_PLUGIN_ID } from '../src/plugins/registry';
import { deserializeDocument, serializeDocumentBytes } from '../src/serialization';
import type { VisualBlock } from '../src/editor/types';

describe('3D model format registry', () => {
  test('resolves every advertised extension to exactly one format', () => {
    const unresolved = listModel3dExtensions().filter((extension) => findModel3dFormat(`example${extension}`) === null);

    expect(unresolved).toEqual([]);
  });

  test('declares no duplicate extensions across formats', () => {
    const extensions = listModel3dExtensions();

    expect(extensions).toEqual([...new Set(extensions)]);
  });

  test('matches extensions case-insensitively', () => {
    expect(findModel3dFormat('Bracket.STL')?.id).toBe('stl');
    expect(findModel3dFormat('scene.GLB')?.id).toBe('gltf');
  });

  test('rejects filenames with no supported 3D extension', () => {
    expect(isSupportedModel3dFilename('notes.txt')).toBe(false);
    expect(isSupportedModel3dFilename('model')).toBe(false);
    expect(isSupportedModel3dFilename('.stl')).toBe(false);
    expect(isSupportedModel3dFilename('archive.stl.zip')).toBe(false);
  });

  test('excludes formats that would require a WebAssembly decoder', () => {
    const expectedResult = ['.step', '.stp', '.iges', '.igs', '.3dm', '.drc'];

    expect(expectedResult.filter((extension) => isSupportedModel3dFilename(`part${extension}`))).toEqual([]);
  });

  test('infers a media type for every format and falls back for unknown files', () => {
    expect(inferModel3dMediaType('bracket.stl')).toBe('model/stl');
    expect(inferModel3dMediaType('scene.glb')).toBe('model/gltf-binary');
    expect(inferModel3dMediaType('notes.txt')).toBe('application/octet-stream');
  });

  test('every format declares at least one extension and media type', () => {
    const incomplete = MODEL_3D_FORMATS.filter(
      (format) => format.extensions.length === 0 || format.mediaTypes.length === 0
    );

    expect(incomplete).toEqual([]);
  });

  test('sanitizes author filenames to attachment-safe names', () => {
    expect(sanitizeModel3dFilename('my model (final).stl')).toBe('my-model-final-.stl');
    expect(sanitizeModel3dFilename('***')).toBe('model');
  });

  test('reduces path-bearing filenames to a traversal-free basename', () => {
    expect(sanitizeModel3dFilename('../../etc/passwd.stl')).toBe('passwd.stl');
    expect(sanitizeModel3dFilename('parts\\bracket.stl')).toBe('bracket.stl');
    expect(sanitizeModel3dFilename('/absolute/scene.glb')).toBe('scene.glb');
    expect(sanitizeModel3dFilename('../')).toBe('model');
  });
});

describe('3D model plugin configuration', () => {
  test('falls back to documented defaults for an empty config', () => {
    expect(readModel3dConfig({})).toEqual(DEFAULT_MODEL_3D_CONFIG);
  });

  test('keeps a supported model file and derives its media type', () => {
    expect(readModel3dConfig({ modelFile: ' bracket.stl ' })).toMatchObject({
      modelFile: 'bracket.stl',
      mediaType: 'model/stl',
    });
  });

  test('drops a model reference whose extension cannot be rendered', () => {
    const expectedResult = readModel3dConfig({ modelFile: 'part.step', mediaType: 'model/step' });

    expect(expectedResult.modelFile).toBe('');
    expect(expectedResult.mediaType).toBe('');
  });

  test('clamps viewer height into the supported range', () => {
    expect(readModel3dConfig({ height: 10 }).height).toBe(MODEL_3D_MIN_HEIGHT);
    expect(readModel3dConfig({ height: 99999 }).height).toBe(MODEL_3D_MAX_HEIGHT);
    expect(readModel3dConfig({ height: 'not a number' }).height).toBe(DEFAULT_MODEL_3D_CONFIG.height);
    expect(readModel3dConfig({ height: 412.6 }).height).toBe(413);
  });

  test('reads booleans from both JSON booleans and serialized strings', () => {
    expect(readModel3dConfig({ showGrid: false, autoRotate: true }))
      .toMatchObject({ showGrid: false, autoRotate: true });
    expect(readModel3dConfig({ showGrid: 'false', allowDownload: 'false' }))
      .toMatchObject({ showGrid: false, allowDownload: false });
    expect(readModel3dConfig({ wireframe: 'nonsense' }).wireframe).toBe(DEFAULT_MODEL_3D_CONFIG.wireframe);
  });

  test('namespaces model attachments so they cannot collide with image attachments', () => {
    expect(getModel3dAttachmentId('bracket.stl')).toBe('model-3d:bracket.stl');
  });

  test('formats attachment sizes for the download control', () => {
    expect(formatModel3dBytes(512)).toBe('512 B');
    expect(formatModel3dBytes(2_048)).toBe('3 KB');
    expect(formatModel3dBytes(5_400_000)).toBe('5.4 MB');
  });
});

describe('3D model plugin block', () => {
  test('configures a new block with the documented default config', () => {
    const block = { id: 'model', text: '', schemaMode: true, schema: {} } as unknown as VisualBlock;

    configurePluginBlock(block, MODEL_3D_PLUGIN_ID);

    expect(block.schema.plugin).toBe(MODEL_3D_PLUGIN_ID);
    expect(block.schema.pluginConfig).toEqual({ ...DEFAULT_MODEL_3D_CONFIG });
    expect(block.text).toBe('3D model. Geometry is stored in the HVY tail attachment.');
  });
});

describe('3D model attachment serialization', () => {
  test('round-trips a model plugin block and its tail attachment bytes', async () => {
    const { deserializeDocumentBytesWithDiagnostics } = await import('../src/serialization');

    const document = deserializeDocument(`---
hvy_version: 0.1
plugins:
  - id: hvy.model-3d
---

<!--hvy: {"id":"parts"}-->
#! Parts

<!--hvy:plugin {"id":"bracket","plugin":"hvy.model-3d","pluginConfig":{"modelFile":"bracket.stl","mediaType":"model/stl","title":"Mounting bracket","height":360,"showGrid":true,"autoRotate":false,"wireframe":false,"allowDownload":true}}-->
3D model. Geometry is stored in the HVY tail attachment.
`, '.hvy');

    document.attachments = [{
      id: getModel3dAttachmentId('bracket.stl'),
      meta: { mediaType: 'model/stl', plugin: MODEL_3D_PLUGIN_ID },
      // A binary STL header is 80 bytes followed by a little-endian triangle
      // count; zero triangles keeps the fixture small and still well formed.
      bytes: new Uint8Array(84),
    }];

    const expectedResult = deserializeDocumentBytesWithDiagnostics(serializeDocumentBytes(document), '.hvy');

    expect(expectedResult.document.attachments).toHaveLength(1);
    expect(expectedResult.document.attachments[0]?.id).toBe('model-3d:bracket.stl');
    expect(expectedResult.document.attachments[0]?.meta).toMatchObject({
      mediaType: 'model/stl',
      plugin: MODEL_3D_PLUGIN_ID,
    });
    expect(expectedResult.document.attachments[0]?.bytes.byteLength).toBe(84);

    expect(readModel3dConfig(
      expectedResult.document.sections[0]?.blocks[0]?.schema.pluginConfig
    )).toEqual({
      modelFile: 'bracket.stl',
      mediaType: 'model/stl',
      title: 'Mounting bracket',
      height: 360,
      showGrid: true,
      autoRotate: false,
      wireframe: false,
      allowDownload: true,
    });
  });

  test('preserves model bytes that collide with the tail sentinel text', async () => {
    const { deserializeDocumentBytesWithDiagnostics } = await import('../src/serialization');

    const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"parts"}-->
#! Parts
`, '.hvy');

    document.attachments = [{
      id: getModel3dAttachmentId('scene.glb'),
      meta: { mediaType: 'model/gltf-binary' },
      // Binary model payloads can contain any byte sequence, including the
      // tail preamble text, so slicing must be length-driven.
      bytes: new TextEncoder().encode('glTF--HVY-TAIL--\n--HVY-TAIL--'),
    }];

    const expectedResult = deserializeDocumentBytesWithDiagnostics(serializeDocumentBytes(document), '.hvy');

    expect(new TextDecoder().decode(expectedResult.document.attachments[0]?.bytes))
      .toBe('glTF--HVY-TAIL--\n--HVY-TAIL--');
  });
});

describe('3D model editor data attributes', () => {
  test('declares no data attribute whose dataset key a dash-digit would break', async () => {
    const { readFileSync } = await import('node:fs');

    // `data-model-3d-toggle` reaches JavaScript as dataset['model-3dToggle'],
    // not dataset.model3dToggle, because HTML only folds a dash into the next
    // character when that character is a letter. Reading the camelCase key then
    // silently yields undefined and the control does nothing.
    const source = readFileSync(new URL('../src/plugins/model-3d/model-3d.ts', import.meta.url), 'utf8');

    expect(source.match(/data-[a-z0-9-]*-\d[a-z0-9-]*=/g) ?? []).toEqual([]);
  });
});
