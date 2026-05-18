type SectionVirtualizerOptions = {
  root: HTMLElement;
  afterRestore?: (scope: HTMLElement) => void | Promise<void>;
};

type SectionVirtualizerState = {
  observer: IntersectionObserver;
};

const VIRTUAL_OVERSCAN_PX = 2400;
const rootStates = new WeakMap<HTMLElement, SectionVirtualizerState>();
const placeholderSections = new WeakMap<HTMLElement, HTMLElement>();

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
  rootStates.get(options.root)?.observer.disconnect();
  rootStates.delete(options.root);
  if (typeof IntersectionObserver === 'undefined') {
    return;
  }
  const targets = getVirtualSectionTargets(options.root);
  if (targets.length === 0) {
    return;
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
    root: targets[0]?.scroller ?? null,
    rootMargin: `${VIRTUAL_OVERSCAN_PX}px 0px`,
    threshold: 0,
  });
  for (const target of targets) {
    observer.observe(target.section);
  }
  rootStates.set(options.root, { observer });
}

export function flushVirtualizedSections(root: HTMLElement, afterRestore?: SectionVirtualizerOptions['afterRestore']): void {
  root.querySelectorAll<HTMLElement>('[data-hvy-virtual-placeholder="true"]').forEach((placeholder) => {
    const state = rootStates.get(root);
    if (state) {
      restoreVirtualSection(placeholder, state.observer, afterRestore);
    }
  });
}

function getVirtualSectionTargets(root: HTMLElement): Array<{ scroller: Element; section: HTMLElement }> {
  const targets: Array<{ scroller: Element; section: HTMLElement }> = [];
  for (const surface of SURFACES) {
    const scroller = root.querySelector(surface.scroller);
    if (!scroller) {
      continue;
    }
    scroller.querySelectorAll<HTMLElement>(surface.sections).forEach((section) => {
      targets.push({ scroller, section });
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
