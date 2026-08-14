export interface TableColumnTextSample {
  source: HTMLElement;
  text: string;
  padding: number;
}

export function clampTableColumnWidth(width: number, minimum = 64, maximum = Number.POSITIVE_INFINITY): number {
  return Math.max(minimum, Math.min(width, maximum));
}

export function measureTableColumnTextSamples(
  root: HTMLElement,
  samples: TableColumnTextSample[],
  options: { minimum?: number; maximum?: number } = {}
): number {
  const measurer = document.createElement('span');
  Object.assign(measurer.style, {
    position: 'absolute',
    visibility: 'hidden',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  });
  let width = options.minimum ?? 64;
  for (const sample of samples) {
    const style = getComputedStyle(sample.source);
    measurer.style.font = style.font;
    measurer.style.letterSpacing = style.letterSpacing;
    measurer.textContent = sample.text || ' ';
    root.append(measurer);
    width = Math.max(width, measurer.getBoundingClientRect().width + sample.padding);
    measurer.remove();
  }
  return Math.round(clampTableColumnWidth(width, options.minimum, options.maximum));
}
