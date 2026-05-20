const clickTraceIds = new WeakMap<Event, number>();
let nextClickTraceId = 1;

export function logClickTrace(event: Event, stage: string, details: Record<string, unknown> = {}): void {
  const target = event.target instanceof HTMLElement ? event.target : null;
  console.debug('[hvy:click-trace]', {
    clickId: getClickTraceId(event),
    stage,
    eventType: event.type,
    eventPhase: event.eventPhase,
    defaultPrevented: event.defaultPrevented,
    cancelBubble: event.cancelBubble,
    target: describeClickElement(target),
    currentTarget: describeClickElement(event.currentTarget instanceof Element ? event.currentTarget : null),
    nearestAction: describeClickElement(target?.closest('[data-action]')),
    nearestReaderAction: describeClickElement(target?.closest('[data-reader-action]')),
    nearestReaderBlock: describeClickElement(target?.closest('.reader-block')),
    nearestEditorBlock: describeClickElement(target?.closest('.editor-block')),
    composedPath: typeof event.composedPath === 'function'
      ? event.composedPath().slice(0, 10).map((item) => describeClickPathItem(item))
      : [],
    ...details,
  });
}

export function describeClickElement(element: Element | null | undefined): Record<string, string | null> | null {
  if (!element) {
    return null;
  }
  const htmlElement = element as HTMLElement;
  return {
    tag: element.tagName.toLowerCase(),
    id: htmlElement.id || null,
    className: typeof htmlElement.className === 'string' ? htmlElement.className : null,
    action: htmlElement.dataset?.action ?? null,
    readerAction: htmlElement.dataset?.readerAction ?? null,
    component: htmlElement.dataset?.component ?? null,
    componentId: htmlElement.dataset?.componentId ?? null,
    sectionKey: htmlElement.dataset?.sectionKey ?? null,
    blockId: htmlElement.dataset?.blockId ?? null,
    activeBlockId: htmlElement.dataset?.activeBlockId ?? null,
    text: htmlElement.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? null,
  };
}

function getClickTraceId(event: Event): number {
  const existing = clickTraceIds.get(event);
  if (existing) {
    return existing;
  }
  const next = nextClickTraceId;
  nextClickTraceId += 1;
  clickTraceIds.set(event, next);
  return next;
}

function describeClickPathItem(item: EventTarget): Record<string, string | null> | string | null {
  return item instanceof Element ? describeClickElement(item) : Object.prototype.toString.call(item);
}
