import type { VisualSection } from '../../editor/types';

export interface ActionContext {
  app: HTMLElement;
  actionButton: HTMLElement;
  sectionKey: string;
  blockId: string;
  section: VisualSection | null;
  reusableName: string | null;
}

export type ActionHandler = (ctx: ActionContext) => void;
