type SectionVirtualizerOptions = {
  root: HTMLElement;
  afterRestore?: (scope: HTMLElement) => void | Promise<void>;
  materializeSection?: (placeholder: HTMLElement) => HTMLElement | HTMLElement[] | null;
  onSectionMeasured?: (sectionKey: string, kind: string, height: number, blockId?: string) => void;
};

type SectionVirtualizerState = {
  observers: IntersectionObserver[];
};

type RestoredSectionLayoutGuard = {
  align(): void;
  release(): void;
};

const VIRTUAL_OVERSCAN_PX = 2400;
const rootStates = new WeakMap<HTMLElement, SectionVirtualizerState>();
const rootLifecycles = new WeakMap<HTMLElement, Pick<SectionVirtualizerOptions, 'afterRestore' | 'materializeSection' | 'onSectionMeasured'>>();
const placeholderSections = new WeakMap<HTMLElement, HTMLElement>();
const placeholderObservers = new WeakMap<HTMLElement, IntersectionObserver>();
const placeholderMaterializers = new WeakMap<HTMLElement, NonNullable<SectionVirtualizerOptions['materializeSection']>>();
const placeholderMeasureCallbacks = new WeakMap<HTMLElement, NonNullable<SectionVirtualizerOptions['onSectionMeasured']>>();

const SURFACES = [
  {
    scroller: '.editor-shell .editor-tree',
    sections: '.editor-tree > .hvy-surface > .editor-tree-body > :is(.editor-section-card:not(.editor-subsection-card), .hvy-section-virtual-placeholder[data-hvy-virtual-kind="editor"])',
  },
  {
    scroller: '.viewer-shell .reader-document',
    sections: '.reader-document > .hvy-surface > .reader-document-body > :is(.reader-section, .hvy-section-virtual-placeholder[data-hvy-virtual-kind="reader"])',
  },
  {
    scroller: '.editor-shell .editor-tree',
    sections: '.editor-section-card > .editor-blocks > :is(.editor-subsection-card, .hvy-section-virtual-placeholder[data-hvy-virtual-kind="editor"])',
    minimumSiblingCount: 24,
    itemSelector: ':is(.editor-subsection-card, .hvy-section-virtual-placeholder[data-hvy-virtual-kind="editor"])',
  },
  {
    scroller: '.viewer-shell .reader-document',
    sections: '.reader-section > .reader-section-content > :is(.reader-section, .hvy-section-virtual-placeholder[data-hvy-virtual-kind="reader"])',
    minimumSiblingCount: 24,
    itemSelector: ':is(.reader-section, .hvy-section-virtual-placeholder[data-hvy-virtual-kind="reader"])',
  },
  {
    scroller: '.editor-shell .editor-tree',
    sections: ':is(.editor-section-card > .editor-blocks, .container-inner-blocks, .grid-item-editor-shell, .reader-grid-cell.is-passive-grid-cell) > :is(.editor-block-passive, .editor-block, .hvy-section-virtual-placeholder[data-hvy-virtual-kind="editor-block"], .hvy-section-virtual-placeholder[data-hvy-virtual-kind="editor-block-range"])',
    minimumSiblingCount: 60,
    itemSelector: ':is(.editor-block-passive, .editor-block, .hvy-section-virtual-placeholder[data-hvy-virtual-kind="editor-block"], .hvy-section-virtual-placeholder[data-hvy-virtual-kind="editor-block-range"])',
  },
  {
    scroller: '.viewer-shell .reader-document',
    sections: ':is(.reader-section > .reader-section-content, .reader-container-body, .expand-stub, .expand-content, .reader-grid-cell) > :is(.reader-block, .hvy-section-virtual-placeholder[data-hvy-virtual-kind="reader-block"], .hvy-section-virtual-placeholder[data-hvy-virtual-kind="reader-block-range"])',
    minimumSiblingCount: 60,
    itemSelector: ':is(.reader-block, .hvy-section-virtual-placeholder[data-hvy-virtual-kind="reader-block"], .hvy-section-virtual-placeholder[data-hvy-virtual-kind="reader-block-range"])',
  },
];

export function getVirtualElementLayoutOffsetTop(element: HTMLElement, scroller: HTMLElement): number {
  return scroller.scrollTop + element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}

export function virtualizeRenderedSections(options: SectionVirtualizerOptions): void {
  rootLifecycles.set(options.root, {
    afterRestore: options.afterRestore,
    materializeSection: options.materializeSection,
    onSectionMeasured: options.onSectionMeasured,
  });
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
            restoreVirtualSection(
              target,
              observer,
              options.afterRestore,
              options.materializeSection,
              options.onSectionMeasured
            );
          }
          continue;
        }
        if (!entry.isIntersecting) {
          unloadVirtualSection(target, observer, options.onSectionMeasured, options.materializeSection);
        }
      }
    }, {
      root: targets.scroller,
      rootMargin: `${VIRTUAL_OVERSCAN_PX}px 0px`,
      threshold: 0,
    });
    targets.sections.forEach((section) => {
      if (section.dataset.hvyVirtualPlaceholder === 'true') {
        placeholderObservers.set(section, observer);
        if (options.materializeSection) {
          placeholderMaterializers.set(section, options.materializeSection);
        }
        if (options.onSectionMeasured) {
          placeholderMeasureCallbacks.set(section, options.onSectionMeasured);
        }
      } else {
        measureSection(section, options.onSectionMeasured);
      }
      observer.observe(section);
    });
    observers.push(observer);
  }
  if (observers.length > 0) {
    rootStates.set(options.root, { observers });
  }
}

export function flushVirtualizedSections(root: HTMLElement, afterRestore?: SectionVirtualizerOptions['afterRestore']): void {
  const rootState = rootStates.get(root);
  const lifecycle = rootLifecycles.get(root);
  root.querySelectorAll<HTMLElement>('[data-hvy-virtual-placeholder="true"]').forEach((placeholder) => {
    restoreVirtualSection(
      placeholder,
      placeholderObservers.get(placeholder) ?? rootState?.observers[0] ?? null,
      afterRestore ?? lifecycle?.afterRestore,
      lifecycle?.materializeSection,
      lifecycle?.onSectionMeasured
    );
  });
}

export function restoreVirtualizedSection(root: HTMLElement, sectionKey: string, afterRestore?: SectionVirtualizerOptions['afterRestore']): void {
  const placeholder = root.querySelector<HTMLElement>(
    `[data-hvy-virtual-placeholder="true"]:is([data-hvy-virtual-kind="editor"], [data-hvy-virtual-kind="reader"])[data-section-key="${CSS.escape(sectionKey)}"]`
  );
  if (!placeholder) {
    return;
  }
  const rootState = rootStates.get(root);
  const lifecycle = rootLifecycles.get(root);
  restoreVirtualSection(
    placeholder,
    placeholderObservers.get(placeholder) ?? rootState?.observers[0] ?? null,
    afterRestore ?? lifecycle?.afterRestore,
    lifecycle?.materializeSection,
    lifecycle?.onSectionMeasured
  );
}

export function restoreVirtualizedBlock(
  root: HTMLElement,
  sectionKey: string,
  blockId: string,
  afterRestore?: SectionVirtualizerOptions['afterRestore']
): void {
  let placeholder = root.querySelector<HTMLElement>(
    `[data-hvy-virtual-placeholder="true"][data-section-key="${CSS.escape(sectionKey)}"][data-block-id="${CSS.escape(blockId)}"]`
  );
  if (!placeholder) {
    placeholder = Array.from(root.querySelectorAll<HTMLElement>(
      `[data-hvy-virtual-placeholder="true"][data-section-key="${CSS.escape(sectionKey)}"][data-block-ids]`
    )).find((candidate) => candidate.dataset.blockIds?.split(' ').includes(blockId)) ?? null;
  }
  if (!placeholder) {
    return;
  }
  const rootState = rootStates.get(root);
  const lifecycle = rootLifecycles.get(root);
  restoreVirtualSection(
    placeholder,
    placeholderObservers.get(placeholder) ?? rootState?.observers[0] ?? null,
    afterRestore ?? lifecycle?.afterRestore,
    lifecycle?.materializeSection,
    lifecycle?.onSectionMeasured
  );
}

function getVirtualSectionTargets(root: HTMLElement): Array<{ scroller: Element; sections: HTMLElement[] }> {
  const targets: Array<{ scroller: Element; sections: HTMLElement[] }> = [];
  for (const surface of SURFACES) {
    const scroller = root.querySelector(surface.scroller);
    if (!scroller) {
      continue;
    }
    const siblingStats = new WeakMap<Element, {
      count: number;
      hasPlaceholder: boolean;
      hasBlockRange: boolean;
    }>();
    targets.push({
      scroller,
      sections: Array.from(scroller.querySelectorAll<HTMLElement>(surface.sections)).filter((section) => {
        if (!('minimumSiblingCount' in surface) || !surface.minimumSiblingCount || !('itemSelector' in surface)) {
          return true;
        }
        const parent = section.parentElement;
        if (!parent) {
          return false;
        }
        let stats = siblingStats.get(parent);
        if (!stats) {
          const siblings = Array.from(parent.children).filter((sibling) => sibling.matches(surface.itemSelector));
          stats = {
            count: siblings.length,
            hasPlaceholder: siblings.some((sibling) => (sibling as HTMLElement).dataset.hvyVirtualPlaceholder === 'true'),
            hasBlockRange: siblings.some((sibling) => sibling.getAttribute('data-block-ids') !== null),
          };
          siblingStats.set(parent, stats);
        }
        if (section.dataset.hvyVirtualPlaceholder === 'true'
          || stats.hasPlaceholder
          || stats.hasBlockRange
          || stats.count >= surface.minimumSiblingCount) {
          return true;
        }
        const gridLayout = parent.closest('.reader-grid-layout, .grid-fields');
        return Boolean(
          gridLayout?.matches('.reader-grid-layout, .grid-fields')
          && gridLayout.children.length >= surface.minimumSiblingCount
        );
      }),
    });
  }
  return targets;
}

function unloadVirtualSection(
  section: HTMLElement,
  observer: IntersectionObserver,
  onSectionMeasured?: SectionVirtualizerOptions['onSectionMeasured'],
  materializeSection?: SectionVirtualizerOptions['materializeSection']
): void {
  if (section.dataset.hvyVirtualPlaceholder === 'true' || shouldKeepSectionMounted(section)) {
    return;
  }
  const rect = section.getBoundingClientRect();
  const height = Math.max(1, rect.height);
  const placeholder = section.ownerDocument.createElement('div');
  const style = getComputedStyle(section);
  placeholder.className = 'hvy-section-virtual-placeholder';
  placeholder.dataset.hvyVirtualPlaceholder = 'true';
  placeholder.dataset.hvyVirtualKind = section.dataset.hvyVirtualItem ?? section.dataset.hvyVirtualSection ?? '';
  placeholder.dataset.sectionKey = section.dataset.sectionKey ?? section.dataset.editorSection ?? '';
  if (section.dataset.blockId) {
    placeholder.dataset.blockId = section.dataset.blockId;
  }
  if (section.dataset.blockIds) {
    placeholder.dataset.blockIds = section.dataset.blockIds;
  }
  if (section.dataset.parentLocked) {
    placeholder.dataset.parentLocked = section.dataset.parentLocked;
  }
  if (section.classList.contains('editor-subsection-card') || section.dataset.hvyVirtualSubsection === 'true') {
    placeholder.dataset.hvyVirtualSubsection = 'true';
  }
  placeholder.style.minHeight = `${height}px`;
  placeholder.style.margin = style.margin;
  placeholder.setAttribute('aria-hidden', 'true');
  placeholderSections.set(placeholder, section);
  placeholderObservers.set(placeholder, observer);
  if (materializeSection) {
    placeholderMaterializers.set(placeholder, materializeSection);
  }
  if (onSectionMeasured) {
    placeholderMeasureCallbacks.set(placeholder, onSectionMeasured);
    onSectionMeasured(
      placeholder.dataset.sectionKey,
      placeholder.dataset.hvyVirtualKind,
      height,
      placeholder.dataset.blockId
    );
  }
  observer.unobserve(section);
  section.replaceWith(placeholder);
  observer.observe(placeholder);
}

function restoreVirtualSection(
  placeholder: HTMLElement,
  observer: IntersectionObserver | null,
  afterRestore: SectionVirtualizerOptions['afterRestore'],
  materializeSection?: SectionVirtualizerOptions['materializeSection'],
  onSectionMeasured?: SectionVirtualizerOptions['onSectionMeasured']
): void {
  if (placeholder.dataset.hvyVirtualPlaceholder !== 'true') {
    return;
  }
  const materialized = placeholderSections.get(placeholder)
    ?? placeholderMaterializers.get(placeholder)?.(placeholder)
    ?? materializeSection?.(placeholder)
    ?? null;
  if (!materialized) {
    return;
  }
  const sections = Array.isArray(materialized) ? materialized : [materialized];
  if (sections.length === 0) {
    return;
  }
  const layoutGuard = sections.length === 1
    ? reserveRestoredSectionLayout(placeholder, sections[0])
    : null;
  observer?.unobserve(placeholder);
  placeholder.replaceWith(...sections);
  layoutGuard?.align();
  placeholderObservers.delete(placeholder);
  const restoreResults: Array<void | Promise<void>> = [];
  sections.forEach((section) => {
    observer?.observe(section);
    measureSection(section, placeholderMeasureCallbacks.get(placeholder) ?? onSectionMeasured);
    restoreResults.push(afterRestore?.(section));
  });
  if (layoutGuard) {
    void Promise.allSettled(restoreResults.map((result) => Promise.resolve(result)))
      .then(() => waitForRestoredSectionImageLayout(sections[0]))
      .then(() => layoutGuard.release());
  }
}

function reserveRestoredSectionLayout(
  placeholder: HTMLElement,
  section: HTMLElement
): RestoredSectionLayoutGuard | null {
  const placeholderHeight = placeholder.getBoundingClientRect().height;
  if (placeholderHeight <= 0) {
    return null;
  }
  const previousHeight = section.style.getPropertyValue('height');
  const previousHeightPriority = section.style.getPropertyPriority('height');
  const previousOverflow = section.style.getPropertyValue('overflow');
  const previousOverflowPriority = section.style.getPropertyPriority('overflow');
  section.style.setProperty('height', `${placeholderHeight}px`);
  section.style.setProperty('overflow', 'clip');
  const scroller = placeholder.closest<HTMLElement>(
    '.editor-tree, .editor-sidebar-panel, .reader-document, .viewer-sidebar-panel'
  );
  const followingContent = placeholder.nextElementSibling instanceof HTMLElement
    ? placeholder.nextElementSibling
    : null;
  const placeholderWasAboveViewport = scroller
    ? placeholder.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().top + scroller.clientTop
    : false;
  const followingTopBeforeRestore = followingContent?.getBoundingClientRect().top ?? null;
  let aligned = false;
  let released = false;
  return {
    align() {
      if (aligned || !scroller || !placeholderWasAboveViewport
        || followingTopBeforeRestore === null || !followingContent?.isConnected) {
        return;
      }
      aligned = true;
      const delta = followingContent.getBoundingClientRect().top - followingTopBeforeRestore;
      if (Math.abs(delta) > 0.5) {
        scroller.scrollTop += delta;
      }
    },
    release() {
      if (released || !section.isConnected) {
        return;
      }
      released = true;
      const sectionWasAboveViewport = scroller
        ? section.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().top + scroller.clientTop
        : false;
      const followingTop = followingContent?.isConnected
        ? followingContent.getBoundingClientRect().top
        : null;
      if (previousHeight) {
        section.style.setProperty('height', previousHeight, previousHeightPriority);
      } else {
        section.style.removeProperty('height');
      }
      if (previousOverflow) {
        section.style.setProperty('overflow', previousOverflow, previousOverflowPriority);
      } else {
        section.style.removeProperty('overflow');
      }
      if (!scroller || !sectionWasAboveViewport || followingTop === null || !followingContent?.isConnected) {
        return;
      }
      const delta = followingContent.getBoundingClientRect().top - followingTop;
      if (Math.abs(delta) > 0.5) {
        scroller.scrollTop += delta;
      }
    },
  };
}

function waitForRestoredSectionImageLayout(section: HTMLElement): Promise<void> {
  if (restoredSectionImagesHaveLayout(section)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const observedImages = new Set<HTMLImageElement>();
    const observer = new MutationObserver(check);
    const finish = (): void => {
      observer.disconnect();
      observedImages.forEach((image) => {
        image.removeEventListener('load', check);
        image.removeEventListener('error', check);
      });
      observedImages.clear();
      resolve();
    };
    function check(): void {
      if (!section.isConnected || restoredSectionImagesHaveLayout(section)) {
        finish();
        return;
      }
      section.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
        if (observedImages.has(image)) {
          return;
        }
        observedImages.add(image);
        image.addEventListener('load', check, { once: true });
        image.addEventListener('error', check, { once: true });
      });
    }
    observer.observe(section, {
      attributes: true,
      attributeFilter: ['src', 'width', 'height', 'style', 'class'],
      childList: true,
      subtree: true,
    });
    if (section.ownerDocument.body !== section) {
      observer.observe(section.ownerDocument.body, {
        childList: true,
        subtree: true,
      });
    }
    check();
  });
}

function restoredSectionImagesHaveLayout(section: HTMLElement): boolean {
  return Array.from(section.querySelectorAll<HTMLImageElement>('img')).every((image) => {
    if (image.getBoundingClientRect().height > 0) {
      return true;
    }
    const src = image.getAttribute('src');
    const deferred = image.dataset.hvyLazyImage === 'true'
      || image.dataset.hvyCarouselLazyImage === 'true';
    if (!src && deferred) {
      return false;
    }
    return !src || image.complete;
  });
}

function measureSection(
  section: HTMLElement,
  onSectionMeasured?: SectionVirtualizerOptions['onSectionMeasured']
): void {
  if (!onSectionMeasured) {
    return;
  }
  window.requestAnimationFrame(() => {
    if (!section.isConnected) {
      return;
    }
    const height = section.getBoundingClientRect().height;
    if (height > 0) {
      onSectionMeasured(
        section.dataset.sectionKey ?? section.dataset.editorSection ?? '',
        section.dataset.hvyVirtualItem ?? section.dataset.hvyVirtualSection ?? '',
        height,
        section.dataset.blockId
      );
    }
  });
}

function shouldKeepSectionMounted(section: HTMLElement): boolean {
  return section.contains(section.ownerDocument.activeElement)
    || Boolean(section.querySelector('[data-active-editor-block="true"]'))
    || Boolean(section.querySelector('.component-picker[data-open="true"], .component-picker:focus-within'))
    || section.classList.contains('is-temp-highlighted')
    || Boolean(section.querySelector('.is-temp-highlighted, .is-context-menu-target'));
}
