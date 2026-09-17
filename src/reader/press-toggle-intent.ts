// Click-to-toggle surfaces (expandables, etc.) also contain readable text. A press that is held
// or that ends with a text selection is the user selecting for copy, not asking to toggle.

const PRESS_HOLD_THRESHOLD_MS = 350;

const trackedDocuments = new WeakSet<Document>();
let lastPressStartedAt: number | null = null;

export function trackPressToggleIntent(root: HTMLElement): void {
  const doc = root.ownerDocument;
  if (!doc?.addEventListener || trackedDocuments.has(doc)) {
    return;
  }
  trackedDocuments.add(doc);
  doc.addEventListener('pointerdown', (event) => {
    lastPressStartedAt = event.isPrimary ? event.timeStamp : lastPressStartedAt;
  }, { capture: true });
}

export function isPressSelectingText(event: Event, toggleSurface: HTMLElement): boolean {
  return wasPressHeld(event) || hasSelectionWithin(toggleSurface);
}

function wasPressHeld(event: Event): boolean {
  if (!(event instanceof MouseEvent) || event.detail === 0 || lastPressStartedAt === null) {
    return false;
  }
  return event.timeStamp - lastPressStartedAt >= PRESS_HOLD_THRESHOLD_MS;
}

function hasSelectionWithin(toggleSurface: HTMLElement): boolean {
  const selection = toggleSurface.ownerDocument.defaultView?.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) {
    return false;
  }
  const range = selection.getRangeAt(0);
  return range.toString().trim().length > 0 && range.intersectsNode(toggleSurface);
}
