import { state, getRenderApp } from '../../state';
import { isDefaultUntitledSectionTitle, getSectionId, moveSectionByOffset, removeSectionByKey, makeBlockSubsection, removeSubsection } from '../../section-ops';
import { setActiveEditorBlock } from '../../block-ops';
import { createEmptySection, instantiateReusableSection } from '../../document-factory';
import { recordHistory } from '../../history';
import { closeModalIfTarget, navigateToSection } from '../../navigation';
import type { ActionHandler } from './types';

const addTopLevelSection: ActionHandler = () => {
  recordHistory();
  const starter = state.addComponentBySection.__top_level__ ?? 'blank';
  const section = starter === 'blank' ? createEmptySection(1, '', false) : instantiateReusableSection(starter, 1);
  if (!section) {
    return;
  }
  state.document.sections.push(section);
  if (section.blocks[0]) {
    setActiveEditorBlock(section.key, section.blocks[0].id);
  } else {
    state.activeEditorSectionTitleKey = section.key;
    state.clearSectionTitleOnFocusKey = isDefaultUntitledSectionTitle(section.title) ? section.key : null;
  }
  getRenderApp()();
};

const spawnGhostChild: ActionHandler = ({ section }) => {
  if (!section || section.lock) {
    return;
  }
  recordHistory();
  const component = state.addComponentBySection[section.key] ?? 'container';
  const child = createEmptySection(Math.min(section.level + 1, 6), component, false);
  section.children.push(child);
  state.pendingEditorCenterSectionKey = child.key;
  getRenderApp()();
};

const toggleSectionLocation: ActionHandler = ({ section }) => {
  if (!section) {
    return;
  }
  recordHistory();
  section.location = section.location === 'sidebar' ? 'main' : 'sidebar';
  getRenderApp()();
};

const removeSubsectionAction: ActionHandler = ({ section, sectionKey }) => {
  if (!section) {
    return;
  }
  recordHistory();
  if (!removeSubsection(state.document.sections, sectionKey)) {
    return;
  }
  if (state.activeEditorSectionTitleKey === sectionKey) {
    state.activeEditorSectionTitleKey = null;
  }
  if (state.activeEditorBlock?.sectionKey === sectionKey) {
    state.activeEditorBlock = null;
  }
  getRenderApp()();
};

const removeSection: ActionHandler = ({ section, sectionKey }) => {
  if (!section) {
    return;
  }
  recordHistory();
  removeSectionByKey(state.document.sections, sectionKey);
  closeModalIfTarget(sectionKey);
  if (state.activeEditorSectionTitleKey === sectionKey) {
    state.activeEditorSectionTitleKey = null;
  }
  if (state.activeEditorBlock?.sectionKey === sectionKey) {
    state.activeEditorBlock = null;
  }
  getRenderApp()();
};

const moveSection = (offset: -1 | 1): ActionHandler => ({ section, sectionKey }) => {
  if (!section) {
    return;
  }
  recordHistory();
  if (moveSectionByOffset(state.document.sections, sectionKey, offset)) {
    getRenderApp()();
  }
};

const addChild: ActionHandler = ({ section }) => {
  if (!section || section.lock) {
    return;
  }
  recordHistory();
  const component = state.addComponentBySection[section.key] ?? 'container';
  const child = createEmptySection(Math.min(section.level + 1, 6), component, true);
  section.children.push(child);
  if (child.blocks[0]) {
    setActiveEditorBlock(child.key, child.blocks[0].id);
  }
  getRenderApp()();
};

const makeBlockSubsectionAction: ActionHandler = ({ section, sectionKey, blockId }) => {
  if (!section || section.lock || !blockId) {
    return;
  }
  recordHistory();
  const newSub = makeBlockSubsection(state.document.sections, sectionKey, blockId);
  if (!newSub) {
    return;
  }
  const movedBlock = newSub.blocks[0];
  if (movedBlock) {
    setActiveEditorBlock(newSub.key, movedBlock.id);
  }
  getRenderApp()();
};

const realizeGhost: ActionHandler = ({ section }) => {
  if (!section) {
    return;
  }
  recordHistory();
  section.isGhost = false;
  getRenderApp()();
};

const jumpToReader: ActionHandler = ({ section, app }) => {
  if (!section) {
    return;
  }
  navigateToSection(getSectionId(section), app);
};

export const sectionActions: Record<string, ActionHandler> = {
  'add-top-level-section': addTopLevelSection,
  'spawn-child-ghost': spawnGhostChild,
  'spawn-block-ghost': spawnGhostChild,
  'toggle-section-location': toggleSectionLocation,
  'remove-subsection': removeSubsectionAction,
  'remove-section': removeSection,
  'move-section-up': moveSection(-1),
  'move-section-down': moveSection(1),
  'add-child': addChild,
  'make-block-subsection': makeBlockSubsectionAction,
  'realize-ghost': realizeGhost,
  'jump-to-reader': jumpToReader,
};
