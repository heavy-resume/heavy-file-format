import type { VisualDocument } from '../types';
import { serializeDocumentBytes } from '../serialization';
import { getActiveStateRuntime, type StateRuntime } from '../state';
import { getHvyPdfBlob } from '../pdf-export/export';
import { getActivePdfArtifactCache, releasePdfArtifactCache } from './pdf-artifact-cache';

export const PDF_PREVIEW_ROOT_ATTRIBUTE = 'data-hvy-pdf-preview';

export function renderPdfPreviewPlaceholder(): string {
  return `<div ${PDF_PREVIEW_ROOT_ATTRIBUTE}="true" class="hvy-pdf-preview" aria-live="polite">
    <div class="hvy-pdf-preview-status" role="status">
      <span class="hvy-pdf-preview-spinner" aria-hidden="true"></span>
      <span>Rendering PDF...</span>
    </div>
  </div>`;
}

export class HvyPdfPreviewController {
  private active = false;
  private sessionSignature: Uint8Array | null = null;
  private sessionDocument: VisualDocument | null = null;
  private sessionArtifact: Promise<Blob> | null = null;
  private previewUrl: string | null = null;
  private target: HTMLElement | null = null;
  private mountGeneration = 0;
  private stale = false;

  sync(target: HTMLElement | null, document: VisualDocument, active: boolean): void {
    if (!active || !target) {
      this.leave();
      return;
    }

    const signature = serializeDocumentBytes(document);
    if (!this.active) {
      this.active = true;
      this.sessionSignature = signature;
      this.sessionDocument = document;
      this.sessionArtifact = getHvyPdfBlob(document);
      this.stale = false;
    } else if (this.sessionSignature && !bytesEqual(this.sessionSignature, signature)) {
      this.stale = true;
    }

    if (target === this.target) {
      this.renderStaleNotice(target);
      return;
    }
    this.mount(target);
  }

  leave(): void {
    if (!this.active && !this.previewUrl && !this.target) return;
    this.active = false;
    this.sessionSignature = null;
    this.sessionDocument = null;
    this.sessionArtifact = null;
    this.stale = false;
    this.mountGeneration += 1;
    this.revokePreviewUrl();
    this.target = null;
  }

  destroy(): void {
    this.leave();
  }

  private mount(target: HTMLElement): void {
    this.mountGeneration += 1;
    const generation = this.mountGeneration;
    this.revokePreviewUrl();
    this.target = target;
    this.renderLoading(target);
    const artifact = this.sessionArtifact;
    if (!artifact) return;

    void artifact.then((blob) => {
      if (!this.isCurrentMount(target, generation)) return;
      const previewUrl = URL.createObjectURL(blob);
      if (!this.isCurrentMount(target, generation)) {
        URL.revokeObjectURL(previewUrl);
        return;
      }
      this.previewUrl = previewUrl;
      const frame = document.createElement('iframe');
      frame.className = 'hvy-pdf-native-frame';
      frame.title = 'PDF preview';
      frame.src = `${previewUrl}#toolbar=0&navpanes=0`;
      frame.addEventListener('load', () => {
        if (!this.isCurrentMount(target, generation)) return;
        target.dispatchEvent(new CustomEvent('hvy-pdf-preview-ready', { bubbles: true }));
      }, { once: true });
      target.replaceChildren(frame);
      this.renderStaleNotice(target);
    }).catch((error: unknown) => {
      if (!this.isCurrentMount(target, generation)) return;
      this.renderError(target, error);
    });
  }

  private renderLoading(target: HTMLElement): void {
    target.classList.add('hvy-pdf-preview');
    target.setAttribute('aria-live', 'polite');
    target.innerHTML = `<div class="hvy-pdf-preview-status" role="status">
      <span class="hvy-pdf-preview-spinner" aria-hidden="true"></span>
      <span>Rendering PDF...</span>
    </div>`;
  }

  private renderError(target: HTMLElement, error: unknown): void {
    const message = error instanceof Error ? error.message : 'The PDF preview could not be rendered.';
    target.innerHTML = `<div class="hvy-pdf-preview-status is-error" role="alert">
      <strong>PDF preview failed</strong>
      <span>${escapeHtml(message)}</span>
      <button type="button" class="hvy-button secondary" data-action="retry-pdf-preview">Retry</button>
    </div>`;
    target.querySelector<HTMLButtonElement>('[data-action="retry-pdf-preview"]')?.addEventListener('click', () => {
      const document = this.sessionDocument;
      if (!document || !this.active) return;
      getActivePdfArtifactCache().invalidate(document);
      this.sessionSignature = serializeDocumentBytes(document);
      this.sessionArtifact = getHvyPdfBlob(document);
      this.stale = false;
      this.mount(target);
    }, { once: true });
  }

  private renderStaleNotice(target: HTMLElement): void {
    target.querySelector('[data-hvy-pdf-preview-stale]')?.remove();
    if (!this.stale) return;
    const notice = document.createElement('div');
    notice.className = 'hvy-pdf-preview-stale';
    notice.dataset.hvyPdfPreviewStale = 'true';
    notice.setAttribute('role', 'status');
    notice.textContent = 'Preview is out of date. Reopen Viewer to render the latest document.';
    target.prepend(notice);
  }

  private isCurrentMount(target: HTMLElement, generation: number): boolean {
    return this.active && this.target === target && this.mountGeneration === generation && target.isConnected;
  }

  private revokePreviewUrl(): void {
    if (!this.previewUrl) return;
    URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = null;
  }
}

const previewControllersByRuntime = new WeakMap<StateRuntime, HvyPdfPreviewController>();
let standalonePreviewController = new HvyPdfPreviewController();

export function syncActivePdfPreview(root: ParentNode, document: VisualDocument, active: boolean): void {
  getActivePdfPreviewController().sync(
    root.querySelector<HTMLElement>(`[${PDF_PREVIEW_ROOT_ATTRIBUTE}="true"]`),
    document,
    active
  );
}

export function releasePdfPreviewRuntime(runtime: StateRuntime): void {
  previewControllersByRuntime.get(runtime)?.destroy();
  previewControllersByRuntime.delete(runtime);
  releasePdfArtifactCache(runtime);
}

export function resetStandalonePdfPreviewControllerForTests(): void {
  standalonePreviewController.destroy();
  standalonePreviewController = new HvyPdfPreviewController();
}

function getActivePdfPreviewController(): HvyPdfPreviewController {
  let runtime: StateRuntime;
  try {
    runtime = getActiveStateRuntime();
  } catch {
    return standalonePreviewController;
  }
  let controller = previewControllersByRuntime.get(runtime);
  if (!controller) {
    controller = new HvyPdfPreviewController();
    previewControllersByRuntime.set(runtime, controller);
  }
  return controller;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
