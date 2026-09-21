// Format registry for the 3D model plugin. This module is intentionally free of
// any three.js import so format lookup, validation, and filename handling stay
// cheap and testable without pulling in the renderer.

/** How a loader's parse() result must be normalized into a scene object. */
export type Model3dResultKind =
  | 'group' // loader returns an Object3D/Group directly
  | 'gltf' // loader returns { scene } asynchronously through onLoad
  | 'collada' // loader returns { scene } synchronously
  | 'geometry' // loader returns a BufferGeometry to wrap in a Mesh
  | 'point-geometry' // loader returns a BufferGeometry to wrap in Points
  | 'points'; // loader returns a Points object directly

export interface Model3dFormat {
  /** Stable id; also selects the loader in model-3d-scene. */
  id: string;
  label: string;
  /** Lowercase, leading-dot file extensions. First entry is the canonical one. */
  extensions: string[];
  /** Media types authors may see from the file picker. Advisory only. */
  mediaTypes: string[];
  /** True when parse() takes an ArrayBuffer rather than a decoded string. */
  binary: boolean;
  resultKind: Model3dResultKind;
}

// Only pure-JavaScript three.js loaders are listed. Formats needing a WASM
// decoder (Draco-compressed glTF, KTX2 textures, STEP/IGES) are deliberately
// excluded so the plugin adds no binary decoder payload.
export const MODEL_3D_FORMATS: Model3dFormat[] = [
  {
    id: 'gltf',
    label: 'glTF',
    extensions: ['.glb', '.gltf'],
    mediaTypes: ['model/gltf-binary', 'model/gltf+json'],
    binary: true,
    resultKind: 'gltf',
  },
  {
    id: 'obj',
    label: 'Wavefront OBJ',
    extensions: ['.obj'],
    mediaTypes: ['model/obj', 'text/plain'],
    binary: false,
    resultKind: 'group',
  },
  {
    id: 'stl',
    label: 'STL',
    extensions: ['.stl'],
    mediaTypes: ['model/stl', 'application/sla'],
    binary: true,
    resultKind: 'geometry',
  },
  {
    id: 'ply',
    label: 'PLY',
    extensions: ['.ply'],
    mediaTypes: ['application/x-ply'],
    binary: true,
    resultKind: 'geometry',
  },
  {
    id: 'fbx',
    label: 'FBX',
    extensions: ['.fbx'],
    mediaTypes: ['application/octet-stream'],
    binary: true,
    resultKind: 'group',
  },
  {
    id: 'collada',
    label: 'Collada',
    extensions: ['.dae'],
    mediaTypes: ['model/vnd.collada+xml'],
    binary: false,
    resultKind: 'collada',
  },
  {
    id: '3mf',
    label: '3MF',
    extensions: ['.3mf'],
    mediaTypes: ['model/3mf'],
    binary: true,
    resultKind: 'group',
  },
  {
    id: 'amf',
    label: 'AMF',
    extensions: ['.amf'],
    mediaTypes: ['application/octet-stream'],
    binary: true,
    resultKind: 'group',
  },
  {
    id: 'vtk',
    label: 'VTK',
    extensions: ['.vtk', '.vtp'],
    mediaTypes: ['application/octet-stream'],
    binary: true,
    resultKind: 'geometry',
  },
  {
    id: 'pcd',
    label: 'Point Cloud (PCD)',
    extensions: ['.pcd'],
    mediaTypes: ['application/octet-stream'],
    binary: true,
    resultKind: 'points',
  },
  {
    id: 'xyz',
    label: 'Point Cloud (XYZ)',
    extensions: ['.xyz'],
    mediaTypes: ['text/plain'],
    binary: false,
    resultKind: 'point-geometry',
  },
];

/** Every supported extension, canonical order, for `accept` and author-facing copy. */
export function listModel3dExtensions(): string[] {
  return MODEL_3D_FORMATS.flatMap((format) => format.extensions);
}

export function getModel3dExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot).toLowerCase() : '';
}

export function findModel3dFormat(filename: string): Model3dFormat | null {
  const extension = getModel3dExtension(filename);
  if (!extension) return null;
  return MODEL_3D_FORMATS.find((format) => format.extensions.includes(extension)) ?? null;
}

export function findModel3dFormatById(id: string): Model3dFormat | null {
  return MODEL_3D_FORMATS.find((format) => format.id === id) ?? null;
}

export function isSupportedModel3dFilename(filename: string): boolean {
  return findModel3dFormat(filename) !== null;
}

/**
 * Media type recorded on the attachment. Model media types are poorly
 * standardized and browsers rarely set them on file inputs, so the extension is
 * the authority and this is only a hint for hosts and download handling.
 */
export function inferModel3dMediaType(filename: string): string {
  return findModel3dFormat(filename)?.mediaTypes[0] ?? 'application/octet-stream';
}

/** Filesystem-safe attachment filename, mirroring the image attachment rules. */
export function sanitizeModel3dFilename(requested: string): string {
  // Browsers can hand back a relative path (directory uploads, drag and drop),
  // so reduce to the basename before sanitizing. Otherwise traversal segments
  // survive as literal dots in the attachment id.
  const basename = requested.split(/[\\/]/).pop() ?? '';
  const safe = basename
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/-+$/, '');
  return safe || 'model';
}
