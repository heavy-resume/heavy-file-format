import { canPreviewUserFileAttachment, resolveUserFileAttachment, USER_FILE_LINK_PREFIX } from './document-attachments';
import { performUserFileAttachmentAction } from './document-attachment-actions';
import { state } from './state';
import type { VisualDocument } from './types';

const boundRoots = new WeakSet<HTMLElement>();

export function renderUserFileAttachmentLinksInHtml(html: string, document: VisualDocument): string {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return html.replace(/<a\b([^>]*?)\bhref="(@attachment:[^"]*)"([^>]*)>/g, (_match, before, target, after) =>
      renderAttachmentAnchorWithoutDom(before, decodeHtmlAttribute(target), after, document)
    );
  }
  const template = window.document.createElement('template');
  template.innerHTML = html;
  applyUserFileAttachmentLinkRendering(template.content, document);
  return template.innerHTML;
}

export function applyUserFileAttachmentLinkRendering(root: ParentNode, document: VisualDocument): void {
  root.querySelectorAll<HTMLAnchorElement>(`a[href^="${USER_FILE_LINK_PREFIX}"]`).forEach((anchor) => {
    const target = anchor.getAttribute('href')?.trim() ?? '';
    const resolution = resolveUserFileAttachment(document, target);
    anchor.dataset.hvyLinkKind = 'attachment';
    anchor.dataset.hvyAttachmentTarget = target;
    anchor.removeAttribute('target');
    anchor.removeAttribute('rel');
    if (resolution.status !== 'resolved') {
      anchor.removeAttribute('href');
      anchor.setAttribute('aria-disabled', 'true');
      anchor.classList.add('hvy-attachment-link-missing');
      anchor.title = resolution.status === 'ambiguous' ? 'Attachment name is ambiguous' : 'Attachment is missing';
      return;
    }
    anchor.dataset.hvyAttachmentId = resolution.attachment.id;
    anchor.dataset.hvyAttachmentAction = canPreviewUserFileAttachment(resolution.attachment.mediaType) ? 'preview' : 'download';
    anchor.title = `${anchor.dataset.hvyAttachmentAction === 'preview' ? 'View' : 'Download'} ${resolution.attachment.name}`;
  });
}

export function bindUserFileAttachmentLinks(app: HTMLElement): void {
  if (boundRoots.has(app)) return;
  boundRoots.add(app);
  const getAttachmentLink = (target: EventTarget | null): HTMLAnchorElement | null => {
    const link = target instanceof Element ? target.closest<HTMLAnchorElement>('[data-hvy-attachment-id]') : null;
    return link && app.contains(link) ? link : null;
  };
  const activate = (link: HTMLAnchorElement): void => {
    const resolution = resolveUserFileAttachment(state.document, link.dataset.hvyAttachmentTarget ?? '');
    if (resolution.status !== 'resolved') return;
    const action = link.dataset.hvyAttachmentAction === 'download' ? 'download' : 'preview';
    void performUserFileAttachmentAction(
      state.document,
      resolution.attachment,
      action,
      state.attachmentHost,
      state.attachmentAction,
    ).catch(() => undefined);
  };
  app.addEventListener('click', (event) => {
    const link = getAttachmentLink(event.target);
    if (!link) return;
    event.preventDefault();
    if (state.currentView === 'editor') return;
    activate(link);
    event.stopPropagation();
  }, true);
  app.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const link = getAttachmentLink(event.target);
    if (!link) return;
    event.preventDefault();
    if (state.currentView === 'editor') return;
    activate(link);
    event.stopPropagation();
  }, true);
}

function renderAttachmentAnchorWithoutDom(before: string, target: string, after: string, document: VisualDocument): string {
  const resolution = resolveUserFileAttachment(document, target);
  const attrs = `${before}${after}`.replace(/\s(?:class|target|rel|href|aria-disabled|title|data-hvy-link-kind|data-hvy-attachment-[\w-]+)="[^"]*"/g, '');
  if (resolution.status !== 'resolved') {
    return `<a${attrs} data-hvy-link-kind="attachment" data-hvy-attachment-target="${escapeAttribute(target)}" aria-disabled="true" class="${mergeClass(attrs, 'hvy-attachment-link-missing')}">`;
  }
  const action = canPreviewUserFileAttachment(resolution.attachment.mediaType) ? 'preview' : 'download';
  return `<a${attrs} href="${escapeAttribute(target)}" data-hvy-link-kind="attachment" data-hvy-attachment-target="${escapeAttribute(target)}" data-hvy-attachment-id="${escapeAttribute(resolution.attachment.id)}" data-hvy-attachment-action="${action}">`;
}

function decodeHtmlAttribute(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mergeClass(attrs: string, className: string): string {
  const current = attrs.match(/\bclass="([^"]*)"/)?.[1] ?? '';
  return `${current} ${className}`.trim();
}
