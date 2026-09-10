import { describe, expect, it } from 'vitest';
import { deserializeDocumentBytes } from '../src/serialization';
import { getPowerScriptFingerprint } from '../src/plugins/power-scripting/power-scripting-policy';

function powerDocument(scripts: Array<{ id: string; source: string }>) {
  const blocks = scripts.map(({ id, source }) => `
<!--hvy:plugin {"id":"${id}","plugin":"hvy.power-scripting"}-->
${source}
`).join('\n');
  return deserializeDocumentBytes(new TextEncoder().encode(`---
hvy_version: 0.1
---

<!--hvy: {"id":"trust-test"}-->
#! Trust test
${blocks}`), '.hvy');
}

describe('power script acceptance fingerprints', () => {
  it('uses SHA-256 and changes for script additions, identity, order, and source', () => {
    const original = getPowerScriptFingerprint(powerDocument([
      { id: 'alpha', source: 'window.alpha = true;' },
      { id: 'beta', source: 'window.beta = true;' },
    ]));

    expect(original).toMatch(/^power-sha256-[0-9a-f]{64}$/);
    expect(getPowerScriptFingerprint(powerDocument([
      { id: 'alpha', source: 'window.alpha = true;' },
      { id: 'beta', source: 'window.beta = true;' },
      { id: 'injected', source: 'window.injected = true;' },
    ]))).not.toBe(original);
    expect(getPowerScriptFingerprint(powerDocument([
      { id: 'renamed', source: 'window.alpha = true;' },
      { id: 'beta', source: 'window.beta = true;' },
    ]))).not.toBe(original);
    expect(getPowerScriptFingerprint(powerDocument([
      { id: 'beta', source: 'window.beta = true;' },
      { id: 'alpha', source: 'window.alpha = true;' },
    ]))).not.toBe(original);
    expect(getPowerScriptFingerprint(powerDocument([
      { id: 'alpha', source: 'window.alpha = false;' },
      { id: 'beta', source: 'window.beta = true;' },
    ]))).not.toBe(original);
  });
});
