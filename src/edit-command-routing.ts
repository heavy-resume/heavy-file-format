let nextUndoTargetsDocument = false;

export function routeNextUndoToDocument(): void {
  nextUndoTargetsDocument = true;
}

export function consumeNextUndoTargetsDocument(): boolean {
  const shouldRouteToDocument = nextUndoTargetsDocument;
  nextUndoTargetsDocument = false;
  return shouldRouteToDocument;
}

export function clearNextUndoTargetsDocument(): void {
  nextUndoTargetsDocument = false;
}
