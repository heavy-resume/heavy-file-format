import { findBlockByIds, updateInlineAnswerMarkerStates } from './block-ops';
import { getInlineAnswerGroupIndex, invalidateInlineAnswerGroupIndex } from './inline-answer-groups';
import { recordHistory } from './history';
import { syncReusableTemplateForBlock } from './reusable';
import { state } from './state';

/**
 * Applies a persisted inline answer selection to the document source.
 *
 * Radio groups may span components, so selecting one option has to clear every other
 * marker in the same group wherever it lives. Scoping this to the clicked block would
 * leave the browser's own radio-group behaviour (which is document-wide) disagreeing
 * with the saved text.
 */
export function applyPersistedAnswerSelection(input: HTMLInputElement): { sectionKey: string; blockId: string }[] {
  const shell = input.closest<HTMLElement>('[data-section-key][data-block-id]');
  const sectionKey = shell?.dataset.sectionKey ?? '';
  const blockId = shell?.dataset.blockId ?? '';
  const answerIndex = Number.parseInt(input.dataset.lineIndex ?? input.dataset.answerIndex ?? '', 10);
  if (!sectionKey || !blockId || Number.isNaN(answerIndex)) {
    return [];
  }
  const block = findBlockByIds(sectionKey, blockId);
  if (!block || block.schema.kind !== 'text') {
    return [];
  }

  recordHistory(`persisted-answer:${blockId}`);

  if (input.type !== 'radio') {
    block.text = updateInlineAnswerMarkerStates(block.text, new Map([[answerIndex, input.checked]]));
    syncReusableTemplateForBlock(sectionKey, blockId);
    // The index records which markers are selected, so it is stale the moment one changes.
    invalidateInlineAnswerGroupIndex();
    return [{ sectionKey, blockId }];
  }

  const groupKey = input.dataset.answerGroup ?? '';
  const members = getInlineAnswerGroupIndex(state.document.sections).byKey.get(groupKey)?.members ?? [
    { sectionKey, blockId, answerIndex, checked: input.checked },
  ];
  const statesByBlock = new Map<string, { sectionKey: string; blockId: string; states: Map<number, boolean> }>();
  members.forEach((member) => {
    const key = `${member.sectionKey}::${member.blockId}`;
    const entry = statesByBlock.get(key) ?? { sectionKey: member.sectionKey, blockId: member.blockId, states: new Map() };
    const selected = member.sectionKey === sectionKey && member.blockId === blockId && member.answerIndex === answerIndex;
    entry.states.set(member.answerIndex, selected && input.checked);
    statesByBlock.set(key, entry);
  });

  const touched: { sectionKey: string; blockId: string }[] = [];
  statesByBlock.forEach((entry) => {
    const memberBlock = findBlockByIds(entry.sectionKey, entry.blockId);
    if (!memberBlock || memberBlock.schema.kind !== 'text') {
      return;
    }
    const next = updateInlineAnswerMarkerStates(memberBlock.text, entry.states);
    if (next === memberBlock.text) {
      return;
    }
    memberBlock.text = next;
    syncReusableTemplateForBlock(entry.sectionKey, entry.blockId);
    touched.push({ sectionKey: entry.sectionKey, blockId: entry.blockId });
  });
  if (touched.length > 0) {
    invalidateInlineAnswerGroupIndex();
  }
  return touched;
}
