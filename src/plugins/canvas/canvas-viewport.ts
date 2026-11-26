import type { CanvasPoint } from './canvas-drawing-format';
import { canvasCollapseIcon, canvasExpandIcon } from './canvas-icons';

// The editor shows the artboard (the canvas's width x height, in CSS pixels at
// 100% zoom) through a window that can zoom and pan. `panX`/`panY` are the
// logical coordinates at the window's top-left corner.

export interface CanvasView {
  zoom: number;
  panX: number;
  panY: number;
}

export const MIN_CANVAS_ZOOM = 0.1;
export const MAX_CANVAS_ZOOM = 8;
const ZOOM_STEP = 1.25;
// Zoom doubles every 1 / WHEEL_ZOOM_SENSITIVITY wheel units with Cmd/Ctrl or a
// trackpad pinch (which browsers report as Ctrl+wheel).
const WHEEL_ZOOM_SENSITIVITY = 0.00375;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
}

// Fits the whole artboard in the window, centered.
export function fitView(artWidth: number, artHeight: number, viewWidth: number, viewHeight: number): CanvasView {
  const zoom = clampZoom(Math.min(viewWidth / artWidth, viewHeight / artHeight));
  return centeredView(zoom, artWidth, artHeight, viewWidth, viewHeight);
}

// 100% when the artboard fits the window, otherwise fit.
export function initialView(artWidth: number, artHeight: number, viewWidth: number, viewHeight: number): CanvasView {
  return artWidth <= viewWidth && artHeight <= viewHeight
    ? centeredView(1, artWidth, artHeight, viewWidth, viewHeight)
    : fitView(artWidth, artHeight, viewWidth, viewHeight);
}

export function centeredView(zoom: number, artWidth: number, artHeight: number, viewWidth: number, viewHeight: number): CanvasView {
  return {
    zoom,
    panX: (artWidth - viewWidth / zoom) / 2,
    panY: (artHeight - viewHeight / zoom) / 2,
  };
}

// Zooms by `factor` keeping the logical point under `anchor` (window CSS
// pixels) in place.
export function zoomViewAt(view: CanvasView, factor: number, anchor: CanvasPoint): CanvasView {
  const zoom = clampZoom(view.zoom * factor);
  const logicalX = view.panX + anchor.x / view.zoom;
  const logicalY = view.panY + anchor.y / view.zoom;
  return { zoom, panX: logicalX - anchor.x / zoom, panY: logicalY - anchor.y / zoom };
}

// Keeps at least a quarter of the window over the artboard on each axis, so the
// artboard can't be panned out of sight.
export function clampView(view: CanvasView, artWidth: number, artHeight: number, viewWidth: number, viewHeight: number): CanvasView {
  const visibleWidth = viewWidth / view.zoom;
  const visibleHeight = viewHeight / view.zoom;
  const clampAxis = (pan: number, art: number, visible: number) => {
    const slack = visible * 0.75;
    const low = Math.min(0, art - visible) - slack;
    const high = Math.max(0, art - visible) + slack;
    return Math.min(high, Math.max(low, pan));
  };
  return { zoom: view.zoom, panX: clampAxis(view.panX, artWidth, visibleWidth), panY: clampAxis(view.panY, artHeight, visibleHeight) };
}

export function viewToLogical(view: CanvasView, point: CanvasPoint): CanvasPoint {
  return { x: view.panX + point.x / view.zoom, y: view.panY + point.y / view.zoom };
}

export function logicalToView(view: CanvasView, point: CanvasPoint): CanvasPoint {
  return { x: (point.x - view.panX) * view.zoom, y: (point.y - view.panY) * view.zoom };
}

// WebKit's non-standard GestureEvent (not in the DOM type library).
interface WebKitGestureEvent extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}

export interface CanvasViewportHost {
  surface: HTMLCanvasElement;
  frame: HTMLElement;
  enabled(): boolean;
  view(): CanvasView;
  // Sets the view (already clamped by the host) and repaints.
  setView(view: CanvasView, fit: boolean): void;
  fit(): void;
  // Ends any in-progress drawing gesture before a pinch takes over.
  cancelGesture(): void;
  // The hand tool turns a primary-button drag into a pan.
  isHandTool(): boolean;
  // The expand/collapse control at the end of the zoom controls.
  isExpanded(): boolean;
  toggleExpanded(): void;
}

// Wheel (pan; Cmd/Ctrl or trackpad pinch zooms) once the canvas has focus,
// two-finger touch pinch, and the zoom controls overlaid on the window's corner.
export function attachCanvasViewport(host: CanvasViewportHost): { controls: HTMLElement; refreshControls(): void } {
  const { surface, frame } = host;

  const anchorFromClient = (clientX: number, clientY: number): CanvasPoint => {
    const rect = surface.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  // WebKit (Safari, WKWebView in Tauri) reports trackpad pinches as gesture
  // events with a cumulative `scale` rather than as Ctrl+wheel. While one is in
  // progress, any Ctrl+wheel events are ignored so the pinch isn't counted twice.
  let gestureScale: number | null = null;

  // Only a focused canvas takes the wheel: scrolling the page past an
  // unfocused canvas must keep scrolling the page.
  surface.addEventListener('wheel', (event) => {
    if (!host.enabled() || document.activeElement !== surface) return;
    const view = host.view();
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      if (gestureScale !== null) return;
      host.setView(zoomViewAt(view, Math.pow(2, -event.deltaY * WHEEL_ZOOM_SENSITIVITY), anchorFromClient(event.clientX, event.clientY)), false);
      return;
    }
    const next = { ...view, panX: view.panX + event.deltaX / view.zoom, panY: view.panY + event.deltaY / view.zoom };
    host.setView(next, false);
    // At a pan limit the page scrolls instead.
    const moved = host.view().panX !== view.panX || host.view().panY !== view.panY;
    if (moved) event.preventDefault();
  }, { passive: false });

  // Two touches pinch-zoom and pan together; a single touch draws as usual.
  const touches = new Map<number, CanvasPoint>();

  // Same focus rule as the wheel. iOS also sends gesture events for touch
  // pinches, which the touch handling below already zooms, so those are ignored.
  surface.addEventListener('gesturestart', (event) => {
    if (!host.enabled() || document.activeElement !== surface || touches.size > 1) return;
    event.preventDefault();
    gestureScale = (event as WebKitGestureEvent).scale || 1;
  });
  surface.addEventListener('gesturechange', (event) => {
    if (gestureScale === null) return;
    event.preventDefault();
    const gesture = event as WebKitGestureEvent;
    const scale = gesture.scale || gestureScale;
    host.setView(zoomViewAt(host.view(), scale / gestureScale, anchorFromClient(gesture.clientX, gesture.clientY)), false);
    gestureScale = scale;
  });
  surface.addEventListener('gestureend', (event) => {
    if (gestureScale === null) return;
    event.preventDefault();
    gestureScale = null;
  });
  let pinch: { distance: number; center: CanvasPoint } | null = null;
  const pinchState = () => {
    const [a, b] = [...touches.values()];
    return { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), center: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 } };
  };
  surface.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' || !host.enabled()) return;
    touches.set(event.pointerId, anchorFromClient(event.clientX, event.clientY));
    if (touches.size === 2) {
      host.cancelGesture();
      pinch = pinchState();
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  }, { capture: true });
  surface.addEventListener('pointermove', (event) => {
    if (!touches.has(event.pointerId)) return;
    touches.set(event.pointerId, anchorFromClient(event.clientX, event.clientY));
    if (!pinch || touches.size !== 2) return;
    event.stopImmediatePropagation();
    const next = pinchState();
    const view = host.view();
    const zoomed = zoomViewAt(view, next.distance / Math.max(1, pinch.distance), next.center);
    host.setView({ ...zoomed, panX: zoomed.panX - (next.center.x - pinch.center.x) / zoomed.zoom, panY: zoomed.panY - (next.center.y - pinch.center.y) / zoomed.zoom }, false);
    pinch = next;
  }, { capture: true });
  const endTouch = (event: PointerEvent) => {
    if (!touches.delete(event.pointerId)) return;
    if (pinch) event.stopImmediatePropagation();
    if (touches.size < 2) pinch = null;
  };
  surface.addEventListener('pointerup', endTouch, { capture: true });
  surface.addEventListener('pointercancel', endTouch, { capture: true });

  // Drag to pan: the hand tool's primary button, or the middle button with any
  // tool. Handled before drawing so it works on locked or hidden layers too.
  let panDrag: { pointerId: number; clientX: number; clientY: number; view: CanvasView } | null = null;
  surface.addEventListener('pointerdown', (event) => {
    if (!host.enabled() || event.pointerType === 'touch' && touches.size > 1) return;
    const panning = event.button === 1 || (event.button === 0 && host.isHandTool());
    if (!panning) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    surface.focus({ preventScroll: true });
    surface.setPointerCapture(event.pointerId);
    surface.classList.add('is-panning');
    panDrag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, view: host.view() };
  }, { capture: true });
  surface.addEventListener('pointermove', (event) => {
    if (!panDrag || event.pointerId !== panDrag.pointerId) return;
    event.stopImmediatePropagation();
    const { zoom, panX, panY } = panDrag.view;
    host.setView({ zoom, panX: panX - (event.clientX - panDrag.clientX) / zoom, panY: panY - (event.clientY - panDrag.clientY) / zoom }, false);
  }, { capture: true });
  const endPan = (event: PointerEvent) => {
    if (!panDrag || event.pointerId !== panDrag.pointerId) return;
    event.stopImmediatePropagation();
    panDrag = null;
    surface.classList.remove('is-panning');
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
  };
  surface.addEventListener('pointerup', endPan, { capture: true });
  surface.addEventListener('pointercancel', endPan, { capture: true });

  const controls = document.createElement('div');
  controls.className = 'hvy-canvas-zoom-controls';
  const button = (label: string, content: string, run: () => void) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'ghost hvy-canvas-zoom-button';
    element.title = label;
    element.setAttribute('aria-label', label);
    element.innerHTML = content;
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      run();
    });
    return element;
  };
  const center = (): CanvasPoint => ({ x: surface.clientWidth / 2, y: surface.clientHeight / 2 });
  const minus = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const plus = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const fitIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const percent = button('Zoom to 100%', '100%', () => host.setView(zoomViewAt(host.view(), 1 / host.view().zoom, center()), false));
  percent.classList.add('is-percent');
  const expand = button('Expand canvas', canvasExpandIcon(), () => host.toggleExpanded());
  expand.classList.add('is-expand');
  controls.append(
    button('Zoom out', minus, () => host.setView(zoomViewAt(host.view(), 1 / ZOOM_STEP, center()), false)),
    percent,
    button('Zoom in', plus, () => host.setView(zoomViewAt(host.view(), ZOOM_STEP, center()), false)),
    button('Fit to window', fitIcon, () => host.fit()),
    expand,
  );
  // The controls belong to the canvas: clicks must not reach the editor block.
  controls.addEventListener('pointerdown', (event) => event.stopPropagation());
  controls.addEventListener('click', (event) => event.stopPropagation());
  frame.appendChild(controls);

  return {
    controls,
    refreshControls() {
      controls.hidden = !host.enabled();
      percent.textContent = `${Math.round(host.view().zoom * 100)}%`;
      const expanded = host.isExpanded();
      const label = expanded ? 'Collapse canvas' : 'Expand canvas';
      if (expand.getAttribute('aria-label') !== label) {
        expand.title = label;
        expand.setAttribute('aria-label', label);
        expand.setAttribute('aria-pressed', String(expanded));
        expand.innerHTML = expanded ? canvasCollapseIcon() : canvasExpandIcon();
      }
    },
  };
}
