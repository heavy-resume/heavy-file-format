import { getActiveStateRuntime, type StateRuntime } from '../../state';
import type { VisualDocument } from '../../types';

export type HvySaveStatus = 'saved' | 'canceled';

export interface HvySaveRequest {
  reason: string;
  filename: string;
  document: VisualDocument;
  serializeDocumentBytes(): Uint8Array;
  serializeDocumentBytesAsync(): Promise<Uint8Array>;
}

export type HvySaveRequestHandler = (
  request: HvySaveRequest
) => HvySaveStatus | boolean | void | Promise<HvySaveStatus | boolean | void>;

const handlers = new WeakMap<StateRuntime, HvySaveRequestHandler>();

export function setSaveRequestHandler(
  handler: HvySaveRequestHandler | null,
  runtime: StateRuntime = getActiveStateRuntime()
): void {
  if (handler) handlers.set(runtime, handler);
  else handlers.delete(runtime);
}

export function getSaveRequestHandler(
  runtime: StateRuntime = getActiveStateRuntime()
): HvySaveRequestHandler | null {
  return handlers.get(runtime) ?? null;
}

export function clearSaveRequestHandler(runtime: StateRuntime): void {
  handlers.delete(runtime);
}
