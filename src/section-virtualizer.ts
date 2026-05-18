type SectionVirtualizerOptions = {
  root: HTMLElement;
  afterRestore?: (scope: HTMLElement) => void | Promise<void>;
};

type SectionVirtualizerState = {
  observers: IntersectionObserver[];
};

const VIRTUAL_OVERSCAN_PX = 2400;
const rootStates = new WeakMap<HTMLElement, SectionVirtualizerState>();
const placeholderSections = new WeakMap<HTMLElement, HTMLElement>();
const placeholderObservers = new WeakMap<HTMLElement, IntersectionObserver>();

const SURFACES = [
  {
    scroller: '.editor-shell .editor-tree',
    sections: '.editor-tree > .hvy-surface > .editor-tree-body > .editor-section-card:not(.editor-subsection-card)',
  },
  {
    scroller: '.viewer-shell .reader-document',
    sections: '.reader-document > .hvy-surface > .reader-document-body > .reader-section',
  },
];

export function virtualizeRenderedSections(options: SectionVirtualizerOptions): void {
  rootStates.get(options.root)?.observers.forEach((observer) => observer.disconnect());
  rootStates.delete(options.root);
  if (typeof IntersectionObserver === 'undefined') {
    return;
  }
  const surfaceTargets = getVirtualSectionTargets(options.root);
  const observers: IntersectionObserver[] = [];
  for (const targets of surfaceTargets) {
    if (targets.sections.length === 0) {
      continue;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target;
        if (!(target instanceof HTMLElement)) {
          continue;
        }
        if (target.dataset.hvyVirtualPlaceholder === 'true') {
          if (entry.isIntersecting) {
            restoreVirtualSection(target, observer, options.afterRestore);
          }
          continue;
        }
        if (!entry.isIntersecting) {
          unloadVirtualSection(target, observer);
        }
      }
    }, {
      root: targets.scroller,
      rootMargin: `${VIRTUAL_OVERSCAN_PX}px 0px`,
      threshold: 0,
    });
    targets.sections.forEach((section) => observer.observe(section));
    observers.push(observer);
  }
  if (observers.length > 0) {
    rootStates.set(options.root, { observers });
  }
}

export function flushVirtualizedSections(root: HTMLElement, afterRestore?: SectionVirtualizerOptions['afterRestore']): void {
  root.querySelectorAll<HTMLElement>('[data-hvy-virtual-placeholder="true"]').forEach((placeholder) => {
    const observer = placeholderObservers.get(placeholder) ?? rootStates.get(root)?.observers[0];
    if (observer) {
      restoreVirtualSection(placeholder, observer, afterRestore);
    }
  });
}

function getVirtualSectionTargets(root: HTMLElement): Array<{ scroller: Element; sections: HTMLElement[] }> {
  const targets: Array<{ scroller: Element; sections: HTMLElement[] }> = [];
  for (const surface of SURFACES) {
    const scroller = root.querySelector(surface.scroller);
    if (!scroller) {
      continue;
    }
    targets.push({
      scroller,
      sections: Array.from(scroller.querySelectorAll<HTMLElement>(surface.sections)),
    });
  }
  return targets;
}

function unloadVirtualSection(section: HTMLElement, observer: IntersectionObserver): void {
  if (section.dataset.hvyVirtualPlaceholder === 'true' || shouldKeepSectionMounted(section)) {
    return;
  }
  const rect = section.getBoundingClientRect();
  const height = Math.max(1, rect.height);
  const placeholder = section.ownerDocument.createElement('div');
  const style = getComputedStyle(section);
  placeholder.className = 'hvy-section-virtual-placeholder';
  placeholder.dataset.hvyVirtualPlaceholder = 'true';
  placeholder.dataset.sectionKey = section.dataset.sectionKey ?? section.dataset.editorSection ?? '';
  placeholder.style.minHeight = `${height}px`;
  placeholder.style.margin = style.margin;
  placeholder.setAttribute('aria-hidden', 'true');
  placeholderSections.set(placeholder, section);
  placeholderObservers.set(placeholder, observer);
  observer.unobserve(section);
  section.replaceWith(placeholder);
  observer.observe(placeholder);
}

function restoreVirtualSection(
  placeholder: HTMLElement,
  observer: IntersectionObserver,
  afterRestore: SectionVirtualizerOptions['afterRestore']
): void {
  if (placeholder.dataset.hvyVirtualPlaceholder !== 'true') {
    return;
  }
  const section = placeholderSections.get(placeholder);
  if (!section) {
    return;
  }
  observer.unobserve(placeholder);
  placeholder.replaceWith(section);
  placeholderObservers.delete(placeholder);
  observer.observe(section);
  void afterRestore?.(section);
}

function shouldKeepSectionMounted(section: HTMLElement): boolean {
  return section.contains(section.ownerDocument.activeElement)
    || Boolean(section.querySelector('.editor-block[data-active-editor-block="true"]'))
    || Boolean(section.querySelector('.component-picker[data-open="true"], .component-picker:focus-within'))
    || section.classList.contains('is-temp-highlighted')
    || Boolean(section.querySelector('.is-temp-highlighted, .is-context-menu-target'));
}
