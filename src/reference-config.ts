import type { HvySearchProvider } from './search/types';
import type { HvySemanticFilterProvider } from './search/types';
import type { HvyDescriptionProvider } from './descriptions/types';
import { getActiveStateRuntime, type StateRuntime } from './state';
import { DEFAULT_SEMANTIC_FILTER_CONCURRENCY, normalizeSemanticFilterConcurrency } from './search/semantic-filter-concurrency';

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
  semanticFilterProvider?: HvySemanticFilterProvider | null;
  semanticFilterConcurrency: number;
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
  semanticFilterConcurrency: DEFAULT_SEMANTIC_FILTER_CONCURRENCY,
};

let runtimeOverride: Partial<ReferenceAppConfig> | null = null;
const semanticFilterProviderByRuntime = new WeakMap<StateRuntime, HvySemanticFilterProvider | null>();
const semanticFilterConcurrencyByRuntime = new WeakMap<StateRuntime, number>();

export function setReferenceAppConfig(config: Partial<ReferenceAppConfig> | null): void {
  runtimeOverride = config;
}

export function setRuntimeSemanticFilterProvider(provider: HvySemanticFilterProvider | null): void {
  try {
    semanticFilterProviderByRuntime.set(getActiveStateRuntime(), provider);
  } catch {
    // Runtime-scoped providers are only available after state initialization.
  }
}

export function setRuntimeSemanticFilterConcurrency(concurrency: number | null): void {
  try {
    const runtime = getActiveStateRuntime();
    if (concurrency === null) {
      semanticFilterConcurrencyByRuntime.delete(runtime);
    } else {
      semanticFilterConcurrencyByRuntime.set(runtime, normalizeSemanticFilterConcurrency(concurrency));
    }
  } catch {
    // Runtime-scoped configuration is only available after state initialization.
  }
}

function getRuntimeSemanticFilterProvider(): HvySemanticFilterProvider | null | undefined {
  try {
    return semanticFilterProviderByRuntime.get(getActiveStateRuntime());
  } catch {
    return undefined;
  }
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
    semanticFilterProvider:
      getRuntimeSemanticFilterProvider() ??
      runtimeOverride?.semanticFilterProvider ??
      globalConfig?.semanticFilterProvider ??
      defaultConfig.semanticFilterProvider ??
      null,
    semanticFilterConcurrency: normalizeSemanticFilterConcurrency(
      getRuntimeSemanticFilterConcurrency() ??
      runtimeOverride?.semanticFilterConcurrency ??
      globalConfig?.semanticFilterConcurrency ??
      defaultConfig.semanticFilterConcurrency,
    ),
    descriptionProvider:
      runtimeOverride?.descriptionProvider ??
      globalConfig?.descriptionProvider ??
      defaultConfig.descriptionProvider ??
      null,
  };
}

function getRuntimeSemanticFilterConcurrency(): number | undefined {
  try {
    return semanticFilterConcurrencyByRuntime.get(getActiveStateRuntime());
  } catch {
    return undefined;
  }
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
