import { getActiveStateRuntime, type StateRuntime } from '../../state';
import type { VisualBlock, VisualSection } from '../../editor/types';
import type { VisualDocument } from '../../types';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export type HvyPowerScriptingMode = 'prompt' | 'enabled' | 'hidden';

const modes = new WeakMap<StateRuntime, HvyPowerScriptingMode>();
interface HvyPowerScriptAcceptanceCallbacks {
  getAcceptance: HvyGetPowerScriptAcceptance | null;
  onAcceptanceChanged: HvyPowerScriptAcceptanceChanged | null;
}

const acceptanceCallbacks = new WeakMap<StateRuntime, HvyPowerScriptAcceptanceCallbacks>();

export interface HvyPowerScriptAcceptanceRequest {
  document: VisualDocument;
  fingerprint: string;
}

export type HvyGetPowerScriptAcceptance = (request: HvyPowerScriptAcceptanceRequest) => boolean;
export type HvyPowerScriptAcceptanceChanged = (
  request: HvyPowerScriptAcceptanceRequest & { accepted: boolean }
) => void;

interface PowerScriptFingerprintEntry {
  id: string;
  source: string;
}

function collectPowerScriptSource(blocks: VisualBlock[], output: PowerScriptFingerprintEntry[]): void {
  for (const block of blocks) {
    if (block.schema.component === 'plugin' && block.schema.plugin === 'hvy.power-scripting') {
      output.push({ id: block.schema.id, source: block.text });
    }
    collectPowerScriptSource(block.schema.containerBlocks ?? [], output);
    collectPowerScriptSource(block.schema.componentListBlocks ?? [], output);
    collectPowerScriptSource((block.schema.gridItems ?? []).map((item) => item.block), output);
    collectPowerScriptSource(block.schema.expandableStubBlocks?.children ?? [], output);
    collectPowerScriptSource(block.schema.expandableContentBlocks?.children ?? [], output);
  }
}

function collectSectionPowerScriptSource(section: VisualSection, output: PowerScriptFingerprintEntry[]): void {
  collectPowerScriptSource(section.blocks, output);
  section.children.forEach((child) => collectSectionPowerScriptSource(child, output));
}

export function getPowerScriptFingerprint(document: VisualDocument): string {
  const sources: PowerScriptFingerprintEntry[] = [];
  document.sections.forEach((section) => collectSectionPowerScriptSource(section, sources));
  return `power-sha256-${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(sources))))}`;
}

export function setPowerScriptingMode(mode: HvyPowerScriptingMode, runtime: StateRuntime = getActiveStateRuntime()): void {
  modes.set(runtime, mode);
}

export function getPowerScriptingMode(runtime: StateRuntime = getActiveStateRuntime()): HvyPowerScriptingMode {
  return modes.get(runtime) ?? 'prompt';
}

export function setPowerScriptAcceptanceCallbacks(
  callbacks: HvyPowerScriptAcceptanceCallbacks,
  runtime: StateRuntime = getActiveStateRuntime()
): void {
  if (callbacks.getAcceptance || callbacks.onAcceptanceChanged) acceptanceCallbacks.set(runtime, callbacks);
  else acceptanceCallbacks.delete(runtime);
}

export function getPowerScriptingModeForDocument(
  document: VisualDocument,
  runtime: StateRuntime = getActiveStateRuntime()
): HvyPowerScriptingMode {
  const configuredMode = getPowerScriptingMode(runtime);
  if (configuredMode !== 'prompt') return configuredMode;
  const callbacks = acceptanceCallbacks.get(runtime);
  if (!callbacks?.getAcceptance) return 'prompt';
  const request = { document, fingerprint: getPowerScriptFingerprint(document) };
  return callbacks.getAcceptance(request) ? 'enabled' : 'prompt';
}

export function setPowerScriptAccepted(
  document: VisualDocument,
  accepted: boolean,
  runtime: StateRuntime = getActiveStateRuntime()
): void {
  acceptanceCallbacks.get(runtime)?.onAcceptanceChanged?.({
    document,
    fingerprint: getPowerScriptFingerprint(document),
    accepted,
  });
}

export function clearPowerScriptingMode(runtime: StateRuntime): void {
  modes.delete(runtime);
  acceptanceCallbacks.delete(runtime);
}
