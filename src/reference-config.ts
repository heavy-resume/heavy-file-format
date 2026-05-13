import type { HvySearchProvider } from './search/types';
import type { HvyDescriptionProvider } from './descriptions/types';

export interface ReferenceAppFeatures {
  tables: boolean;
  allowExternalCss: boolean;
}

export interface ReferenceAppAiEditorConfig {
  doubleClickDelayMs: number;
}

export interface ReferenceAppConfig {
  features: ReferenceAppFeatures;
  aiEditor: ReferenceAppAiEditorConfig;
  searchProvider?: HvySearchProvider | null;
  descriptionProvider?: HvyDescriptionProvider | null;
}

declare global {
  interface Window {
    HVY_REFERENCE_CONFIG?: Partial<ReferenceAppConfig>;
  }
}

const defaultConfig: ReferenceAppConfig = {
  features: {
    tables: true,
    allowExternalCss: false,
  },
  aiEditor: {
    doubleClickDelayMs: 250,
  },
};

let runtimeOverride: Partial<ReferenceAppConfig> | null = null;

export function setReferenceAppConfig(config: Partial<ReferenceAppConfig> | null): void {
  runtimeOverride = config;
}

export function getReferenceAppConfig(): ReferenceAppConfig {
  const globalConfig =
    typeof window !== 'undefined' && window.HVY_REFERENCE_CONFIG && typeof window.HVY_REFERENCE_CONFIG === 'object'
      ? window.HVY_REFERENCE_CONFIG
      : null;

  return {
    features: {
      tables:
        runtimeOverride?.features?.tables ??
        globalConfig?.features?.tables ??
        defaultConfig.features.tables,
      allowExternalCss:
        runtimeOverride?.features?.allowExternalCss ??
        globalConfig?.features?.allowExternalCss ??
        defaultConfig.features.allowExternalCss,
    },
    aiEditor: {
      doubleClickDelayMs: normalizeDelayMs(
        runtimeOverride?.aiEditor?.doubleClickDelayMs ??
          globalConfig?.aiEditor?.doubleClickDelayMs ??
          defaultConfig.aiEditor.doubleClickDelayMs,
        defaultConfig.aiEditor.doubleClickDelayMs,
      ),
    },
    searchProvider:
      runtimeOverride?.searchProvider ??
      globalConfig?.searchProvider ??
      defaultConfig.searchProvider ??
      null,
    descriptionProvider:
      runtimeOverride?.descriptionProvider ??
      globalConfig?.descriptionProvider ??
      defaultConfig.descriptionProvider ??
      null,
  };
}

function normalizeDelayMs(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
}

export function areTablesEnabled(): boolean {
  return getReferenceAppConfig().features.tables !== false;
}

export function isExternalCssAllowed(): boolean {
  return getReferenceAppConfig().features.allowExternalCss === true;
}

export function getAiEditorDoubleClickDelayMs(): number {
  return getReferenceAppConfig().aiEditor.doubleClickDelayMs;
}
