export function cssValueLooksLikeSerializedJson(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

export function assertCssValueIsDeclarationString(value: string, label: string): void {
  if (cssValueLooksLikeSerializedJson(value)) {
    throw new Error(`${label} must be an inline CSS declaration string, not serialized component or section JSON. Use a .json file for metadata and a .css file or css field value such as "margin: 0;" for styling.`);
  }
}
