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

/** Returns removable file attachments that are not referenced by authored document content. */
export function findUnusedEmbeddedFiles(document: VisualDocument): UnusedEmbeddedFile[] {
  const references = collectEmbeddedFileReferences(document);
  return getAttachmentDescriptors(document).flatMap((descriptor) => {
    const kind = getPurgeableFileKind(descriptor);
    return kind && !references.has(descriptor.id) ? [{ ...descriptor, kind }] : [];
  });
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

function collectEmbeddedFileReferences(document: VisualDocument): Set<string> {
  const references = new Set<string>();
  const namedFiles = getAttachmentDescriptors(document).filter((entry) => entry.meta.role === USER_FILE_ATTACHMENT_ROLE);
  const names = new Map<string, string[]>();
  for (const entry of namedFiles) {
    if (typeof entry.meta.name !== 'string') continue;
    const name = normalizeUserFileAttachmentName(entry.meta.name);
    names.set(name, [...(names.get(name) ?? []), entry.id]);
  }
  visitAllDocumentBlocks(document, (block) => {
    if (block.schema.imageFile) references.add(`image:${block.schema.imageFile}`);
    for (const image of block.schema.carouselImages ?? []) references.add(`image:${image.imageFile}`);
    if (block.schema.plugin === 'hvy.model-3d') {
      const modelFile = block.schema.pluginConfig.modelFile;
      if (typeof modelFile === 'string' && modelFile.trim()) references.add(`model-3d:${modelFile.trim()}`);
    }
    if (block.schema.encryptedAttachmentId) references.add(block.schema.encryptedAttachmentId);
    collectNamedFileLinks(block.text, names, references);
    for (const column of block.schema.tableColumns ?? []) collectNamedFileLinks(column, names, references);
    for (const row of block.schema.tableRows ?? []) {
      for (const cell of row.cells) collectNamedFileLinks(cell, names, references);
    }
    if (block.schema.caption) collectNamedFileLinks(block.schema.caption.text, names, references);
  });
  return references;
}

function collectNamedFileLinks(markdown: string, names: Map<string, string[]>, references: Set<string>): void {
  for (const target of markdown.match(/@attachment:[^\s)>]+/g) ?? []) {
    const name = decodeUserFileAttachmentTarget(target);
    const ids = name ? names.get(normalizeUserFileAttachmentName(name)) : null;
    for (const id of ids ?? []) references.add(id);
  }
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
  for (const definition of getComponentDefsFromMeta(document.meta)) {
    if (definition.template) visitBlocksInList([definition.template], visitor);
    if (definition.schema) visitSchema(definition.schema, visitor);
    for (const flavor of definition.flavors ?? []) {
      if (flavor.template) visitBlocksInList([flavor.template], visitor);
      if (flavor.schema) visitSchema(flavor.schema, visitor);
    }
  }
  for (const definition of getSectionDefsFromMeta(document.meta)) {
    visitBlocks([definition.template], visitor);
    for (const flavor of definition.flavors ?? []) visitBlocks([flavor.template], visitor);
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
