const PALETTE_OVERRIDE_STORAGE_KEY = 'hvy-palette-override-v1';

export function loadPaletteOverrideId(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const value = window.localStorage.getItem(PALETTE_OVERRIDE_STORAGE_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export function savePaletteOverrideId(id: string | null): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    if (id && id.trim()) {
      window.localStorage.setItem(PALETTE_OVERRIDE_STORAGE_KEY, id);
    } else {
      window.localStorage.removeItem(PALETTE_OVERRIDE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures; the palette still applies for this session.
  }
}
