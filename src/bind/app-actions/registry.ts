import { shellActions } from './shell';
import { rawEditorActions } from './raw-editor';
import { themeActions } from './theme';
import { chatActions } from './chat';
import { editorStateActions } from './editor-state';
import { reusableActions } from './reusable';
import { searchActions } from './search';
import { buttonActions } from './button';
import { textLineStyleActions } from './text-line-style';
import type { AppActionHandler } from './types';

export const appActionRegistry: Record<string, AppActionHandler> = {
  ...shellActions,
  ...rawEditorActions,
  ...themeActions,
  ...chatActions,
  ...editorStateActions,
  ...reusableActions,
  ...searchActions,
  ...buttonActions,
  ...textLineStyleActions,
};
