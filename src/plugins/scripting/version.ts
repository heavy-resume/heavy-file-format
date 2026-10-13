import type { JsonObject } from '../../hvy/types';

export const SCRIPTING_PLUGIN_VERSION = '0.2';

export function getScriptingPluginVersion(pluginConfig: JsonObject | null | undefined): string {
  const rawVersion = pluginConfig && typeof pluginConfig.version === 'string' ? pluginConfig.version.trim() : '';
  return rawVersion.length > 0 ? rawVersion : SCRIPTING_PLUGIN_VERSION;
}

export function getScriptingPluginMaxLines(pluginConfig: JsonObject | null | undefined): number | undefined {
  const rawMaxSteps = pluginConfig?.maxSteps ?? pluginConfig?.maxLines;
  if (typeof rawMaxSteps !== 'number' || !Number.isFinite(rawMaxSteps) || rawMaxSteps <= 0) {
    return undefined;
  }
  return Math.floor(rawMaxSteps);
}

export const getScriptingPluginMaxSteps = getScriptingPluginMaxLines;

export function comparePluginVersions(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10));
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10));
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightValue = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }
  return 0;
}

export function buildScriptingVersionMismatchMessage(requestedVersion: string): string {
  return `This HVY scripting block requires plugin version ${requestedVersion}, but this client supports ${SCRIPTING_PLUGIN_VERSION}.`;
}
