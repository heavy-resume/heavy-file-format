import { getComponentDefsFromMeta } from '../component-defs';
import { cloneReusableBlockFromMeta, parseVisualBlock } from '../document-factory';
import {
  applyReusableTemplateValues,
  extractReusableTemplateVariablesFromDefinition,
  extractReusableTemplateVariablesFromFlavor,
  validateReusableTemplateValues,
  type ReusableTemplateVariable,
} from '../reusable-template-values';
import { getOutputGenerator } from './registry';
import type { ComponentDefinition, ComponentTemplateFlavor, VisualDocument } from '../types';
import type { VisualBlock, VisualSection } from '../editor/types';
import type { ComponentRenderHelpers } from '../editor/component-helpers';
import type {
  HvyPluginComponentTemplateInfo,
  HvyPluginComponentTemplateRenderInstance,
  HvyPluginComponentTemplateRenderOptions,
  HvyPluginComponentTemplateSelection,
  HvyPluginComponentTemplateValuesInstance,
  HvyPluginComponentTemplateValuesOptions,
  HvyPluginComponentTemplatesApi,
} from './types';
import type { HvyOutputGeneratorResponse } from './types';

interface ComponentTemplateApiDependencies {
  document: VisualDocument;
  section: VisualSection;
  sectionKey: string;
  helpers: ComponentRenderHelpers;
  observeLinks(root: ParentNode): void;
  resolveGenerator(response: HvyOutputGeneratorResponse): Promise<string>;
}

export function createPluginComponentTemplatesApi(deps: ComponentTemplateApiDependencies): HvyPluginComponentTemplatesApi {
  return {
    list: () => listComponentTemplates(deps.document),
    variables: (selection) => getSelection(deps.document, selection).variables,
    materialize: (options) => materializeComponentTemplate(deps.document, options),
    render: (options) => mountRenderedTemplate(deps, options),
    mountValues: (options) => mountTemplateValues(deps, options),
  };
}

export function listComponentTemplates(document: VisualDocument): HvyPluginComponentTemplateInfo[] {
  return getComponentDefsFromMeta(document.meta).map((definition) => ({
    name: definition.name,
    baseType: definition.baseType,
    ...(definition.description?.trim() ? { description: definition.description } : {}),
    ...(definition.tags?.trim() ? { tags: definition.tags } : {}),
    flavors: (definition.flavors ?? []).map((flavor) => ({
      name: flavor.name,
      ...(flavor.description?.trim() ? { description: flavor.description } : {}),
    })),
  }));
}

export function materializeComponentTemplate(
  document: VisualDocument,
  options: HvyPluginComponentTemplateRenderOptions
): VisualBlock {
  const selected = getSelection(document, options);
  validateReusableTemplateValues(selected.variables, options.values);
  return applyReusableTemplateValues(cloneTemplate(document, selected.definition, selected.flavor), options.values, selected.variables);
}

function getSelection(document: VisualDocument, selection: HvyPluginComponentTemplateSelection): {
  definition: ComponentDefinition;
  flavor: ComponentTemplateFlavor | null;
  variables: ReusableTemplateVariable[];
} {
  const definition = getComponentDefsFromMeta(document.meta).find((candidate) => candidate.name === selection.template);
  if (!definition) {
    throw new Error(`Component template "${selection.template}" was not found.`);
  }
  const flavorName = selection.flavor?.trim() ?? '';
  const flavor = flavorName
    ? definition.flavors?.find((candidate) => candidate.name === flavorName) ?? null
    : null;
  if (flavorName && !flavor) {
    throw new Error(`Component template flavor "${flavorName}" was not found on "${definition.name}".`);
  }
  return {
    definition,
    flavor,
    variables: flavor
      ? extractReusableTemplateVariablesFromFlavor(flavor, definition.templateVariables)
      : extractReusableTemplateVariablesFromDefinition(definition),
  };
}

function cloneTemplate(document: VisualDocument, definition: ComponentDefinition, flavor: ComponentTemplateFlavor | null): VisualBlock {
  const template = flavor?.template ?? definition.template;
  if (template) {
    const block = cloneReusableBlockFromMeta(template, document.meta);
    block.schema.component = definition.name;
    return block;
  }
  const schema = flavor?.schema ?? definition.schema;
  return parseVisualBlock({
    text: '',
    schema: { ...(schema ?? {}), component: definition.name },
  }, new WeakSet<object>(), document.meta);
}

function mountRenderedTemplate(
  deps: ComponentTemplateApiDependencies,
  initial: HvyPluginComponentTemplateRenderOptions
): HvyPluginComponentTemplateRenderInstance {
  const element = document.createElement('div');
  element.className = 'hvy-plugin-template-render hvy-link-observer-surface';
  let options = { ...initial, values: { ...initial.values } };
  let block = materializeComponentTemplate(deps.document, options);

  const refresh = (): void => {
    block = materializeComponentTemplate(deps.document, options);
    element.innerHTML = deps.helpers.renderReaderBlock(deps.section, block, {
      suppressAiEditorDelegation: true,
      ignoreReaderSessionState: true,
    });
    deps.observeLinks(element);
  };
  refresh();

  return {
    element,
    getBlock: () => block,
    update(next) {
      options = { ...next, values: { ...next.values } };
      refresh();
    },
    refresh,
    unmount() {
      element.replaceChildren();
      element.remove();
    },
  };
}

function mountTemplateValues(
  deps: ComponentTemplateApiDependencies,
  initial: HvyPluginComponentTemplateValuesOptions
): HvyPluginComponentTemplateValuesInstance {
  const element = document.createElement('div');
  element.className = 'hvy-plugin-template-values modal-field-stack';
  let selection: HvyPluginComponentTemplateSelection = { template: initial.template, flavor: initial.flavor };
  let values = { ...(initial.values ?? {}) };
  let disposed = false;

  const currentVariables = (): ReusableTemplateVariable[] => getSelection(deps.document, selection).variables;
  const normalizedValues = (): Record<string, string> => Object.fromEntries(
    currentVariables().map((variable) => [variable.name, values[variable.name] ?? ''])
  );
  const emit = (): void => {
    values = normalizedValues();
    initial.onChange({ ...values });
  };
  const refreshGeneratorButtons = (): void => {
    element.querySelectorAll<HTMLButtonElement>('[data-required-template-variables]').forEach((button) => {
      const required = (button.dataset.requiredTemplateVariables ?? '').split(',').filter(Boolean);
      button.disabled = required.some((name) => !(values[name] ?? '').trim()) || button.dataset.busy === 'true';
    });
  };
  const render = (): void => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.templateVariable : undefined;
    element.replaceChildren(...currentVariables().map((variable) => createValueField(variable)));
    refreshGeneratorButtons();
    if (active) {
      element.querySelector<HTMLElement>(`[data-template-variable="${cssEscape(active)}"]`)?.focus({ preventScroll: true });
    }
  };
  const createValueField = (variable: ReusableTemplateVariable): HTMLElement => {
    const label = document.createElement('label');
    label.className = 'hvy-plugin-template-value';
    const heading = document.createElement('span');
    heading.className = 'template-field-label-row';
    const text = document.createElement('span');
    text.textContent = variable.label;
    heading.append(text);
    const input = variable.type === 'block' ? document.createElement('textarea') : document.createElement('input');
    if (input instanceof HTMLTextAreaElement) input.rows = 5;
    input.dataset.templateVariable = variable.name;
    input.value = values[variable.name] ?? '';
    input.addEventListener('input', () => {
      values[variable.name] = input.value;
      emit();
      refreshGeneratorButtons();
    });
    const generator = variable.generator ? getOutputGenerator(variable.generator) : null;
    if (generator) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost template-generator-button';
      button.textContent = variable.generatorLabel || generator.label || 'Generate';
      button.dataset.requiredTemplateVariables = (generator.requiredVariables ?? []).join(',');
      const status = document.createElement('span');
      status.className = 'muted template-generator-status';
      status.setAttribute('role', 'status');
      button.addEventListener('click', async () => {
        button.dataset.busy = 'true';
        button.disabled = true;
        status.textContent = '';
        try {
          const allValues = normalizedValues();
          const response = await generator.generate({
            document: deps.document,
            component: selection.template,
            variable: variable.name,
            variableType: variable.type,
            label: variable.label,
            values: Object.fromEntries(Object.entries(allValues).filter(([, value]) => value.trim().length > 0)),
            target: { kind: 'section', sectionKey: deps.sectionKey },
          });
          const output = await deps.resolveGenerator(response);
          if (!disposed) {
            values[variable.name] = output;
            input.value = output;
            emit();
          }
        } catch (error) {
          if (!disposed) status.textContent = error instanceof Error ? error.message : 'Generation failed.';
        } finally {
          if (!disposed) {
            button.dataset.busy = 'false';
            refreshGeneratorButtons();
          }
        }
      });
      heading.append(button, status);
    }
    label.append(heading, input);
    return label;
  };

  values = normalizedValues();
  render();
  return {
    element,
    getValues: () => ({ ...normalizedValues() }),
    setValues(next) {
      values = { ...next };
      for (const input of element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-template-variable]')) {
        const nextValue = values[input.dataset.templateVariable ?? ''] ?? '';
        if (input.value !== nextValue) input.value = nextValue;
      }
    },
    setSelection(next) {
      selection = { ...next };
      values = normalizedValues();
      render();
    },
    focus(variable) {
      const target = variable
        ? element.querySelector<HTMLElement>(`[data-template-variable="${cssEscape(variable)}"]`)
        : element.querySelector<HTMLElement>('[data-template-variable]');
      target?.focus();
    },
    unmount() {
      disposed = true;
      element.replaceChildren();
      element.remove();
    },
  };
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/[^A-Za-z0-9_-]/g, (character) => `\\${character}`);
}
