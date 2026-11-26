import { getDatabaseChangeRevision } from '../../database-change-tracker';
import type { VisualBlock } from '../../editor/types';
import type { VisualDocument } from '../../types';
import { parseFormSpec, type FormSpec } from '../form-spec/form-spec';
import { createLiveState, type LiveFormState } from './form-live-state';

export interface FormLifecycleState {
  initialized: boolean;
  live: LiveFormState;
  lastDatabaseRevision: number;
}

const formLifecycleByDocument = new WeakMap<VisualDocument, WeakMap<VisualBlock, FormLifecycleState>>();

export function getFormLifecycle(document: VisualDocument, block: VisualBlock, getSpec: () => FormSpec): FormLifecycleState {
  let forms = formLifecycleByDocument.get(document);
  if (!forms) {
    forms = new WeakMap<VisualBlock, FormLifecycleState>();
    formLifecycleByDocument.set(document, forms);
  }
  let lifecycle = forms.get(block);
  if (!lifecycle) {
    lifecycle = {
      initialized: false,
      live: createLiveState(getSpec()),
      lastDatabaseRevision: getDatabaseChangeRevision(document),
    };
    forms.set(block, lifecycle);
  }
  return lifecycle;
}

export function claimFormInitialization(document: VisualDocument, block: VisualBlock): boolean {
  const lifecycle = getFormLifecycle(
    document,
    block,
    () => parseFormSpec(block.text, block.schema.pluginConfig).spec
  );
  if (lifecycle.initialized) return false;
  lifecycle.initialized = true;
  return true;
}
