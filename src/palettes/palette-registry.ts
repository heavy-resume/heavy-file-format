import blackWidowCss from './black-widow-palette.css?inline';
import mochaCss from './mocha-palette.css?inline';
import paperCss from './paper-palette.css?inline';
import petrichorCss from './petrichor-palette.css?inline';
import springCss from './spring-palette.css?inline';
import ufoCss from './ufo-palette.css?inline';

export interface HvyPalette {
  id: string;
  name: string;
  description: string;
  css: string;
  colors: Record<string, string>;
}

interface PaletteSource {
  id: string;
  name: string;
  description: string;
  css: string;
}

const PALETTE_SOURCES: readonly PaletteSource[] = [
  {
    id: 'black-widow',
    name: 'Black Widow',
    description: 'High contrast black, crimson, and signal green.',
    css: blackWidowCss,
  },
  {
    id: 'mocha',
    name: 'Mocha',
    description: 'Warm taupe, ceramic gray, and roasted brown.',
    css: mochaCss,
  },
  {
    id: 'paper',
    name: 'Paper',
    description: 'Quiet paper whites with garden-green accents.',
    css: paperCss,
  },
  {
    id: 'petrichor',
    name: 'Petrichor',
    description: 'Rainy blue, lavender, cyan, and damp violet.',
    css: petrichorCss,
  },
  {
    id: 'spring',
    name: 'Spring',
    description: 'Fresh greens with teal and violet contrast.',
    css: springCss,
  },
  {
    id: 'ufo',
    name: 'UFO',
    description: 'Dark graphite with saturated green console light.',
    css: ufoCss,
  },
];

export const HVY_PALETTES: readonly HvyPalette[] = PALETTE_SOURCES.map((palette) => ({
  ...palette,
  colors: parsePaletteCss(palette.css),
}));

export function getPaletteById(id: string): HvyPalette | null {
  return HVY_PALETTES.find((palette) => palette.id === id) ?? null;
}

export function getMatchedPaletteId(colors: Record<string, string>): string | null {
  for (const palette of HVY_PALETTES) {
    if (Object.keys(palette.colors).length === 0) {
      continue;
    }
    if (Object.entries(palette.colors).every(([name, value]) => colors[name]?.trim() === value.trim())) {
      return palette.id;
    }
  }
  return null;
}

export function parsePaletteCss(css: string): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const match of css.matchAll(/(--hvy-[\w-]+)\s*:\s*([^;]+);/g)) {
    colors[match[1]] = match[2].trim();
  }
  return colors;
}
