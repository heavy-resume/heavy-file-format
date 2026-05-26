import type { VisualDocument } from '../types';
import { extractReusableTemplateVariables, validateReusableTemplateValues } from '../reusable-template-values';
import type { HvyPdfExportPromptTemplate, HvyPdfExportPromptTemplateVariable } from './types';

const TEMPLATE_TOKEN_PATTERN = /{%\s*([A-Za-z_][A-Za-z0-9_-]*)\s*(?:\|\s*(text|block)\s*)?%}/g;

export function getPdfExportPromptTemplates(document: VisualDocument): HvyPdfExportPromptTemplate[] {
  const raw = document.meta.export_prompt_templates;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry, index): HvyPdfExportPromptTemplate[] => {
    const template = normalizePromptTemplate(entry, index);
    return template ? [template] : [];
  });
}

export function renderPdfExportPromptTemplate(
  document: VisualDocument,
  templateId: string,
  values: Record<string, string>
): string {
  const template = getPdfExportPromptTemplates(document).find((entry) => entry.id === templateId);
  if (!template) {
    throw new Error(`PDF export prompt template not found: ${templateId}`);
  }
  const variables = extractReusableTemplateVariables(template.prompt, template.variables);
  validateReusableTemplateValues(variables, values);
  const missingRequired = variables
    .filter((variable) => template.variables[variable.name]?.required !== false)
    .filter((variable) => (values[variable.name] ?? '').trim().length === 0)
    .map((variable) => variable.name);
  if (missingRequired.length > 0) {
    throw new Error(`PDF export prompt template values required: ${missingRequired.join(', ')}`);
  }
  return template.prompt.replace(TEMPLATE_TOKEN_PATTERN, (_token, name: string) => values[name] ?? '').trim();
}

function normalizePromptTemplate(raw: unknown, index: number): HvyPdfExportPromptTemplate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const id = stringField(source.id) || `export-template-${index + 1}`;
  const prompt = stringField(source.prompt);
  if (!id || !prompt) {
    return null;
  }
  const label = stringField(source.label) || id;
  const variables = normalizePromptTemplateVariables(source.variables);
  const discoveredVariables = extractReusableTemplateVariables(prompt, variables);
  for (const variable of discoveredVariables) {
    variables[variable.name] = {
      type: variable.type,
      label: variable.label,
      required: variables[variable.name]?.required ?? true,
      ...(variables[variable.name]?.placeholder ? { placeholder: variables[variable.name]?.placeholder } : {}),
      ...(variables[variable.name]?.helpText ? { helpText: variables[variable.name]?.helpText } : {}),
    };
  }
  return {
    id,
    label,
    ...(stringField(source.description) ? { description: stringField(source.description) } : {}),
    prompt,
    variables,
  };
}

function normalizePromptTemplateVariables(raw: unknown): Record<string, HvyPdfExportPromptTemplateVariable> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const variables: Record<string, HvyPdfExportPromptTemplateVariable> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) || !value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    const source = value as Record<string, unknown>;
    const next: HvyPdfExportPromptTemplateVariable = {
      required: source.required === false ? false : true,
    };
    if (source.type === 'text' || source.type === 'block') next.type = source.type;
    const label = stringField(source.label);
    if (label) next.label = label;
    const placeholder = stringField(source.placeholder);
    if (placeholder) next.placeholder = placeholder;
    const helpText = stringField(source.helpText);
    if (helpText) next.helpText = helpText;
    variables[name] = next;
  }
  return variables;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
