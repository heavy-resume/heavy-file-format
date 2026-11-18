// Canvas tool and layer icons. Shared icons (plus, close, arrows) come from src/icons.ts.

function icon(paths: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
}

export function canvasSelectIcon(): string {
  return icon('<path d="M5.5 3.5 18 12.2l-5.6 1.1 3.2 5.9-2.4 1.3-3.2-5.9-4.3 3.7Z"/>');
}

export function canvasHandIcon(): string {
  return icon('<path d="M8 12.5V6.8a1.4 1.4 0 0 1 2.8 0v4.7M10.8 11V5.3a1.4 1.4 0 0 1 2.8 0V11M13.6 11V6.3a1.4 1.4 0 0 1 2.8 0V12M16.4 10.2a1.4 1.4 0 0 1 2.8 0v4.3c0 3.6-2.6 6-6 6h-1.3c-2 0-3.3-.8-4.5-2.3l-2.8-3.6a1.5 1.5 0 0 1 2.2-2l1.2 1.2"/>');
}

export function canvasExpandIcon(): string {
  return icon('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>');
}

export function canvasCollapseIcon(): string {
  return icon('<path d="M20 4l-6 6M14 5v5h5M4 20l6-6M10 19v-5H5"/>');
}

export function canvasBrushIcon(): string {
  return icon('<path d="m14.5 5.5 4-4 4 4-4 4M13 7l4 4-8.5 8.5c-1.5 1.5-4.2 1.7-6.5.5 1.2-2.3 1-5 2.5-6.5L13 7Z"/>');
}

export function canvasEraserIcon(): string {
  return icon('<path d="m14.5 4.5 5 5a2 2 0 0 1 0 2.8l-7.2 7.2H7.5l-3-3a2 2 0 0 1 0-2.8l7.2-7.2a2 2 0 0 1 2.8 0ZM9 19.5l-4-4M12.5 19.5H21"/>');
}

export function canvasFillIcon(): string {
  return icon('<path d="m7 3 10 10-6.5 6.5a2.2 2.2 0 0 1-3 0l-4-4a2.2 2.2 0 0 1 0-3L13 3M5 11h12M19 17.5s-2 2.2-2 3.3a2 2 0 0 0 4 0c0-1.1-2-3.3-2-3.3Z"/>');
}

export function canvasRectIcon(): string {
  return icon('<rect x="4" y="6" width="16" height="12" rx="1.5"/>');
}

export function canvasEllipseIcon(): string {
  return icon('<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>');
}

export function canvasArrowIcon(): string {
  return icon('<path d="M4 19C8 9 13 7 19 6M14.5 4.5 19 6l-2.2 4.2"/>');
}

export function canvasTextIcon(): string {
  return icon('<path d="M5 6.5V5h14v1.5M12 5v14M9 19h6"/>');
}

export function canvasGripIcon(): string {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="9" cy="6.5" r="1.6"/><circle cx="15" cy="6.5" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="17.5" r="1.6"/><circle cx="15" cy="17.5" r="1.6"/></g></svg>';
}

export function canvasEyeIcon(): string {
  return icon('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>');
}

export function canvasEyeOffIcon(): string {
  return icon('<path d="M4 4l16 16M9.9 6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.2 7.6A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.1-1"/><path d="M10 10.1a2.8 2.8 0 0 0 3.9 3.9"/>');
}

export function canvasLockIcon(): string {
  return icon('<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>');
}

export function canvasUnlockIcon(): string {
  return icon('<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 7.6-1.7"/>');
}

// Line style segments: the body shows the dash style, the ends show whether a
// head is present. Drawn heavier than the tool icons so the small segments
// read clearly.
const LINE_STYLE_STROKE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

export function canvasLineBodyIcon(dash: 'solid' | 'dashed' | 'dotted'): string {
  const pattern = dash === 'dashed' ? ' stroke-dasharray="4.5 3.5"' : dash === 'dotted' ? ' stroke-dasharray="0.1 4.2"' : '';
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18" ${LINE_STYLE_STROKE} stroke-width="3"${pattern}/></svg>`;
}

export function canvasLineHeadIcon(side: 'start' | 'end', end: 'arrow' | 'round' | null): string {
  const stub = side === 'start' ? 'M9 12h12' : 'M3 12h12';
  const body = `<path d="${stub}" ${LINE_STYLE_STROKE} stroke-width="2.8"${end ? '' : ' opacity="0.45"'}/>`;
  if (end === 'round') return `<svg viewBox="0 0 24 24" aria-hidden="true">${body}<circle cx="${side === 'start' ? 9 : 15}" cy="12" r="4" fill="currentColor"/></svg>`;
  const tip = side === 'start' ? 'M14 6.5 8.5 12l5.5 5.5' : 'M10 6.5l5.5 5.5-5.5 5.5';
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${body}${end === 'arrow' ? `<path d="${tip}" ${LINE_STYLE_STROKE} stroke-width="2.8"/>` : ''}</svg>`;
}
