import { DB_ATTACHMENT_ID } from './attachments';
import type { HvyAttachmentDescriptor, HvyAttachmentHostAdapter } from './attachment-store';
import { ensureDocumentAttachmentStore, getAttachmentDescriptors } from './attachment-store';
import { getComponentDefsFromMeta, getSectionDefsFromMeta } from './component-defs';
import { decodeUserFileAttachmentTarget, normalizeUserFileAttachmentName, USER_FILE_ATTACHMENT_ROLE } from './document-attachments';
import type { VisualBlock } from './editor/types';
import { visitBlocks, visitBlocksInList } from './section-ops';
import type { VisualDocument } from './types';

export type UnusedEmbeddedFileKind = 'document-file' | 'image' | 'model-3d';

export interface UnusedEmbeddedFile extends HvyAttachmentDescriptor {
  kind: UnusedEmbeddedFileKind;
}

export interface EmbeddedFileUsage {
  /** Removable attachments that authored content does not reference. */
  unused: UnusedEmbeddedFile[];
  /** Reference count per attachment id, from one read-only pass over the document. */
  referenceCounts: ReadonlyMap<string, number>;
}

/** Returns removable file attachments that are not referenced by authored document content. */
export function findUnusedEmbeddedFiles(document: VisualDocument): UnusedEmbeddedFile[] {
  return getEmbeddedFileUsage(document).unused;
}

export function getEmbeddedFileUsage(document: VisualDocument): EmbeddedFileUsage {
  const referenceCounts = collectEmbeddedFileReferences(document);
  const unused = getAttachmentDescriptors(document).flatMap((descriptor) => {
    const kind = getPurgeableFileKind(descriptor);
    return kind && !referenceCounts.has(descriptor.id) ? [{ ...descriptor, kind }] : [];
  });
  return { unused, referenceCounts };
}

let cachedEmbeddedFileUsage: {
  document: VisualDocument;
  attachmentStoreVersion: number;
  componentDefs: unknown;
  sectionDefs: unknown;
  usage: EmbeddedFileUsage;
} | null = null;

/**
 * Display-only usage, reused until the document, its attachments, or its template
 * definitions are replaced. In-place block edits are not detected, so callers drop
 * the cache when leaving the surface that shows it. Deletion must not rely on this;
 * `deleteUnusedEmbeddedFiles` re-checks against a fresh pass.
 */
export function getCachedEmbeddedFileUsage(document: VisualDocument): EmbeddedFileUsage {
  const attachmentStoreVersion = ensureDocumentAttachmentStore(document).getVersion();
  const componentDefs = document.meta.component_defs;
  const sectionDefs = document.meta.section_defs;
  if (
    cachedEmbeddedFileUsage
    && cachedEmbeddedFileUsage.document === document
    && cachedEmbeddedFileUsage.attachmentStoreVersion === attachmentStoreVersion
    && cachedEmbeddedFileUsage.componentDefs === componentDefs
    && cachedEmbeddedFileUsage.sectionDefs === sectionDefs
  ) {
    return cachedEmbeddedFileUsage.usage;
  }
  const usage = getEmbeddedFileUsage(document);
  cachedEmbeddedFileUsage = { document, attachmentStoreVersion, componentDefs, sectionDefs, usage };
  return usage;
}

export function clearCachedEmbeddedFileUsage(): void {
  cachedEmbeddedFileUsage = null;
}

/** Removes the current unused-file set from both the host attachment store and the document. */
export async function purgeUnusedEmbeddedFiles(
  document: VisualDocument,
  host?: HvyAttachmentHostAdapter | null,
): Promise<UnusedEmbeddedFile[]> {
  const unused = findUnusedEmbeddedFiles(document);
  return deleteUnusedEmbeddedFiles(document, unused, host);
}

/** Deletes a reviewed unused-file set, skipping anything that became referenced meanwhile. */
export async function deleteUnusedEmbeddedFiles(
  document: VisualDocument,
  reviewedFiles: readonly UnusedEmbeddedFile[],
  host?: HvyAttachmentHostAdapter | null,
): Promise<UnusedEmbeddedFile[]> {
  const stillUnused = new Map(findUnusedEmbeddedFiles(document).map((attachment) => [attachment.id, attachment]));
  const unused = reviewedFiles.flatMap((attachment) => stillUnused.has(attachment.id) ? [attachment] : []);
  const store = ensureDocumentAttachmentStore(document);
  for (const attachment of unused) {
    await host?.remove(attachment.id);
    store.remove(attachment.id);
  }
  return unused;
}

/** SQLite is unused only when a database is attached and no authored component targets it. */
export function isEmbeddedSqliteDatabaseUnused(document: VisualDocument): boolean {
  if (!getAttachmentDescriptors(document).some((attachment) => attachment.id === DB_ATTACHMENT_ID)) return false;
  let used = false;
  visitAllDocumentBlocks(document, (block) => {
    if (block.schema.component !== 'plugin') return;
    if (block.schema.plugin === 'hvy.db-table') {
      const source = typeof block.schema.pluginConfig.source === 'string'
        ? block.schema.pluginConfig.source.trim()
        : 'with-file';
      if (!source || source === 'with-file') used = true;
    }
    if (block.schema.pluginConfig.source === 'with-file') used = true;
  });
  return !used;
}

/** Deletes an attached SQLite database after verifying that no authored component uses it. */
export async function deleteUnusedEmbeddedSqliteDatabase(
  document: VisualDocument,
  host?: HvyAttachmentHostAdapter | null,
): Promise<boolean> {
  if (!isEmbeddedSqliteDatabaseUnused(document)) return false;
  await host?.remove(DB_ATTACHMENT_ID);
  ensureDocumentAttachmentStore(document).remove(DB_ATTACHMENT_ID);
  return true;
}

function collectEmbeddedFileReferences(document: VisualDocument): Map<string, number> {
  const references = new Map<string, number>();
  const addReference = (id: string): void => {
    references.set(id, (references.get(id) ?? 0) + 1);
  };
  const namedFiles = getAttachmentDescriptors(document).filter((entry) => entry.meta.role === USER_FILE_ATTACHMENT_ROLE);
  const names = new Map<string, string[]>();
  for (const entry of namedFiles) {
    if (typeof entry.meta.name !== 'string') continue;
    const name = normalizeUserFileAttachmentName(entry.meta.name);
    names.set(name, [...(names.get(name) ?? []), entry.id]);
  }
  const collectNamedFileLinks = (markdown: string): void => {
    for (const target of markdown.match(/@attachment:[^\s)>]+/g) ?? []) {
      const name = decodeUserFileAttachmentTarget(target);
      const ids = name ? names.get(normalizeUserFileAttachmentName(name)) : null;
      for (const id of ids ?? []) addReference(id);
    }
  };
  visitAllDocumentBlocks(document, (block) => {
    if (block.schema.imageFile) addReference(`image:${block.schema.imageFile}`);
    for (const image of block.schema.carouselImages ?? []) addReference(`image:${image.imageFile}`);
    if (block.schema.plugin === 'hvy.model-3d') {
      const modelFile = block.schema.pluginConfig.modelFile;
      if (typeof modelFile === 'string' && modelFile.trim()) addReference(`model-3d:${modelFile.trim()}`);
    }
    if (block.schema.encryptedAttachmentId) addReference(block.schema.encryptedAttachmentId);
    collectNamedFileLinks(block.text);
    for (const column of block.schema.tableColumns ?? []) collectNamedFileLinks(column);
    for (const row of block.schema.tableRows ?? []) {
      for (const cell of row.cells) collectNamedFileLinks(cell);
    }
    if (block.schema.caption) collectNamedFileLinks(block.schema.caption.text);
  });
  return references;
}

function getPurgeableFileKind(descriptor: HvyAttachmentDescriptor): UnusedEmbeddedFileKind | null {
  if (descriptor.id === DB_ATTACHMENT_ID) return null;
  if (descriptor.meta.role === USER_FILE_ATTACHMENT_ROLE) return 'document-file';
  if (descriptor.id.startsWith('image:')) return 'image';
  if (descriptor.id.startsWith('model-3d:')) return 'model-3d';
  return null;
}

function visitAllDocumentBlocks(document: VisualDocument, visitor: (block: VisualBlock) => void): void {
  visitBlocks(document.sections, visitor);
  // Template blocks are stored as authored in the header, where `text` is optional
  // and defaults to empty (HVY-SPEC 5.9). Visit them with that default applied.
  const visitTemplateBlock = (block: VisualBlock): void => visitor(typeof block.text === 'string' ? block : { ...block, text: '' });
  for (const definition of getComponentDefsFromMeta(document.meta)) {
    if (definition.template) visitBlocksInList([definition.template], visitTemplateBlock);
    if (definition.schema) visitSchema(definition.schema, visitTemplateBlock);
    for (const flavor of definition.flavors ?? []) {
      if (flavor.template) visitBlocksInList([flavor.template], visitTemplateBlock);
      if (flavor.schema) visitSchema(flavor.schema, visitTemplateBlock);
    }
  }
  for (const definition of getSectionDefsFromMeta(document.meta)) {
    visitBlocks([definition.template], visitTemplateBlock);
    for (const flavor of definition.flavors ?? []) visitBlocks([flavor.template], visitTemplateBlock);
  }
}

function visitSchema(schema: VisualBlock['schema'], visitor: (block: VisualBlock) => void): void {
  visitor({ text: '', schema } as VisualBlock);
  visitBlocksInList(schemaChildren(schema), visitor);
}

function schemaChildren(schema: VisualBlock['schema']): VisualBlock[] {
  return [
    ...(schema.containerBlocks ?? []),
    ...(schema.componentListBlocks ?? []),
    ...(schema.gridItems ?? []).map((item) => item.block),
    ...(schema.expandableStubBlocks?.children ?? []),
    ...(schema.expandableContentBlocks?.children ?? []),
  ];
}
