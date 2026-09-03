import type { HvyAttachmentHostAdapter } from './attachment-store';
import { ensureDocumentAttachmentStore, getAttachmentDescriptors, normalizeAttachmentBytes } from './attachment-store';
import { getComponentDefsFromMeta, getSectionDefsFromMeta } from './component-defs';
import type { JsonObject } from './hvy/types';
import { visitBlocks, visitBlocksInList } from './section-ops';
import type { VisualDocument } from './types';
import type { BlockSchema } from './editor/types';

export const USER_FILE_ATTACHMENT_ROLE = 'user-file';
export const USER_FILE_ATTACHMENT_ID_PREFIX = 'file:';
export const USER_FILE_LINK_PREFIX = '@attachment:';

export type UserFileAttachmentCategory = 'pdf' | 'image' | 'audio' | 'video' | 'text' | 'other';

export interface UserFileAttachmentDescriptor {
  id: string;
  name: string;
  filename: string;
  mediaType: string;
  length: number;
  meta: JsonObject;
}

export type UserFileAttachmentResolution =
  | { status: 'resolved'; attachment: UserFileAttachmentDescriptor }
  | { status: 'invalid'; name: '' }
  | { status: 'missing'; name: string }
  | { status: 'ambiguous'; name: string; attachments: UserFileAttachmentDescriptor[] };

export interface StoreUserFileAttachmentRequest {
  id?: string;
  name: string;
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
  meta?: JsonObject;
}

export interface UserFileAttachmentLimits {
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export interface RenameUserFileAttachmentResult {
  attachment: UserFileAttachmentDescriptor;
  referencesUpdated: number;
}

export function normalizeUserFileAttachmentName(name: string): string {
  return name.trim().normalize('NFKC').toLowerCase();
}

export function encodeUserFileAttachmentTarget(name: string): string {
  const displayName = requireUserFileAttachmentName(name);
  const encodedName = encodeURIComponent(displayName).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${USER_FILE_LINK_PREFIX}${encodedName}`;
}

export function decodeUserFileAttachmentTarget(target: string): string | null {
  if (!target.startsWith(USER_FILE_LINK_PREFIX)) {
    return null;
  }
  try {
    const decoded = decodeURIComponent(target.slice(USER_FILE_LINK_PREFIX.length));
    return decoded.trim() ? decoded : null;
  } catch {
    return null;
  }
}

export function listUserFileAttachments(document: VisualDocument): UserFileAttachmentDescriptor[] {
  return getAttachmentDescriptors(document).flatMap((descriptor) => {
    const attachment = userFileDescriptorFromMeta(descriptor.id, descriptor.meta, descriptor.length);
    return attachment ? [attachment] : [];
  });
}

export function resolveUserFileAttachment(
  document: VisualDocument,
  targetOrName: string,
): UserFileAttachmentResolution {
  const decodedName = targetOrName.startsWith(USER_FILE_LINK_PREFIX)
    ? decodeUserFileAttachmentTarget(targetOrName)
    : targetOrName;
  if (decodedName === null || !decodedName.trim()) {
    return { status: 'invalid', name: '' };
  }
  const name = decodedName.trim();
  const normalizedName = normalizeUserFileAttachmentName(name);
  const matches = listUserFileAttachments(document).filter(
    (attachment) => normalizeUserFileAttachmentName(attachment.name) === normalizedName,
  );
  if (matches.length === 0) {
    return { status: 'missing', name };
  }
  if (matches.length > 1) {
    return { status: 'ambiguous', name, attachments: matches };
  }
  return { status: 'resolved', attachment: matches[0]! };
}

export function hasUserFileAttachmentName(
  document: VisualDocument,
  name: string,
  exceptId?: string,
): boolean {
  const normalizedName = normalizeUserFileAttachmentName(name);
  return listUserFileAttachments(document).some(
    (attachment) => attachment.id !== exceptId
      && normalizeUserFileAttachmentName(attachment.name) === normalizedName,
  );
}

export function defaultUserFileAttachmentName(filename: string): string {
  const leaf = filename.trim().split(/[\\/]/).pop()?.trim() ?? '';
  const withoutExtension = leaf.replace(/\.[^.]+$/, '').trim();
  return withoutExtension || leaf || 'Attachment';
}

export function inferUserFileAttachmentMediaType(filename: string): string {
  const lower = filename.trim().toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  return 'application/octet-stream';
}

export function getUserFileAttachmentCategory(mediaType: string): UserFileAttachmentCategory {
  if (mediaType === 'application/pdf') return 'pdf';
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType.startsWith('audio/')) return 'audio';
  if (mediaType.startsWith('video/')) return 'video';
  if (mediaType.startsWith('text/') || mediaType === 'application/json') return 'text';
  return 'other';
}

const previewableUserFileMediaTypes = new Set([
  'application/pdf',
  'application/json',
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'video/mp4',
  'video/ogg',
  'video/webm',
  'text/csv',
  'text/markdown',
  'text/plain',
]);

export function canPreviewUserFileAttachment(mediaType: string): boolean {
  return previewableUserFileMediaTypes.has(mediaType.trim().toLowerCase());
}

export function formatUserFileAttachmentByteLength(length: number): string {
  if (length < 1024) return `${length} B`;
  if (length < 1024 * 1024) return `${(length / 1024).toFixed(length < 10 * 1024 ? 1 : 0)} KB`;
  return `${(length / (1024 * 1024)).toFixed(length < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function suggestUniqueUserFileAttachmentName(document: VisualDocument, requestedName: string): string {
  const baseName = requireUserFileAttachmentName(requestedName);
  if (!hasUserFileAttachmentName(document, baseName)) {
    return baseName;
  }
  let suffix = 2;
  while (hasUserFileAttachmentName(document, `${baseName} ${suffix}`)) {
    suffix += 1;
  }
  return `${baseName} ${suffix}`;
}

export function createUniqueUserFileAttachmentId(document: VisualDocument, reservedIds: string[] = []): string {
  return createUserFileAttachmentId([
    ...ensureDocumentAttachmentStore(document).listDescriptors().map((entry) => entry.id),
    ...reservedIds,
  ]);
}

export async function storeUserFileAttachment(
  document: VisualDocument,
  request: StoreUserFileAttachmentRequest,
  host?: HvyAttachmentHostAdapter | null,
  limits?: UserFileAttachmentLimits | null,
): Promise<UserFileAttachmentDescriptor> {
  const name = requireUserFileAttachmentName(request.name);
  const filename = requireUserFileAttachmentFilename(request.filename);
  if (hasUserFileAttachmentName(document, name)) {
    throw new Error(`A document attachment named "${name}" already exists.`);
  }
  validateUserFileAttachmentLimits(document, request.bytes.length, limits);
  const store = ensureDocumentAttachmentStore(document);
  const id = request.id ?? createUserFileAttachmentId(store.listDescriptors().map((entry) => entry.id));
  if (store.getDescriptor(id)) {
    throw new Error(`A document attachment with id "${id}" already exists.`);
  }
  const meta = canonicalUserFileAttachmentMeta(request.meta, name, filename, request.mediaType);
  const stored = await host?.store(id, request.bytes, meta);
  const storedMeta = stored && typeof stored === 'object'
    ? canonicalUserFileAttachmentMeta(stored.meta, name, filename, request.mediaType)
    : meta;
  store.set(id, storedMeta, request.bytes);
  return userFileDescriptorFromMeta(id, storedMeta, request.bytes.length)!;
}

export async function replaceUserFileAttachment(
  document: VisualDocument,
  id: string,
  request: Pick<StoreUserFileAttachmentRequest, 'filename' | 'mediaType' | 'bytes' | 'meta'>,
  host?: HvyAttachmentHostAdapter | null,
  limits?: UserFileAttachmentLimits | null,
): Promise<UserFileAttachmentDescriptor> {
  const store = ensureDocumentAttachmentStore(document);
  const existing = store.getDescriptor(id);
  const current = existing ? userFileDescriptorFromMeta(existing.id, existing.meta, existing.length) : null;
  if (!current) {
    throw new Error(`Document attachment "${id}" does not exist.`);
  }
  validateUserFileAttachmentLimits(document, request.bytes.length, limits, id);
  const filename = requireUserFileAttachmentFilename(request.filename);
  const meta = canonicalUserFileAttachmentMeta(
    { ...current.meta, ...(request.meta ?? {}) },
    current.name,
    filename,
    request.mediaType,
  );
  const stored = await host?.store(id, request.bytes, meta);
  const storedMeta = stored && typeof stored === 'object'
    ? canonicalUserFileAttachmentMeta(stored.meta, current.name, filename, request.mediaType)
    : meta;
  store.set(id, storedMeta, request.bytes);
  return userFileDescriptorFromMeta(id, storedMeta, request.bytes.length)!;
}

function validateUserFileAttachmentLimits(
  document: VisualDocument,
  byteLength: number,
  limits?: UserFileAttachmentLimits | null,
  replacedId?: string,
): void {
  if (!limits) return;
  const maxFileBytes = normalizeAttachmentLimit(limits.maxFileBytes, 'maxFileBytes');
  const maxTotalBytes = normalizeAttachmentLimit(limits.maxTotalBytes, 'maxTotalBytes');
  if (maxFileBytes !== null && byteLength > maxFileBytes) {
    throw new Error(`Attachment is ${byteLength} bytes; the per-file limit is ${maxFileBytes} bytes.`);
  }
  const currentTotal = listUserFileAttachments(document).reduce(
    (total, attachment) => total + (attachment.id === replacedId ? 0 : attachment.length),
    0,
  );
  if (maxTotalBytes !== null && currentTotal + byteLength > maxTotalBytes) {
    throw new Error(`Attachments would total ${currentTotal + byteLength} bytes; the document limit is ${maxTotalBytes} bytes.`);
  }
}

function normalizeAttachmentLimit(value: number | undefined, name: string): number | null {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Attachment limit ${name} must be a non-negative safe integer.`);
  }
  return value;
}

export function countUserFileAttachmentReferences(document: VisualDocument, name: string): number {
  const normalizedName = normalizeUserFileAttachmentName(name);
  let count = 0;
  visitDocumentMarkdown(document, (markdown) => {
    for (const target of findUserFileAttachmentTargets(markdown)) {
      const decoded = decodeUserFileAttachmentTarget(target);
      if (decoded && normalizeUserFileAttachmentName(decoded) === normalizedName) {
        count += 1;
      }
    }
    return markdown;
  });
  return count;
}

export async function renameUserFileAttachment(
  document: VisualDocument,
  id: string,
  nextNameInput: string,
  host?: HvyAttachmentHostAdapter | null,
): Promise<RenameUserFileAttachmentResult> {
  const nextName = requireUserFileAttachmentName(nextNameInput);
  const store = ensureDocumentAttachmentStore(document);
  const existing = store.getDescriptor(id);
  const current = existing ? userFileDescriptorFromMeta(existing.id, existing.meta, existing.length) : null;
  if (!current) {
    throw new Error(`Document attachment "${id}" does not exist.`);
  }
  if (hasUserFileAttachmentName(document, nextName, id)) {
    throw new Error(`A document attachment named "${nextName}" already exists.`);
  }
  if (normalizeUserFileAttachmentName(current.name) === normalizeUserFileAttachmentName(nextName)
    && current.name === nextName) {
    return { attachment: current, referencesUpdated: 0 };
  }
  const nextMeta = { ...current.meta, name: nextName };
  if (host) {
    const recalled = await host.recall(id);
    if (recalled === null) {
      throw new Error(`Document attachment "${current.name}" could not be recalled for rename.`);
    }
    const bytes = await normalizeAttachmentBytes(recalled);
    const stored = await host.store(id, bytes, nextMeta);
    store.set(id, stored && typeof stored === 'object' ? { ...stored.meta, ...nextMeta } : nextMeta, bytes);
  } else {
    store.mergeDescriptorMeta(id, nextMeta);
  }
  const previousTargetName = normalizeUserFileAttachmentName(current.name);
  const nextTarget = encodeUserFileAttachmentTarget(nextName);
  let referencesUpdated = 0;
  visitDocumentMarkdown(document, (markdown) => markdown.replace(
    /@attachment:[^\s)>]+/g,
    (target) => {
      const decoded = decodeUserFileAttachmentTarget(target);
      if (!decoded || normalizeUserFileAttachmentName(decoded) !== previousTargetName) {
        return target;
      }
      referencesUpdated += 1;
      return nextTarget;
    },
  ));
  return {
    attachment: userFileDescriptorFromMeta(id, nextMeta, current.length)!,
    referencesUpdated,
  };
}

export async function removeUserFileAttachment(
  document: VisualDocument,
  id: string,
  host?: HvyAttachmentHostAdapter | null,
): Promise<void> {
  const store = ensureDocumentAttachmentStore(document);
  const existing = store.getDescriptor(id);
  if (!existing || !userFileDescriptorFromMeta(existing.id, existing.meta, existing.length)) {
    throw new Error(`Document attachment "${id}" does not exist.`);
  }
  await host?.remove(id);
  store.remove(id);
}

function userFileDescriptorFromMeta(
  id: string,
  meta: JsonObject,
  length: number,
): UserFileAttachmentDescriptor | null {
  if (meta.role !== USER_FILE_ATTACHMENT_ROLE
    || typeof meta.name !== 'string'
    || !meta.name.trim()
    || typeof meta.filename !== 'string'
    || !meta.filename.trim()) {
    return null;
  }
  return {
    id,
    name: meta.name,
    filename: meta.filename,
    mediaType: typeof meta.mediaType === 'string' && meta.mediaType.trim()
      ? meta.mediaType
      : 'application/octet-stream',
    length,
    meta,
  };
}

function canonicalUserFileAttachmentMeta(
  input: JsonObject | undefined,
  name: string,
  filename: string,
  mediaType: string,
): JsonObject {
  return {
    ...(input ?? {}),
    role: USER_FILE_ATTACHMENT_ROLE,
    name,
    filename,
    mediaType: mediaType.trim() || 'application/octet-stream',
  };
}

function requireUserFileAttachmentName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Document attachment name is required.');
  }
  return trimmed;
}

function requireUserFileAttachmentFilename(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) {
    throw new Error('Document attachment filename is required.');
  }
  return trimmed;
}

function createUserFileAttachmentId(existingIds: string[]): string {
  const existing = new Set(existingIds);
  let id = `${USER_FILE_ATTACHMENT_ID_PREFIX}${crypto.randomUUID()}`;
  while (existing.has(id)) {
    id = `${USER_FILE_ATTACHMENT_ID_PREFIX}${crypto.randomUUID()}`;
  }
  return id;
}

function findUserFileAttachmentTargets(markdown: string): string[] {
  return markdown.match(/@attachment:[^\s)>]+/g) ?? [];
}

function visitDocumentMarkdown(document: VisualDocument, visitor: (markdown: string) => string): void {
  const visitBlock = (block: Parameters<Parameters<typeof visitBlocks>[1]>[0]) => {
    block.text = visitor(block.text);
    block.schema.tableColumns = (block.schema.tableColumns ?? []).map(visitor);
    (block.schema.tableRows ?? []).forEach((row) => {
      row.cells = row.cells.map(visitor);
    });
    if (block.schema.caption) {
      block.schema.caption.text = visitor(block.schema.caption.text);
    }
  };
  visitBlocks(document.sections, visitBlock);
  getComponentDefsFromMeta(document.meta).forEach((definition) => {
    if (definition.template) visitBlocksInList([definition.template], visitBlock);
    if (definition.schema) visitComponentDefinitionSchema(definition.schema, visitor, visitBlock);
    definition.flavors?.forEach((flavor) => {
      if (flavor.template) visitBlocksInList([flavor.template], visitBlock);
      if (flavor.schema) visitComponentDefinitionSchema(flavor.schema, visitor, visitBlock);
    });
  });
  getSectionDefsFromMeta(document.meta).forEach((definition) => {
    visitBlocks([definition.template], visitBlock);
    definition.flavors?.forEach((flavor) => visitBlocks([flavor.template], visitBlock));
  });
}

function visitComponentDefinitionSchema(
  schema: BlockSchema,
  visitor: (markdown: string) => string,
  visitBlock: (block: Parameters<Parameters<typeof visitBlocks>[1]>[0]) => void,
): void {
  schema.tableColumns = (schema.tableColumns ?? []).map(visitor);
  (schema.tableRows ?? []).forEach((row) => {
    row.cells = row.cells.map(visitor);
  });
  if (schema.caption) schema.caption.text = visitor(schema.caption.text);
  visitBlocksInList([
    ...(schema.containerBlocks ?? []),
    ...(schema.componentListBlocks ?? []),
    ...(schema.gridItems ?? []).map((item) => item.block),
    ...(schema.expandableStubBlocks?.children ?? []),
    ...(schema.expandableContentBlocks?.children ?? []),
  ], visitBlock);
}
