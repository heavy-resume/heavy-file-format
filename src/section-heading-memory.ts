import { state } from './state';

const LAST_EMPTY_SECTION_HEADING_KEY = 'empty-heading:last-used';

export type EmptySectionHeadingLevel = 'h1' | 'h2' | 'h3';

export function normalizeEmptySectionHeadingLevel(value: string | undefined): EmptySectionHeadingLevel {
  if (value === 'h2' || value === 'h3') {
    return value;
  }
  return 'h1';
}

export function getEmptySectionHeadingLevel(sectionKey: string): EmptySectionHeadingLevel {
  return normalizeEmptySectionHeadingLevel(
    state.addComponentBySection[`empty-heading:${sectionKey}`] ?? state.addComponentBySection[LAST_EMPTY_SECTION_HEADING_KEY]
  );
}

export function rememberEmptySectionHeadingLevel(sectionKey: string, value: string | undefined): EmptySectionHeadingLevel {
  const level = normalizeEmptySectionHeadingLevel(value);
  state.addComponentBySection[`empty-heading:${sectionKey}`] = level;
  state.addComponentBySection[LAST_EMPTY_SECTION_HEADING_KEY] = level;
  return level;
}

export function emptySectionHeadingLevelToNumber(level: EmptySectionHeadingLevel): 1 | 2 | 3 {
  if (level === 'h2') {
    return 2;
  }
  if (level === 'h3') {
    return 3;
  }
  return 1;
}
