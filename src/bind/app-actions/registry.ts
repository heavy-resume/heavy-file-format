import { shellActions } from './shell';
import { rawEditorActions } from './raw-editor';
import { themeActions } from './theme';
import { chatActions } from './chat';
import { editorStateActions } from './editor-state';
import { reusableActions } from './reusable';
import type { AppActionHandler } from './types';

export const appActionRegistry: Record<string, AppActionHandler> = {
  ...shellActions,
  ...rawEditorActions,
  ...themeActions,
  ...chatActions,
  ...editorStateActions,
  ...reusableActions,
};
