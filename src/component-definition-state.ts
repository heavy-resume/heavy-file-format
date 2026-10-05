import { state } from './state';
import type { ComponentDefinition, SectionDefinition } from './types';
import {
  getComponentDefsFromMeta,
  getSectionDefsFromMeta,
  resolveBaseComponentFromMeta,
} from './component-definition-helpers';

export function getComponentDefs(): ComponentDefinition[] {
  return getComponentDefsFromMeta(getDocumentMetaOrNull());
}

export function getSectionDefs(): SectionDefinition[] {
  return getSectionDefsFromMeta(getDocumentMetaOrNull());
}

export function resolveBaseComponent(componentName: string): string {
  return resolveBaseComponentFromMeta(componentName, getDocumentMetaOrNull());
}

function getDocumentMetaOrNull(): Record<string, unknown> | null {
  try {
    return state?.document?.meta as Record<string, unknown> | null;
  } catch {
    return null;
  }
}
