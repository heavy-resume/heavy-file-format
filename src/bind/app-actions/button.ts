import { runButtonAiGenerate } from '../../editor/components/button/button-actions';
import type { AppActionHandler } from './types';

const runButtonGenerate: AppActionHandler = ({ app, actionButton, event, sectionKey, blockId }) => {
  void runButtonAiGenerate(app, actionButton, sectionKey, blockId, { startedByUser: event.isTrusted });
};

export const buttonActions: Record<string, AppActionHandler> = {
  'run-button-ai-generate': runButtonGenerate,
};
