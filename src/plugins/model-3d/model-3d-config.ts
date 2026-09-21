import { findModel3dFormat, inferModel3dMediaType, sanitizeModel3dFilename } from './model-3d-formats';

export const MODEL_3D_ATTACHMENT_PREFIX = 'model-3d:';

/**
 * Upper bound on attached model bytes. All supported loaders parse
 * synchronously on the main thread, so an unbounded file is a hang risk rather
 * than a memory-safety one. Authors get a clear error instead of a frozen tab.
 */
export const MODEL_3D_MAX_BYTES = 32 * 1024 * 1024;

export const MODEL_3D_MIN_HEIGHT = 160;
export const MODEL_3D_MAX_HEIGHT = 1200;

export interface Model3dConfig {
  /** Attachment filename. Bytes live in `model-3d:<modelFile>`. */
  modelFile: string;
  mediaType: string;
  /** Accessible name for the viewer canvas. */
  title: string;
  autoRotate: boolean;
  showGrid: boolean;
  wireframe: boolean;
  /** Viewer height in CSS pixels. */
  height: number;
  /** Show the download button in reader/viewer surfaces. */
  allowDownload: boolean;
}

export const DEFAULT_MODEL_3D_CONFIG: Model3dConfig = {
  modelFile: '',
  mediaType: '',
  title: '',
  autoRotate: false,
  showGrid: true,
  wireframe: false,
  height: 360,
  allowDownload: true,
};

export function getModel3dAttachmentId(modelFile: string): string {
  return `${MODEL_3D_ATTACHMENT_PREFIX}${modelFile}`;
}

export function readModel3dConfig(raw: Record<string, unknown> | null | undefined): Model3dConfig {
  const modelFile = typeof raw?.modelFile === 'string' ? sanitizeModel3dFilename(raw.modelFile.trim()) : '';
  // An unsupported extension means there is nothing we can render, so treat the
  // reference as absent rather than carrying a file we will always fail on.
  const supported = modelFile.length > 0 && findModel3dFormat(modelFile) !== null;
  return {
    modelFile: supported ? modelFile : '',
    // A dropped model reference must not keep advertising a media type for a
    // file we will never render.
    mediaType: !supported
      ? ''
      : typeof raw?.mediaType === 'string' && raw.mediaType.trim().length > 0
        ? raw.mediaType.trim()
        : inferModel3dMediaType(modelFile),
    title: typeof raw?.title === 'string' ? raw.title : DEFAULT_MODEL_3D_CONFIG.title,
    autoRotate: readBoolean(raw?.autoRotate, DEFAULT_MODEL_3D_CONFIG.autoRotate),
    showGrid: readBoolean(raw?.showGrid, DEFAULT_MODEL_3D_CONFIG.showGrid),
    wireframe: readBoolean(raw?.wireframe, DEFAULT_MODEL_3D_CONFIG.wireframe),
    height: readHeight(raw?.height),
    allowDownload: readBoolean(raw?.allowDownload, DEFAULT_MODEL_3D_CONFIG.allowDownload),
  };
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function readHeight(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MODEL_3D_CONFIG.height;
  return Math.min(MODEL_3D_MAX_HEIGHT, Math.max(MODEL_3D_MIN_HEIGHT, Math.round(parsed)));
}

export function formatModel3dBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${Math.round(bytes / 100_000) / 10} MB`;
  if (bytes >= 1000) return `${Math.ceil(bytes / 1000)} KB`;
  return `${bytes} B`;
}
