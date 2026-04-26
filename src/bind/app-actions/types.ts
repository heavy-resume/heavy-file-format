export interface AppActionContext {
  app: HTMLElement;
  actionButton: HTMLElement;
  event: MouseEvent;
  sectionKey: string;
  blockId: string;
  target: HTMLElement;
}

export type AppActionHandler = (ctx: AppActionContext) => void;
