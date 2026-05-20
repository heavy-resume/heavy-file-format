import DOMPurify from 'dompurify';

export interface HvyLinkObserverRequest {
  href: string;
  text: string;
  html: string;
  attributes: Record<string, string>;
  external: boolean;
}

export interface HvyLinkObserverResponse {
  href?: string | null;
  text?: string | null;
  html?: string | null;
  title?: string | null;
  target?: string | null;
  rel?: string | null;
  attributes?: Record<string, string | null | undefined>;
}

export type HvyLinkObserver = (
  request: HvyLinkObserverRequest
) => HvyLinkObserverResponse | null | undefined | false | Promise<HvyLinkObserverResponse | null | undefined | false>;

const LINK_OBSERVED_ATTR = 'data-hvy-link-observed';
const LINK_SURFACE_SELECTOR = '.hvy-reader-surface, .hvy-link-observer-surface';

export function observeRenderedLinks(root: ParentNode, observer: HvyLinkObserver | null | undefined): void {
  if (!observer) {
    return;
  }
  const anchors = [...root.querySelectorAll<HTMLAnchorElement>(`:is(${LINK_SURFACE_SELECTOR}) a[href]:not([${LINK_OBSERVED_ATTR}])`)]
    .filter((anchor) => !anchor.closest('[contenteditable="true"]'));
  anchors.forEach((anchor) => {
    anchor.setAttribute(LINK_OBSERVED_ATTR, 'pending');
    void applyLinkObserver(anchor, observer);
  });
}

export function resetObservedLinks(root: ParentNode): void {
  root.querySelectorAll<HTMLAnchorElement>(`:is(${LINK_SURFACE_SELECTOR}) a[${LINK_OBSERVED_ATTR}]`).forEach((anchor) => {
    anchor.removeAttribute(LINK_OBSERVED_ATTR);
  });
}

async function applyLinkObserver(anchor: HTMLAnchorElement, observer: HvyLinkObserver): Promise<void> {
  const originalHref = anchor.getAttribute('href') ?? '';
  const request = buildLinkObserverRequest(anchor, originalHref);
  let response: HvyLinkObserverResponse | null | undefined | false;
  try {
    response = await observer(request);
  } catch (error) {
    console.error('[hvy:link-observer] Link observer failed.', { href: originalHref, error });
    return;
  }
  if (!response || !anchor.isConnected || anchor.getAttribute('href') !== originalHref) {
    if (anchor.isConnected) {
      anchor.setAttribute(LINK_OBSERVED_ATTR, 'true');
    }
    return;
  }
  applyLinkObserverResponse(anchor, response);
  if (anchor.isConnected) {
    anchor.setAttribute(LINK_OBSERVED_ATTR, 'true');
  }
}

function buildLinkObserverRequest(anchor: HTMLAnchorElement, href: string): HvyLinkObserverRequest {
  const attributes: Record<string, string> = {};
  [...anchor.attributes].forEach((attr) => {
    attributes[attr.name] = attr.value;
  });
  return {
    href,
    text: anchor.textContent ?? '',
    html: anchor.innerHTML,
    attributes,
    external: /^https?:\/\//i.test(href),
  };
}

function applyLinkObserverResponse(anchor: HTMLAnchorElement, response: HvyLinkObserverResponse): void {
  if (typeof response.html === 'string') {
    const template = document.createElement('template');
    template.innerHTML = sanitizeReplacementHtml(response.html);
    anchor.replaceWith(template.content);
    return;
  }
  if (response.href === null) {
    anchor.removeAttribute('href');
  } else if (typeof response.href === 'string') {
    anchor.setAttribute('href', response.href);
  }
  if (response.text === null) {
    anchor.textContent = '';
  } else if (typeof response.text === 'string') {
    anchor.textContent = response.text;
  }
  setNullableAttribute(anchor, 'title', response.title);
  setNullableAttribute(anchor, 'target', response.target);
  setNullableAttribute(anchor, 'rel', response.rel);
  Object.entries(response.attributes ?? {}).forEach(([name, value]) => {
    if (!isSafeObserverAttributeName(name)) {
      return;
    }
    setNullableAttribute(anchor, name, value);
  });
}

function setNullableAttribute(element: Element, name: string, value: string | null | undefined): void {
  if (value === undefined) {
    return;
  }
  if (value === null) {
    element.removeAttribute(name);
    return;
  }
  element.setAttribute(name, value);
}

function sanitizeReplacementHtml(html: string): string {
  return typeof DOMPurify.sanitize === 'function' ? DOMPurify.sanitize(html) : html;
}

function isSafeObserverAttributeName(name: string): boolean {
  return /^[a-zA-Z_:][\w:.-]*$/.test(name) && !/^on/i.test(name) && name.toLowerCase() !== 'srcdoc';
}
