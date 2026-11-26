import type {
  HvyPlugin,
  HvyPluginContext,
  HvyPluginFactory,
  HvyPluginInstance,
} from './types';
import { createBuiltInPluginMetadata, FORM_PLUGIN_ID } from './registry';
import { FORM_PLUGIN_VERSION, parseFormSpec } from './form-spec/form-spec';
import { getFormLifecycle } from './form-live-state/form-lifecycle';
import { mountFormEditor } from './form-editor/form-editor';
import { mountFormReader } from './form-reader/form-reader';
import formDocumentation from './form.about.txt?raw';

import './form.css';

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-form-plugin hvy-form-plugin-${ctx.mode}`;
  const initialSpec = parseFormSpec(ctx.block.text, ctx.block.schema.pluginConfig).spec;
  const lifecycle = getFormLifecycle(ctx.rawDocument, ctx.block, () => initialSpec);
  const mounted = ctx.mode === 'editor'
    ? mountFormEditor(ctx, root, lifecycle.live)
    : mountFormReader(ctx, root, lifecycle);
  mounted.refresh();

  return {
    element: root,
    refresh: mounted.refresh,
    unmount: mounted.unmount,
  };
}

export const formPluginFactory: HvyPluginFactory = build;

export const formPlugin: HvyPlugin = {
  ...createBuiltInPluginMetadata(FORM_PLUGIN_ID),
  displayName: 'Form',
  mount: { strategy: 'immediate' },
  documentation: {
    filename: 'about-form.txt',
    text: formDocumentation,
  },
  aiHint: 'Form UI. Fields live in plugin.txt; named scripts are also exposed as sibling .py files. Form-level hooks and AI submit settings live in plugin.json pluginConfig.',
  aiHelp: [
    `Use \`<!--hvy:plugin {"plugin":"${FORM_PLUGIN_ID}","pluginConfig":{"version":"${FORM_PLUGIN_VERSION}","submitLabel":"Submit","submitScript":"submit"}}-->\` followed by form YAML in the component body.`,
    'Do not use `<!--hvy:form ...-->`.',
    'Supported form YAML keys include `fields` and `scripts`.',
    'Form-level behavior and styling keys live in pluginConfig: `formCss`, `actionsCss`, `submitCss`, `submitLabel`, `showSubmit`, `submitDisabled`, `submitDisabledReason`, `initialScript`, `changeScript`, `submitAction`, `submitSourceScript`, `submitScript`, `submitPrompt`, `submitInputCharLimit`, `submitOutputCharLimit`, `scriptLibraries`, and `scriptStepBudget`.',
    'Fields use `label`, `type`, optional `placeholder`, optional `required`, optional `disabled`, optional `options`, optional `value`, and optional `triggers`. The label is both visible text and the script key. Type `photo` stores an HVY image attachment before submit and exposes an object with `attachmentId`, `imageFile`, and `mediaType` through `doc.form`.',
    'Type `range` renders a slider with its label and current value. It uses optional numeric `min`, `max`, and `step` keys (defaults 0, 100, and 1) and optional numeric `value` (defaults to the midpoint). `doc.form` reads its value as a decimal string, so convert it before doing arithmetic, and values set by scripts are clamped and snapped to the slider.',
    'Photo field `meta` supports `accept`, `maxBytes`, `maxWidth`, and `maxHeight`; dimension limits preserve aspect ratio and fall back to document or host image limits when omitted.',
    '`formCss`, `actionsCss`, `submitCss`, and field `meta.css` are sanitized inline CSS applied to the form, action wrapper, submit button, and field wrapper respectively.',
    '`scripts` maps script names to Python/Brython source wrapped in a generated function. `pluginConfig.submitScript`, `pluginConfig.submitSourceScript`, `pluginConfig.initialScript`, `pluginConfig.changeScript`, and field triggers name a script key.',
    'Use `submitAction: "ai-generate"` for model-backed form submit. The host calls the chat model, `submitSourceScript` returns the input, and `submitScript` receives injected `response` and `source` values to apply the generated output; use `doc.json` for structured JSON responses.',
    '`scriptLibraries` enables checked sandbox libraries such as `random`, `re`, `datetime`, `zoneinfo`, and `tzlocal` for every form script.',
    'The checked `random` subset provides `random`, `shuffle`, `choice`, `randrange`, `randint`, `uniform`, `sample`, and `choices`.',
    '`scriptStepBudget` controls the maximum runtime steps for each script run.',
    'Form scripts receive `doc` plus `doc.form` for live form values, options, and errors.',
    'Use `doc.form.get_value`, `doc.form.get_values`, `doc.form.set_value`, `doc.form.set_options`, `doc.form.set_error`, `doc.form.clear_error`, and `doc.form.set_field_disabled` for form state.',
    'Use `doc.db.get_updated_tables(table_name="name")` in `changeScript` to skip queries when unrelated database tables changed.',
    'Script blocks must be indented under `scripts.NAME: |`; use Python comments (`# ...`) and Python booleans (`True`/`False`), not SQL `--` comments or JavaScript-style booleans.',
  ].join(' '),
  create: formPluginFactory,
};

/** @deprecated Use formPlugin. */
export const formPluginRegistration = formPlugin;
