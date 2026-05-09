import type { VisualBlock, VisualSection } from '../editor/types';
import type { VisualDocument } from '../types';

export type HvyDescriptionTargetKind = 'section' | 'block' | 'expandable-stub' | 'expandable-content';

export interface HvyDescriptionRequest {
  document: VisualDocument;
  section: VisualSection;
  block?: VisualBlock;
  kind: HvyDescriptionTargetKind;
  parentTrail: string[];
  contentSummary: string;
  signal?: AbortSignal;
}

export interface HvyDescriptionResponse {
  description: string;
}

export type HvyDescriptionProvider = (request: HvyDescriptionRequest) => Promise<HvyDescriptionResponse> | HvyDescriptionResponse;
