import type { CanvasPoint } from './canvas-drawing-format';
import { distanceToSegment } from './canvas-shapes';

// Best-fit lines for freehand line drawing. A drag is sampled at a fixed rate;
// the line runs from the press point to the current pointer and is either
// straight or a quadratic curve through a fitted control point. Everything is
// O(samples) with at most MAX_LINE_SAMPLES samples, so it is safe to run on
// every pointer move.

export const LINE_SAMPLE_INTERVAL_MS = 200;
export const MAX_LINE_SAMPLES = 10;

export interface CanvasLineFit {
  // Null for a straight line.
  control: CanvasPoint | null;
  // Distance of each sample from the fitted line, in sample order.
  residuals: number[];
}

// Chooses straight unless the samples stray from the straight line by more
// than `tolerance` (root mean square). A curve always fits at least as well as
// a straight line, so straight wins whenever it is good enough.
export function fitCanvasLine(start: CanvasPoint, end: CanvasPoint, samples: CanvasPoint[], tolerance: number): CanvasLineFit {
  const straight = samples.map((sample) => distanceToSegment(sample, start, end));
  if (samples.length === 0 || rootMeanSquare(straight) <= tolerance) {
    return { control: null, residuals: straight };
  }
  const control = fitQuadraticControl(start, end, samples);
  if (!control) return { control: null, residuals: straight };
  const ts = chordParameters(start, end, samples);
  const curved = samples.map((sample, index) => {
    const point = quadraticPoint(start, control, end, ts[index]!);
    return Math.hypot(sample.x - point.x, sample.y - point.y);
  });
  return { control, residuals: curved };
}

// Adds a sample and, past the limit, drops the sample whose removal loses the
// least coverage: the one whose neighbors (in drawing order, with the press
// point and the current end as the outer neighbors) are closest together.
// This keeps the samples evenly spread over the whole drag. The samples with
// the highest and lowest x and y are never dropped, so the drag's extent is
// kept. Fit error plays no part here; it only decides between straight and
// curved.
export function addCanvasLineSample(start: CanvasPoint, end: CanvasPoint, samples: CanvasPoint[], sample: CanvasPoint): CanvasPoint[] {
  const next = [...samples, sample];
  if (next.length <= MAX_LINE_SAMPLES) return next;
  const extremes = extremeSampleIndexes(next);
  let smallestSpan = Infinity;
  let drop = -1;
  for (let index = 0; index < next.length; index += 1) {
    if (extremes.has(index)) continue;
    const before = index === 0 ? start : next[index - 1]!;
    const after = index === next.length - 1 ? end : next[index + 1]!;
    const span = Math.hypot(after.x - before.x, after.y - before.y);
    if (span < smallestSpan) {
      smallestSpan = span;
      drop = index;
    }
  }
  if (drop >= 0) next.splice(drop, 1);
  return next;
}

function extremeSampleIndexes(samples: CanvasPoint[]): Set<number> {
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const sample = samples[index]!;
    if (sample.x < samples[minX]!.x) minX = index;
    if (sample.x > samples[maxX]!.x) maxX = index;
    if (sample.y < samples[minY]!.y) minY = index;
    if (sample.y > samples[maxY]!.y) maxY = index;
  }
  return new Set([minX, maxX, minY, maxY]);
}

// Least-squares control point of a quadratic curve with fixed ends. With the
// samples placed at chord-length parameters t, the curve point is
// a(t)·start + b(t)·control + c(t)·end, so the best control point is a
// closed-form weighted average.
function fitQuadraticControl(start: CanvasPoint, end: CanvasPoint, samples: CanvasPoint[]): CanvasPoint | null {
  const ts = chordParameters(start, end, samples);
  let sumX = 0;
  let sumY = 0;
  let sumWeight = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const t = ts[index]!;
    const u = 1 - t;
    const b = 2 * u * t;
    if (b <= 0) continue;
    const sample = samples[index]!;
    sumX += b * (sample.x - u * u * start.x - t * t * end.x);
    sumY += b * (sample.y - u * u * start.y - t * t * end.y);
    sumWeight += b * b;
  }
  return sumWeight > 1e-9 ? { x: sumX / sumWeight, y: sumY / sumWeight } : null;
}

// Each sample's position along the path start → samples → end, from 0 to 1.
function chordParameters(start: CanvasPoint, end: CanvasPoint, samples: CanvasPoint[]): number[] {
  const lengths: number[] = [];
  let total = 0;
  let previous = start;
  for (const sample of samples) {
    total += Math.hypot(sample.x - previous.x, sample.y - previous.y);
    lengths.push(total);
    previous = sample;
  }
  total += Math.hypot(end.x - previous.x, end.y - previous.y);
  return total > 1e-9 ? lengths.map((length) => length / total) : lengths.map(() => 0.5);
}

function quadraticPoint(start: CanvasPoint, control: CanvasPoint, end: CanvasPoint, t: number): CanvasPoint {
  const u = 1 - t;
  return {
    x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
    y: u * u * start.y + 2 * u * t * control.y + t * t * end.y,
  };
}

function rootMeanSquare(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value * value;
  return values.length > 0 ? Math.sqrt(sum / values.length) : 0;
}
