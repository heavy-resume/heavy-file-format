import {
  createDocumentChangeApi,
  type HvyDocumentChangeApi,
} from './document-change';
import { getActiveStateRuntime } from './state';

let dirty = false;
let documentChangeApi: HvyDocumentChangeApi | null = null;

export function initializeReferenceDocumentDirtyTracking(): void {
  const runtime = getActiveStateRuntime();
  dirty = false;
  documentChangeApi = createDocumentChangeApi(runtime, (event) => {
    dirty = event.dirty;
    updateReferenceDocumentDirtyIndicators();
  });
}

export function resetReferenceDocumentDirtyBaseline(): void {
  initializeReferenceDocumentDirtyTracking();
  updateReferenceDocumentDirtyIndicators();
}

export function markReferenceDocumentSaved(): void {
  documentChangeApi?.markSaved();
  dirty = documentChangeApi?.isDirty() ?? false;
  updateReferenceDocumentDirtyIndicators();
}

export function renderReferenceDocumentDirtyIndicator(): string {
  return `<span class="reference-save-state ${dirty ? 'is-unsaved' : 'is-saved'}" data-reference-save-state="${dirty ? 'unsaved' : 'saved'}" role="status">${dirty ? 'Unsaved' : 'Saved'}</span>`;
}

function updateReferenceDocumentDirtyIndicators(): void {
  document.querySelectorAll<HTMLElement>('[data-reference-save-state]').forEach((indicator) => {
    indicator.dataset.referenceSaveState = dirty ? 'unsaved' : 'saved';
    indicator.classList.toggle('is-unsaved', dirty);
    indicator.classList.toggle('is-saved', !dirty);
    indicator.textContent = dirty ? 'Unsaved' : 'Saved';
  });
}
