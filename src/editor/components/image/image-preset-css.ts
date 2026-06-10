interface ImagePresetDefinition {
  /** Properties this preset writes onto the block. */
  props: Record<string, string>;
  /** Properties this preset clears before writing props. */
  controls: string[];
}

const POSITION_CONTROLS = ['margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'display'];
const SIZE_CONTROLS = ['width', 'height', 'display'];

const IMAGE_PRESETS: Record<string, ImagePresetDefinition> = {
  left: {
    props: { margin: '0.5rem auto 0.5rem 0', display: 'block' },
    controls: POSITION_CONTROLS,
  },
  center: {
    props: { margin: '0.5rem auto', display: 'block' },
    controls: POSITION_CONTROLS,
  },
  right: {
    props: { margin: '0.5rem 0 0.5rem auto', display: 'block' },
    controls: POSITION_CONTROLS,
  },
  small: {
    props: { width: '20rem', height: 'auto', display: 'block' },
    controls: SIZE_CONTROLS,
  },
  medium: {
    props: { width: '30rem', height: 'auto', display: 'block' },
    controls: SIZE_CONTROLS,
  },
  large: {
    props: { width: '40rem', height: 'auto', display: 'block' },
    controls: SIZE_CONTROLS,
  },
  'fit-width': {
    props: { width: '100%', height: 'auto', display: 'block' },
    controls: SIZE_CONTROLS,
  },
  'fit-height': {
    props: { height: '100%', width: 'auto', display: 'block' },
    controls: SIZE_CONTROLS,
  },
};

function parseInlineCssDeclarations(css: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const segment of css.split(';')) {
    const colon = segment.indexOf(':');
    if (colon < 0) continue;
    const prop = segment.slice(0, colon).trim().toLowerCase();
    const value = segment.slice(colon + 1).trim();
    if (prop.length === 0 || value.length === 0) continue;
    entries.push([prop, value]);
  }
  return entries;
}

function serializeInlineCssDeclarations(entries: Array<[string, string]>): string {
  return entries.map(([prop, value]) => `${prop}: ${value};`).join(' ');
}

export function mergeImagePresetCss(existingCss: string, preset: string): string | null {
  const definition = IMAGE_PRESETS[preset];
  if (!definition) return null;
  const cleared = new Set(definition.controls.map((prop) => prop.toLowerCase()));
  const preserved = parseInlineCssDeclarations(existingCss).filter(([prop]) => !cleared.has(prop));
  const merged = [...preserved, ...Object.entries(definition.props)];
  return serializeInlineCssDeclarations(merged);
}

export function getMatchingImagePresetCss(existingCss: string, presets: readonly string[]): string | null {
  const declarations = new Map(parseInlineCssDeclarations(existingCss));
  for (const preset of presets) {
    const definition = IMAGE_PRESETS[preset];
    if (!definition) continue;
    const matches = Object.entries(definition.props).every(([prop, value]) => declarations.get(prop) === value);
    if (matches) {
      return preset;
    }
  }
  return null;
}
