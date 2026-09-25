import type { HvyTemplateFormOptions, HvyTemplateFormResult } from './embed';
import { getActiveStateRuntime, getRenderApp, runWithStateRuntime, state, type StateRuntime } from './state';
import { closeModal, navigateToReaderTarget } from './navigation';
import { navigateToEditorTarget, revealEditorTargetInState } from './editor-target-navigation';
import { openReusableTemplateModalIfNeeded } from './bind/actions/reusable-template';
import { resolveTemplateFormTarget } from './template-form-target';

const pendingForms = new WeakMap<StateRuntime, () => void>();

export function cancelMountedTemplateForm(runtime: StateRuntime): void {
  pendingForms.get(runtime)?.();
}

export function openMountedTemplateForm(root: HTMLElement, options: HvyTemplateFormOptions): Promise<HvyTemplateFormResult> {
  const runtime = getActiveStateRuntime();
  if (pendingForms.has(runtime) || state.reusableTemplateModal) {
    return Promise.reject(new Error('A template form is already open or opening.'));
  }
  // Resolve and validate before changing navigation or closing another modal.
  const target = resolveTemplateFormTarget(state.document, options);
  const document = state.document;
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let finished = false;
    const finish = (result: HvyTemplateFormResult) => {
      if (finished) return;
      finished = true;
      controller.abort();
      pendingForms.delete(runtime);
      resolve(result);
    };
    pendingForms.set(runtime, () => finish({ status: 'cancelled' }));
    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      controller.abort();
      pendingForms.delete(runtime);
      reject(error);
    };
    const showForm = (error?: Error) => runWithStateRuntime(runtime, () => {
      if (finished) return;
      if (error) { fail(error); return; }
      try {
        const current = resolveTemplateFormTarget(state.document, options);
        if (state.document !== document || current.block !== target.block) {
          throw new Error('The template form target changed during navigation.');
        }
        if (!openReusableTemplateModalIfNeeded(current.component, {
          kind: 'component-list', sectionKey: current.sectionKey, blockId: current.block.id,
        }, finish)) {
          throw new Error('The target list’s item template has no form fields.');
        }
      } catch (error) { fail(error); }
    });
    try {
      closeModal();
      const navigationTarget = { sectionKey: target.sectionKey, blockId: target.block.id };
      if (state.currentView === 'editor') {
        revealEditorTargetInState(navigationTarget);
        getRenderApp()();
        navigateToEditorTarget(navigationTarget, root, 0, showForm, controller.signal);
      } else {
        state.readerNavigationTarget = navigationTarget;
        // Promotion from the lightweight viewer needs the full runtime's rendered surface.
        getRenderApp()();
        navigateToReaderTarget(navigationTarget, root, showForm, controller.signal);
      }
    } catch (error) { fail(error); }
  });
}
