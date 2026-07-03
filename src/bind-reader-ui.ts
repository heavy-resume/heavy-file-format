import { findBlockByIds } from './block-ops';
import { bindChangeControls } from './bind/handlers/change-controls';
import { bindInputBlock } from './bind/handlers/input-block';
import { bindInputMisc } from './bind/handlers/input-misc';
import { bindKeydown } from './bind/handlers/keydown';
import { bindScrollHandler } from './bind/handlers/scroll';
import { bindSubmit } from './bind/handlers/submit';
import { encodeComponentListRuntimeView, parseComponentListRuntimeView } from './editor/components/component-list/component-list-view';
import { logClickTrace } from './bind/click-trace';
import { navigateToSection } from './navigation';
import { elapsedMs, logPerfTrace, nowMs } from './perf-trace';
import { expandSingletonVirtualGroupChild } from './reader/singleton-group-expand';
import { bindResponsiveSidebarShells } from './responsive-sidebar-tab';
import { findSectionByKey } from './section-ops';
import { dismissSidebarHelpBalloon, scheduleSidebarHelpAutoClose } from './sidebar-help';
import { getActiveStateRuntime, getRefreshReaderBlock, getRefreshReaderPanels, runWithStateRuntime, state } from './state';

const readerAppControlsBound = new WeakSet<HTMLElement>();

function bindReaderAppControls(app: HTMLElement): void {
  if (readerAppControlsBound.has(app)) {
    return;
  }
  readerAppControlsBound.add(app);
  bindInputBlock(app);
  bindInputMisc(app);
  bindChangeControls(app);
  bindSubmit(app);
  bindKeydown(app);
  bindScrollHandler(app);

  app.addEventListener('click', (event) => {
    if (!app.querySelector('#readerDocument')) {
      return;
    }
    const target = event.target as HTMLElement;
    const actionButton = target.closest<HTMLElement>('[data-action]');
    const action = actionButton?.dataset.action ?? '';
    if (!actionButton || !action) {
      return;
    }
    const runtime = getActiveStateRuntime();
    event.preventDefault();
    event.stopImmediatePropagation();
    void import('./bind/app-actions/registry').then(({ appActionRegistry }) => {
      runWithStateRuntime(runtime, () => {
        appActionRegistry[action]?.({
          app,
          actionButton,
          event,
          sectionKey: actionButton.dataset.sectionKey ?? '',
          blockId: actionButton.dataset.blockId ?? '',
          target,
        });
      });
    });
  }, { capture: true });
}

export function bindReaderUi(app: HTMLElement): void {
  const readerDocuments = app.querySelectorAll<HTMLDivElement>('#readerDocument, #aiReaderDocument');
  const readerSidebarSections = app.querySelectorAll<HTMLDivElement>('#readerSidebarSections, #aiSidebarSections');
  const readerNav = app.querySelector<HTMLDivElement>('#readerNav');
  bindResponsiveSidebarShells(app);
  scheduleSidebarHelpAutoClose(app);
  bindReaderAppControls(app);

  const toggleComponentListReverse = (reverseList: HTMLElement): void => {
    const sectionKey = reverseList.dataset.sectionKey;
    const blockId = reverseList.dataset.blockId;
    const viewId = reverseList.dataset.viewId ?? '';
    if (!sectionKey || !blockId) {
      return;
    }
    const key = `${sectionKey}:${blockId}`;
    const current = parseComponentListRuntimeView(state.componentListReaderViews[key] ?? viewId);
    state.componentListReaderViews[key] = encodeComponentListRuntimeView({
      sortKey: current.sortKeyOverride ? current.sortKey : viewId,
      sortKeyOverride: current.sortKeyOverride || !!viewId,
      reversed: !current.reversed,
      groupKey: current.groupKey,
    });
  };

  const handleCollapsedListControlPointerDown = (event: Event) => {
    const target = event.target as HTMLElement;
    const select = target.closest<HTMLSelectElement>('select');
    const listControls = select?.closest<HTMLElement>('[data-component-list-reader-controls="true"]');
    const collapsedSection = listControls?.closest<HTMLElement>('.reader-section.is-collapsed-preview');
    const sectionKey = select?.dataset.sectionKey;
    const blockId = select?.dataset.blockId ?? '';
    if (!select || !listControls || !collapsedSection || !sectionKey) {
      return;
    }
    const section = findSectionByKey(state.document.sections, sectionKey);
    if (!section || section.expanded) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    section.expanded = true;
    const field = select.dataset.field ?? 'component-list-reader-view';
    getRefreshReaderPanels()();
    const nextSelect = app.querySelector<HTMLSelectElement>(
      `[data-field="${CSS.escape(field)}"][data-section-key="${CSS.escape(sectionKey)}"][data-block-id="${CSS.escape(blockId)}"]`
    );
    nextSelect?.focus();
    (nextSelect as (HTMLSelectElement & { showPicker?: () => void }) | null)?.showPicker?.();
  };

  const handleReaderAreaClick = (event: Event) => {
    const target = event.target as HTMLElement;
    const nearestReaderAction = target.closest<HTMLElement>('[data-reader-action]');
    logClickTrace(event, 'reader-area:enter', {
      currentView: state.currentView,
      readerSurface: target.closest('#readerDocument')
        ? 'reader-document'
        : target.closest('#aiReaderDocument')
          ? 'ai-document'
          : target.closest('#readerSidebarSections')
            ? 'reader-sidebar'
            : target.closest('#aiSidebarSections')
              ? 'ai-sidebar'
              : null,
    });
    if (target.closest('[data-action]')) {
      logClickTrace(event, 'reader-area:skip', {
        skipReason: 'data-action-target',
      });
      return;
    }

    const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]');
    if (anchor) {
      event.preventDefault();
      logClickTrace(event, 'reader-area:handled:anchor-navigation', {
        href: anchor.getAttribute('href'),
      });
      const id = anchor.getAttribute('href')?.slice(1) ?? '';
      navigateToSection(id, app);
      return;
    }

    const listControls = target.closest<HTMLElement>('[data-component-list-reader-controls="true"]');
    if (listControls) {
      const collapsedSection = listControls.closest<HTMLElement>('.reader-section.is-collapsed-preview');
      const sectionKey = listControls.querySelector<HTMLElement>('[data-section-key]')?.dataset.sectionKey;
      if (collapsedSection && sectionKey) {
        const section = findSectionByKey(state.document.sections, sectionKey);
        if (section && !section.expanded) {
          event.stopPropagation();
          logClickTrace(event, 'reader-area:handled:collapsed-list-controls', {
            sectionKey,
          });
          section.expanded = true;
          const reverseList = target.closest<HTMLElement>('[data-reader-action="toggle-component-list-reverse"]');
          if (reverseList) {
            toggleComponentListReverse(reverseList);
          }
          getRefreshReaderPanels()();
          const select = target.closest<HTMLSelectElement>('select');
          if (select) {
            const blockId = select.dataset.blockId ?? '';
            window.setTimeout(() => {
              const nextSelect = app.querySelector<HTMLSelectElement>(
                `[data-field="${CSS.escape(select.dataset.field ?? 'component-list-reader-view')}"][data-section-key="${CSS.escape(sectionKey)}"][data-block-id="${CSS.escape(blockId)}"]`
              );
              nextSelect?.focus();
              (nextSelect as (HTMLSelectElement & { showPicker?: () => void }) | null)?.showPicker?.();
            }, 0);
          }
          return;
        }
      }
    }

    const reverseList = target.closest<HTMLElement>('[data-reader-action="toggle-component-list-reverse"]');
    if (reverseList) {
      event.stopPropagation();
      logClickTrace(event, 'reader-area:handled:component-list-reverse');
      toggleComponentListReverse(reverseList);
      getRefreshReaderPanels()();
      return;
    }

    const viewCollapse = target.closest<HTMLElement>('[data-reader-action="toggle-view-collapse"]');
    if (viewCollapse) {
      if (nearestReaderAction !== viewCollapse) {
        return;
      }
      if (target.closest('a, input, select, textarea, [contenteditable="true"]')) {
        logClickTrace(event, 'reader-area:skip', {
          skipReason: 'view-collapse-interactive-target',
        });
        return;
      }
      event.stopPropagation();
      const key = viewCollapse.dataset.readerViewCollapseKey;
      if (!key) {
        return;
      }
      logClickTrace(event, 'reader-area:handled:view-collapse', {
        key,
      });
      state.readerContainerState[key] = viewCollapse.getAttribute('aria-expanded') !== 'true';
      getRefreshReaderPanels()();
      return;
    }

    const dimmedTarget = target.closest<HTMLElement>('[data-reader-view-dimmed="true"][data-reader-view-target]');
    if (dimmedTarget) {
      const targetKey = dimmedTarget.dataset.readerViewTarget;
      if (targetKey) {
        state.readerViewActivatedTargets.add(targetKey);
        getRefreshReaderPanels()();
        return;
      }
    }

    const toggle = target.closest<HTMLElement>('[data-reader-action="toggle-expand"]');
    if (toggle) {
      event.stopPropagation();
      logClickTrace(event, 'reader-area:handled:section-toggle:start', {
        sectionKey: toggle.dataset.sectionKey ?? null,
      });
      const sectionKey = toggle.dataset.sectionKey;
      if (!sectionKey) {
        return;
      }
      const section = findSectionByKey(state.document.sections, sectionKey);
      if (!section) {
        return;
      }
      logClickTrace(event, 'reader-area:handled:section-toggle:run', {
        sectionKey,
        willExpand: !section.expanded,
      });
      section.expanded = !section.expanded;
      getRefreshReaderPanels()();
      return;
    }

    const expandable = target.closest<HTMLElement>('[data-reader-action="toggle-expandable"]');
    if (expandable) {
      logClickTrace(event, 'reader-area:expandable:candidate', {
        sectionKey: expandable.dataset.sectionKey ?? null,
        blockId: expandable.dataset.blockId ?? null,
      });
      if (target.closest('a, button, input, select, textarea, [contenteditable="true"], [role="button"]')) {
        logClickTrace(event, 'reader-area:skip', {
          skipReason: 'expandable-interactive-target',
        });
        return;
      }
      event.stopPropagation();
      const sectionKey = expandable.dataset.sectionKey;
      const blockId = expandable.dataset.blockId;
      if (!sectionKey || !blockId) {
        logClickTrace(event, 'reader-area:skip', {
          skipReason: 'expandable-missing-ids',
          sectionKey,
          blockId,
        });
        return;
      }
      const block = findBlockByIds(sectionKey, blockId);
      if (!block) {
        logClickTrace(event, 'reader-area:skip', {
          skipReason: 'expandable-missing-block',
          sectionKey,
          blockId,
        });
        return;
      }
      const expandableStateKey = `${sectionKey}:${blockId}`;
      const willCollapse = state.readerExpandableState[expandableStateKey] ?? block.schema.expandableExpanded;
      const actionStartedAt = nowMs();
      logClickTrace(event, 'reader-area:handled:expandable-toggle:run', {
        sectionKey,
        blockId,
        expandableStateKey,
        willCollapse,
        storedExpanded: state.readerExpandableState[expandableStateKey] ?? null,
        schemaExpanded: block.schema.expandableExpanded,
      });
      logPerfTrace('reader-expandable-toggle:start', {
        sectionKey,
        blockId,
        expandableStateKey,
        willCollapse,
        currentView: state.currentView,
      });
      if (willCollapse) {
        const readerEl = app.querySelector<HTMLElement>(`[data-expandable-id="${CSS.escape(blockId)}"]`);
        readerEl?.classList.add('is-collapsing');
        logPerfTrace('reader-expandable-toggle:collapse-animation-started', {
          sectionKey,
          blockId,
          elapsedMs: elapsedMs(actionStartedAt),
          hasReaderElement: Boolean(readerEl),
        });
        window.setTimeout(() => {
          const refreshStartedAt = nowMs();
          state.readerExpandableState[expandableStateKey] = false;
          logPerfTrace('reader-expandable-toggle:collapse-refresh:start', {
            sectionKey,
            blockId,
            elapsedMs: elapsedMs(actionStartedAt),
          });
          if (!getRefreshReaderBlock()(app, sectionKey, blockId, { runVisibilityScripts: false })) {
            getRefreshReaderPanels()({ runVisibilityScripts: false });
          }
          logPerfTrace('reader-expandable-toggle:collapse-refresh:end', {
            sectionKey,
            blockId,
            refreshMs: elapsedMs(refreshStartedAt),
            elapsedMs: elapsedMs(actionStartedAt),
          });
        }, 160);
      } else {
        state.readerExpandableState[expandableStateKey] = true;
        logPerfTrace('reader-expandable-toggle:expand-refresh:start', {
          sectionKey,
          blockId,
          elapsedMs: elapsedMs(actionStartedAt),
        });
        const refreshStartedAt = nowMs();
        if (!getRefreshReaderBlock()(app, sectionKey, blockId, { runVisibilityScripts: true })) {
          getRefreshReaderPanels()();
        }
        logPerfTrace('reader-expandable-toggle:expand-refresh:end', {
          sectionKey,
          blockId,
          refreshMs: elapsedMs(refreshStartedAt),
          elapsedMs: elapsedMs(actionStartedAt),
        });
        const readerEl = app.querySelector<HTMLElement>(`[data-expandable-id="${CSS.escape(blockId)}"]`);
        readerEl?.classList.add('is-expanding');
        window.setTimeout(() => {
          readerEl?.classList.remove('is-expanding');
        }, 360);
      }
      return;
    }

    const container = target.closest<HTMLElement>('[data-reader-action="toggle-container"]');
    if (container) {
      if (target.closest('a, input, select, textarea, [contenteditable="true"]')) {
        logClickTrace(event, 'reader-area:skip', {
          skipReason: 'container-interactive-target',
        });
        return;
      }
      event.stopPropagation();
      const key = container.dataset.containerKey;
      if (!key) {
        logClickTrace(event, 'reader-area:skip', {
          skipReason: 'container-missing-key',
        });
        return;
      }
      logClickTrace(event, 'reader-area:handled:container-toggle', {
        key,
        willExpand: container.getAttribute('aria-expanded') !== 'true',
      });
      const willExpand = container.getAttribute('aria-expanded') !== 'true';
      state.readerContainerState[key] = willExpand;
      if (willExpand) {
        expandSingletonVirtualGroupChild(container);
      }
      getRefreshReaderPanels()();
    }
  };

  readerDocuments.forEach((readerDocument) => {
    readerDocument.addEventListener('pointerdown', handleCollapsedListControlPointerDown);
    readerDocument.addEventListener('click', handleReaderAreaClick);
  });
  readerSidebarSections.forEach((sidebarSections) => {
    sidebarSections.addEventListener('pointerdown', handleCollapsedListControlPointerDown);
    sidebarSections.addEventListener('click', handleReaderAreaClick);
  });
  app.querySelector<HTMLElement>('.viewer-sidebar-help-balloon')?.addEventListener('click', () => {
    dismissSidebarHelpBalloon(app, 'viewer');
  });

  readerNav?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const nav = target.closest<HTMLElement>('[data-nav-id]');
    if (!nav) {
      return;
    }
    const sectionId = nav.dataset.navId;
    if (!sectionId) {
      return;
    }
    navigateToSection(sectionId, app);
  });
}
