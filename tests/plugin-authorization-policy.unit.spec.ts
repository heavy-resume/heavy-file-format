import { describe, expect, test, vi } from 'vitest';
import { deserializeDocument } from '../src/serialization';
import { createStateRuntime } from '../src/state';
import {
  getPluginAuthorizationMode,
  setPluginAuthorizationCallbacks,
  setPluginAuthorized,
} from '../src/plugins/authorization/plugin-authorization-policy';
import { createConditionallyAllowedPlugin } from '../src/plugins/authorization/conditional-plugin';
import { createTestState } from './serialization-test-helpers';

function document() {
  return deserializeDocument('---\nhvy_version: 1.0\n---\n', '.hvy');
}

describe('conditional plugin authorization', () => {
  test('before, acceptance, after: keeps approval scoped to a file and exact plugin version', () => {
    const firstDocument = document();
    const secondDocument = document();
    const runtime = createStateRuntime(createTestState(firstDocument));
    const plugin = createConditionallyAllowedPlugin({
      id: 'com.example.timeline',
      uuid: 'timeline-primary',
      version: '1.2.0',
      hvyApiVersion: '0.1',
      displayName: 'Timeline',
      load: vi.fn(),
    });

    expect(getPluginAuthorizationMode(firstDocument, plugin, runtime)).toBe('prompt');
    setPluginAuthorized(firstDocument, plugin, true, runtime);

    expect(getPluginAuthorizationMode(firstDocument, plugin, runtime)).toBe('enabled');
    expect(getPluginAuthorizationMode(secondDocument, plugin, runtime)).toBe('prompt');
    expect(getPluginAuthorizationMode(firstDocument, { ...plugin, version: '1.3.0' }, runtime)).toBe('prompt');
    expect(plugin.load).not.toHaveBeenCalled();
  });

  test('uses host persistence callbacks without loading plugin code', () => {
    const currentDocument = document();
    const runtime = createStateRuntime(createTestState(currentDocument));
    const changed = vi.fn();
    const plugin = createConditionallyAllowedPlugin({
      id: 'com.example.timeline',
      version: '1.2.0',
      hvyApiVersion: '0.1',
      displayName: 'Timeline',
      load: vi.fn(),
    });
    setPluginAuthorizationCallbacks({
      getAcceptance: ({ id }) => id === plugin.id,
      onAcceptanceChanged: changed,
    }, runtime);

    expect(getPluginAuthorizationMode(currentDocument, plugin, runtime)).toBe('enabled');
    setPluginAuthorized(currentDocument, plugin, false, runtime);
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({
      document: currentDocument,
      id: plugin.id,
      version: plugin.version,
      accepted: false,
    }));
    expect(plugin.load).not.toHaveBeenCalled();
  });
});
