import type { JsonObject } from '../hvy/types';

export function isReservedHvyPluginName(name: string): boolean {
  return /^hvy\.[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(name);
}

export function normalizeHvyPluginDeclarations(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const declaration = { ...(candidate as JsonObject) };
    const declaredId = typeof declaration.id === 'string' ? declaration.id.trim() : '';
    delete declaration.source;
    if (isReservedHvyPluginName(declaredId)) {
      delete declaration.uuid;
      delete declaration.version;
      delete declaration.versionRange;
    }
    return [declaration];
  });
}
