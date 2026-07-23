let nextUndoTargetsDocument = false;
let nextRedoTargetsDocument = false;
let nextNativeUndoSuppressed = false;

export function routeNextUndoToDocument(): void {
  nextUndoTargetsDocument = true;
}

export function routeNextRedoToDocument(): void {
  nextRedoTargetsDocument = true;
}

export function consumeNextUndoTargetsDocument(): boolean {
  const shouldRouteToDocument = nextUndoTargetsDocument;
  nextUndoTargetsDocument = false;
  return shouldRouteToDocument;
}

export function consumeNextRedoTargetsDocument(): boolean {
  const shouldRouteToDocument = nextRedoTargetsDocument;
  nextRedoTargetsDocument = false;
  return shouldRouteToDocument;
}

export function suppressNextNativeUndo(): void {
  nextNativeUndoSuppressed = true;
}

export function consumeNextNativeUndoSuppressed(): boolean {
  const shouldSuppress = nextNativeUndoSuppressed;
  nextNativeUndoSuppressed = false;
  return shouldSuppress;
}

export function clearNextUndoTargetsDocument(): void {
  nextUndoTargetsDocument = false;
  nextRedoTargetsDocument = false;
  nextNativeUndoSuppressed = false;
}
