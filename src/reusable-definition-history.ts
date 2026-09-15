import { clearActiveEditorBlock, findBlockByIds } from './block-ops';
import { getComponentDefsFromMeta, getSectionDefsFromMeta } from './component-defs';
import { captureActiveEditorRestoreState, capturePreferredEditorTarget, restoreActiveEditorState } from './history';
import { restorePreferredEditorSelection } from './scroll';
import { serializeDocumentHeaderYaml } from './serialization';
import { getActiveStateRuntime, getRenderApp, HISTORY_GROUP_WINDOW_MS, runWithStateRuntime, state } from './state';
import type { AppState, ReusableDefinitionEditModalState } from './types';

type DraftOwner = NonNullable<ReusableDefinitionEditModalState['historyBeforeDraft']>;

interface DraftContext {
  activeFlavorIndex: number | null;
  activeEditor: ReturnType<typeof captureActiveEditorRestoreState>;
  componentMetaModal: AppState['componentMetaModal'];
  modalSectionKey: AppState['modalSectionKey'];
  flavorManager: ReusableDefinitionEditModalState['flavorManager'];
  focus: ReturnType<typeof capturePreferredEditorTarget>;
}

interface DraftEntry {
  content: string;
  signature: string;
  pendingSignature: string;
  context: DraftContext;
}

interface DraftHistory {
  past: DraftEntry[];
  future: DraftEntry[];
  root: HTMLElement | null;
  pending: boolean;
  pendingGroup?: string;
  lastGroup?: string;
  lastAt: number;
  restoring: boolean;
}

// The opening transaction survives modal state copies (validation errors and
// flavor navigation), and is released when the draft closes.
const histories = new WeakMap<DraftOwner, DraftHistory>();

function getDraftHistory(): DraftHistory | null {
  const owner = state.reusableDefinitionEditModal?.historyBeforeDraft;
  if (!owner) return null;
  let history = histories.get(owner);
  if (!history) {
    history = { past: [], future: [], root: null, pending: false, lastAt: 0, restoring: false };
    histories.set(owner, history);
    history.past.push(snapshotDraft(history));
  }
  return history;
}

function snapshotDraft(history: DraftHistory): DraftEntry {
  const modal = state.reusableDefinitionEditModal!;
  const definition = modal.kind === 'component'
    ? getComponentDefsFromMeta(state.document.meta)[modal.index]
    : getSectionDefsFromMeta(state.document.meta)[modal.index];
  // Only the edited definition is serialized. Other templates provide type
  // names for schema resolution; body content and attachments stay outside it.
  const componentTypes = getComponentDefsFromMeta(state.document.meta).map((item, index) =>
    modal.kind === 'component' && index === modal.index ? item : { name: item.name, baseType: item.baseType }
  );
  const signature = serializeDocumentHeaderYaml({
    ...state.document,
    meta: {
      component_defs: componentTypes,
      ...(modal.kind === 'section' ? { section_defs: [definition] } : {}),
    },
    sections: [],
    attachments: [],
  });
  return {
    content: JSON.stringify({ definition, draftName: modal.draftName, pendingDocumentSync: modal.pendingDocumentSync }),
    signature: JSON.stringify([signature, modal.draftName ?? definition.name]),
    pendingSignature: JSON.stringify(modal.flavorManager?.mode === 'create'
      ? [modal.flavorManager.draftName, modal.flavorManager.draftDescription] : null),
    context: captureDraftContext(history),
  };
}

function captureDraftContext(history: DraftHistory): DraftContext {
  const modal = state.reusableDefinitionEditModal!;
  const active = history.root?.ownerDocument.activeElement;
  const scope = history.root?.querySelector<HTMLElement>('#modalRoot');
  return {
    activeFlavorIndex: modal.activeFlavorIndex ?? null,
    activeEditor: captureActiveEditorRestoreState(),
    componentMetaModal: state.componentMetaModal ? { ...state.componentMetaModal } : null,
    modalSectionKey: state.modalSectionKey,
    flavorManager: modal.flavorManager ? { ...modal.flavorManager } : null,
    focus: typeof HTMLElement !== 'undefined' && active instanceof HTMLElement && scope?.contains(active)
      ? capturePreferredEditorTarget(active, scope) : null,
  };
}

function commitDraft(history: DraftHistory, context?: DraftContext): void {
  if (history.restoring) return;
  const group = history.pendingGroup;
  history.pending = false;
  history.pendingGroup = undefined;
  const current = snapshotDraft(history);
  if (context) current.context = context;
  const last = history.past.at(-1)!;
  if (last.signature === current.signature) {
    if (last.pendingSignature === current.pendingSignature) return;
    if (last.context.flavorManager?.mode !== current.context.flavorManager?.mode) {
      // Entering or leaving a draft form is navigation; edits within it are
      // undoable, including fields not yet applied to a flavor definition.
      history.past[history.past.length - 1] = current;
      return;
    }
  }
  const now = Date.now();
  if (group && history.lastGroup === group && now - history.lastAt < HISTORY_GROUP_WINDOW_MS && history.past.length > 1) {
    history.past[history.past.length - 1] = current;
  } else {
    history.past.push(current);
    if (history.past.length > 200) history.past.shift();
  }
  history.future = [];
  history.lastGroup = group;
  history.lastAt = now;
}

export function recordReusableDefinitionHistory(group?: string): void {
  const history = getDraftHistory();
  if (!history || history.restoring) return;
  if (group && !history.pendingGroup) history.pendingGroup = group;
  if (history.pending) return;
  history.pending = true;
  const runtime = getActiveStateRuntime();
  const owner = state.reusableDefinitionEditModal?.historyBeforeDraft;
  // Native event dispatch can run microtasks between capture and bubble
  // listeners. Wait until the dispatch finishes so all field/plugin handlers
  // have applied their mutations before taking the checkpoint.
  setTimeout(() => runWithStateRuntime(runtime, () => {
    if (state.reusableDefinitionEditModal?.historyBeforeDraft === owner && history.pending) commitDraft(history);
  }), 0);
}

export function bindReusableDefinitionHistory(modalRoot: HTMLElement): void {
  const history = getDraftHistory();
  if (!history) return;
  modalRoot.dataset.templateDraftHistory = 'true';
  history.root = modalRoot.closest<HTMLElement>('.hvy-document') ?? modalRoot.parentElement;
  const beforeInputTargets = new WeakSet<HTMLElement>();
  const beforeEdit = (event: Event): void => {
    if (history.restoring || !(event.target instanceof HTMLElement)) return;
    if (event.type !== 'input' && history.pending) commitDraft(history);
    // Refresh the pre-edit caret and active component without recording view
    // changes (opening metadata or switching flavors is not an undo step).
    if (!history.pending && !(event.type === 'input' && beforeInputTargets.has(event.target))) {
      history.past[history.past.length - 1].context = captureDraftContext(history);
    }
    if (event.type === 'beforeinput') {
      beforeInputTargets.add(event.target);
      return;
    }
    if (event.type === 'input') beforeInputTargets.delete(event.target);
    const target = event.target.closest<HTMLElement>('[data-field]');
    const group = event.type === 'beforeinput' || event.type === 'input'
      ? JSON.stringify(['template-input', target?.dataset.field, target?.dataset.sectionKey,
        target?.dataset.blockId, target?.dataset.variableName])
      : undefined;
    recordReusableDefinitionHistory(group);
  };
  for (const type of ['beforeinput', 'input', 'change', 'click']) {
    modalRoot.addEventListener(type, beforeEdit, { capture: true });
  }
}

function restoreDraftUi(
  history: DraftHistory,
  context: DraftContext,
  scroll: { className: string; top: number; left: number }[],
): void {
  const scope = history.root?.querySelector<HTMLElement>('#modalRoot');
  const preferred = context.focus;
  const target = preferred && scope?.querySelectorAll<HTMLElement>(
    `[data-field="${CSS.escape(preferred.field)}"]`
  ).item(preferred.fieldIndex ?? 0);
  if (target && preferred) {
    target.focus({ preventScroll: true });
    restorePreferredEditorSelection(target, preferred);
  }
  for (const saved of scroll) {
    const element = Array.from(scope?.querySelectorAll<HTMLElement>('.modal-panel, .reusable-definition-scroll-body') ?? [])
      .find((candidate) => candidate.className === saved.className);
    if (element) {
      element.scrollTop = saved.top;
      element.scrollLeft = saved.left;
    }
  }
}

/** Returns true whenever the draft owns navigation, including its boundaries. */
export function navigateReusableDefinitionHistory(direction: 'undo' | 'redo'): boolean {
  if (!state.reusableDefinitionEditModal) return false;
  const history = getDraftHistory();
  if (!history) return true;
  commitDraft(history);
  const scroll = Array.from(history.root?.querySelectorAll<HTMLElement>(
    '#modalRoot .modal-panel, #modalRoot .reusable-definition-scroll-body'
  ) ?? []).map((element) => ({ className: element.className, top: element.scrollTop, left: element.scrollLeft }));
  const context = captureDraftContext(history);
  const active = history.root?.ownerDocument.activeElement;
  // Some controls commit on change/blur. Finish that edit before choosing the
  // undo target, just as moving to another field would, and retain its caret.
  if (typeof HTMLElement !== 'undefined' && active instanceof HTMLElement && history.root?.contains(active)) {
    history.restoring = true;
    try {
      active.blur();
    } finally {
      history.restoring = false;
    }
  }
  commitDraft(history, context);
  if (direction === 'undo' ? history.past.length <= 1 : history.future.length === 0) {
    restoreDraftUi(history, context, scroll);
    return true;
  }
  if (direction === 'undo') {
    history.future.push(history.past.pop()!);
  } else {
    history.past.push(history.future.pop()!);
  }
  history.lastGroup = undefined;
  history.lastAt = 0;
  const entry = history.past.at(-1)!;
  const restored = JSON.parse(entry.content);
  const modal = state.reusableDefinitionEditModal;
  const key = modal.kind === 'component' ? 'component_defs' : 'section_defs';
  const definitions = state.document.meta[key] as unknown[];
  history.restoring = true;
  try {
    definitions[modal.index] = restored.definition;
    modal.draftName = restored.draftName;
    modal.pendingDocumentSync = restored.pendingDocumentSync;
    modal.activeFlavorIndex = entry.context.activeFlavorIndex;
    modal.flavorManager = entry.context.flavorManager ? { ...entry.context.flavorManager } : null;
    modal.error = null;
    state.componentMetaModal = entry.context.componentMetaModal;
    state.modalSectionKey = entry.context.modalSectionKey;
    clearActiveEditorBlock();
    state.activeTextEditorMode = null;
    state.pendingEditorActivation = null;
    restoreActiveEditorState(entry.context.activeEditor, null, findBlockByIds);
    getRenderApp()();
    restoreDraftUi(history, entry.context, scroll);
  } finally {
    history.restoring = false;
  }
  return true;
}
