export interface ReferenceAppFeatures {
  tables: boolean;
}

export interface ReferenceAppConfig {
  features: ReferenceAppFeatures;
}

declare global {
  interface Window {
    HVY_REFERENCE_CONFIG?: Partial<ReferenceAppConfig>;
  }
}

const defaultConfig: ReferenceAppConfig = {
  features: {
    tables: true,
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
    },
  };
}

export function areTablesEnabled(): boolean {
  return getReferenceAppConfig().features.tables !== false;
}
