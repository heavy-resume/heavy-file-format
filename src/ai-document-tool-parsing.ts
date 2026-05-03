import type {
  ComponentPatchEdit,
  CssPropertyMap,
  DocumentEditBatchToolRequest,
  DocumentEditToolRequest,
  EditPathSelection,
  HeaderEditToolRequest,
} from './ai-document-edit-types';

export function parseDocumentEditToolRequest(source: string): { ok: true; value: DocumentEditToolRequest } | { ok: false; message: string } {
  const cleaned = normalizeToolJsonSource(source);
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: 'Return a single JSON object.' };
    }
    const tool = parsed.tool;
    if (tool === 'batch') {
      if (!Array.isArray(parsed.calls) || parsed.calls.length === 0) {
        return { ok: false, message: 'batch.calls must be a non-empty array of tool JSON objects.' };
      }
      if (parsed.calls.length > 12) {
        return { ok: false, message: 'batch.calls supports at most 12 tool calls at a time.' };
      }
      const calls: DocumentEditBatchToolRequest[] = [];
      for (const [index, candidate] of parsed.calls.entries()) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
          return { ok: false, message: `batch.calls[${index}] must be a tool JSON object.` };
        }
        const parsedCall = parseDocumentEditToolRequest(JSON.stringify(candidate));
        if (parsedCall.ok === false) {
          return { ok: false, message: `batch.calls[${index}] is invalid: ${parsedCall.message}` };
        }
        if (isDocumentBatchControlTool(parsedCall.value.tool)) {
          return { ok: false, message: `batch.calls[${index}] cannot use control tool "${parsedCall.value.tool}".` };
        }
        calls.push(parsedCall.value as DocumentEditBatchToolRequest);
      }
      return {
        ok: true,
        value: {
          tool,
          calls,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'done') {
      return { ok: true, value: { tool, summary: typeof parsed.summary === 'string' ? parsed.summary : undefined } };
    }
    if (tool === 'answer' && typeof parsed.answer === 'string' && parsed.answer.trim().length > 0) {
      return { ok: true, value: { tool, answer: parsed.answer } };
    }
    if (tool === 'plan' && Array.isArray(parsed.steps) && parsed.steps.every((step) => typeof step === 'string' && step.trim().length > 0)) {
      return {
        ok: true,
        value: {
          tool,
          steps: parsed.steps.map((step) => step.trim()),
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'plan') {
      return {
        ok: false,
        message: 'plan must use `steps` as an array of short document-change strings, for example `{"tool":"plan","steps":["Modify component X","Verify the result"]}`.',
      };
    }
    if (tool === 'mark_step_done' && Number.isInteger(parsed.step)) {
      return {
        ok: true,
        value: {
          tool,
          step: Number(parsed.step),
          summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'request_structure') {
      return { ok: true, value: { tool, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined } };
    }
    if (tool === 'request_rendered_structure') {
      return { ok: true, value: { tool, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined } };
    }
    if (tool === 'get_help' && typeof parsed.topic === 'string' && parsed.topic.trim().length > 0) {
      return {
        ok: true,
        value: {
          tool,
          topic: parsed.topic.trim(),
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'search_components' && typeof parsed.query === 'string' && parsed.query.trim().length > 0) {
      return {
        ok: true,
        value: {
          tool,
          query: parsed.query.trim(),
          max_count: Number.isInteger(parsed.max_count) ? Number(parsed.max_count) : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'grep' && typeof parsed.query === 'string' && parsed.query.trim().length > 0) {
      const flags = typeof parsed.flags === 'string' ? parsed.flags : undefined;
      try {
        buildGrepRegex(parsed.query, flags);
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : 'grep query must be a valid regex pattern.',
        };
      }
      return {
        ok: true,
        value: {
          tool,
          query: parsed.query,
          flags,
          before: Number.isInteger(parsed.before) ? Number(parsed.before) : undefined,
          after: Number.isInteger(parsed.after) ? Number(parsed.after) : undefined,
          max_count: Number.isInteger(parsed.max_count) ? Number(parsed.max_count) : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    const parsedComponentRef = typeof parsed.component_ref === 'string'
      ? parsed.component_ref
      : typeof parsed.component_id === 'string'
        ? parsed.component_id
        : undefined;
    const parsedTargetComponentRef = typeof parsed.target_component_ref === 'string'
      ? parsed.target_component_ref
      : typeof parsed.target_component_id === 'string'
        ? parsed.target_component_id
        : undefined;
    if (tool === 'view_component' && typeof parsedComponentRef === 'string') {
      return {
        ok: true,
        value: {
          tool,
          component_ref: parsedComponentRef,
          start_line: Number.isInteger(parsed.start_line) ? Number(parsed.start_line) : undefined,
          end_line: Number.isInteger(parsed.end_line) ? Number(parsed.end_line) : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'view_rendered_component' && typeof parsedComponentRef === 'string') {
      return {
        ok: true,
        value: {
          tool,
          component_ref: parsedComponentRef,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if ((tool === 'get_css' || tool === 'get_properties') && Array.isArray(parsed.ids) && parsed.ids.every((id) => typeof id === 'string')) {
      const regex = typeof parsed.regex === 'string' ? parsed.regex : undefined;
      const flags = typeof parsed.flags === 'string' ? parsed.flags : undefined;
      if (regex) {
        try {
          buildToolRegex(regex, flags, `${tool}.regex`);
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : `${tool}.regex must be valid.` };
        }
      }
      return {
        ok: true,
        value:
          tool === 'get_css'
            ? {
                tool,
                ids: parsed.ids,
                regex,
                flags,
                reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
              }
            : {
                tool,
                ids: parsed.ids,
                properties: Array.isArray(parsed.properties) && parsed.properties.every((property) => typeof property === 'string') ? parsed.properties : undefined,
                regex,
                flags,
                reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
              },
      };
    }
    if (tool === 'set_properties' && Array.isArray(parsed.ids) && parsed.ids.every((id) => typeof id === 'string') && parsed.properties && typeof parsed.properties === 'object' && !Array.isArray(parsed.properties)) {
      const properties: CssPropertyMap = {};
      for (const [property, value] of Object.entries(parsed.properties as Record<string, unknown>)) {
        if (typeof value !== 'string' && value !== null) {
          return { ok: false, message: 'set_properties.properties values must be strings or null.' };
        }
        properties[property] = value === null ? null : (value as string);
      }
      return {
        ok: true,
        value: {
          tool,
          ids: parsed.ids,
          properties,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
	    if (tool === 'edit_component' && typeof parsedComponentRef === 'string' && typeof parsed.request === 'string' && parsed.request.trim().length > 0) {
      return {
        ok: true,
        value: { tool, component_ref: parsedComponentRef, request: parsed.request, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined },
      };
    }
    if (tool === 'patch_component' && typeof parsedComponentRef === 'string' && Array.isArray(parsed.edits) && parsed.edits.length > 0) {
      const edits: ComponentPatchEdit[] = [];
      for (const candidate of parsed.edits) {
        if (!candidate || typeof candidate !== 'object') {
          return { ok: false, message: 'patch_component.edits must be an array of patch operations.' };
        }
        const edit = candidate as Record<string, unknown>;
        if (edit.op === 'replace' && Number.isInteger(edit.start_line) && Number.isInteger(edit.end_line) && typeof edit.text === 'string') {
          edits.push({ op: 'replace', start_line: Number(edit.start_line), end_line: Number(edit.end_line), text: edit.text });
          continue;
        }
        if (edit.op === 'delete' && Number.isInteger(edit.start_line) && Number.isInteger(edit.end_line)) {
          edits.push({ op: 'delete', start_line: Number(edit.start_line), end_line: Number(edit.end_line) });
          continue;
        }
        if (edit.op === 'insert_before' && Number.isInteger(edit.line) && typeof edit.text === 'string') {
          edits.push({ op: 'insert_before', line: Number(edit.line), text: edit.text });
          continue;
        }
        if (edit.op === 'insert_after' && Number.isInteger(edit.line) && typeof edit.text === 'string') {
          edits.push({ op: 'insert_after', line: Number(edit.line), text: edit.text });
          continue;
        }
        return { ok: false, message: 'patch_component edits must use replace, delete, insert_before, or insert_after with valid line numbers.' };
      }
      return {
        ok: true,
        value: {
          tool,
          component_ref: parsedComponentRef,
          edits,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'remove_section' && typeof parsed.section_ref === 'string') {
      return {
        ok: true,
        value: { tool, section_ref: parsed.section_ref, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined },
      };
    }
    if (tool === 'remove_component' && typeof parsedComponentRef === 'string') {
      return {
        ok: true,
        value: { tool, component_ref: parsedComponentRef, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined },
      };
    }
    if (tool === 'create_component' && typeof parsed.position === 'string' && typeof parsed.hvy === 'string' && parsed.hvy.trim().length > 0) {
      if (parsed.position !== 'append-to-section' && parsed.position !== 'before' && parsed.position !== 'after') {
        return { ok: false, message: 'create_component.position must be append-to-section, before, or after.' };
      }
      const htmlMessage = validateHvyToolPayload(parsed.hvy, 'create_component.hvy', 'component');
      if (htmlMessage) {
        return { ok: false, message: htmlMessage };
      }
      return {
        ok: true,
        value: {
          tool,
          position: parsed.position,
          section_ref: typeof parsed.section_ref === 'string' ? parsed.section_ref : undefined,
          target_component_ref: parsedTargetComponentRef,
          hvy: parsed.hvy,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'create_section' && typeof parsed.position === 'string') {
      if (parsed.position !== 'append-root' && parsed.position !== 'append-child' && parsed.position !== 'before' && parsed.position !== 'after') {
        return { ok: false, message: 'create_section.position must be append-root, append-child, before, or after.' };
      }
      const title = typeof parsed.title === 'string' ? parsed.title : undefined;
      const hvy = typeof parsed.hvy === 'string' ? parsed.hvy : undefined;
      if (!hvy && !title) {
        return { ok: false, message: 'create_section requires hvy or title.' };
      }
      if (hvy) {
        const htmlMessage = validateHvyToolPayload(hvy, 'create_section.hvy', 'section');
        if (htmlMessage) {
          return { ok: false, message: htmlMessage };
        }
      }
      return {
        ok: true,
        value: {
          tool,
          position: parsed.position,
          title,
          hvy,
          new_position_index_from_0: Number.isInteger(parsed.new_position_index_from_0) ? Number(parsed.new_position_index_from_0) : undefined,
          target_section_ref: typeof parsed.target_section_ref === 'string' ? parsed.target_section_ref : undefined,
          parent_section_ref: typeof parsed.parent_section_ref === 'string' ? parsed.parent_section_ref : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (
      tool === 'reorder_section' &&
      typeof parsed.section_ref === 'string' &&
      (Number.isInteger(parsed.new_position_index_from_0) ||
        (typeof parsed.target_section_ref === 'string' && (parsed.position === 'before' || parsed.position === 'after')))
    ) {
      return {
        ok: true,
        value: {
          tool,
          section_ref: parsed.section_ref,
          target_section_ref: typeof parsed.target_section_ref === 'string' ? parsed.target_section_ref : undefined,
          position: parsed.position === 'before' || parsed.position === 'after' ? parsed.position : undefined,
          new_position_index_from_0: Number.isInteger(parsed.new_position_index_from_0) ? Number(parsed.new_position_index_from_0) : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    const parsedDbTableName = typeof parsed.table_name === 'string'
      ? parsed.table_name
      : typeof parsed.table === 'string'
        ? parsed.table
        : undefined;
    if (
      tool === 'query_db_table' &&
      (
        typeof parsedDbTableName === 'string'
        || typeof parsed.query === 'string'
      )
    ) {
      if (typeof parsed.query === 'string' && parsed.query.trim().length === 0 && typeof parsedDbTableName !== 'string') {
        return { ok: false, message: 'query_db_table requires table_name or a non-empty query.' };
      }
      return {
        ok: true,
        value: {
          tool,
          table_name: parsedDbTableName,
          query: typeof parsed.query === 'string' ? parsed.query : undefined,
          limit: Number.isInteger(parsed.limit) ? Number(parsed.limit) : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'execute_sql' && typeof parsed.sql === 'string' && parsed.sql.trim().length > 0) {
      return {
        ok: true,
        value: {
          tool,
          sql: parsed.sql.trim(),
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    return { ok: false, message: 'Return one valid tool JSON object using the documented shapes.' };
  } catch {
    return { ok: false, message: 'Return valid JSON only, with no surrounding prose.' };
  }
}

function normalizeToolJsonSource(source: string): string {
  const trimmed = source.trim();
  const fullFence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fullFence?.[1]) {
    return fullFence[1].trim();
  }
  const fencedJsonBlocks = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)]
    .map((match) => match[1]?.trim() ?? '')
    .filter((block) => block.startsWith('{') && block.endsWith('}'));
  return fencedJsonBlocks.length === 1 ? fencedJsonBlocks[0] : trimmed;
}

function isDocumentBatchControlTool(tool: DocumentEditToolRequest['tool']): boolean {
  return tool === 'answer' || tool === 'done' || tool === 'plan' || tool === 'mark_step_done' || tool === 'batch';
}

function validateHvyToolPayload(hvy: string, fieldName: string, kind: 'component' | 'section'): string | null {
  const trimmed = hvy.trim();
  if (/^\s*<!--\s*hvy:form\b/i.test(trimmed)) {
    return [
      `${fieldName} uses unsupported \`hvy:form\` syntax.`,
      'Use a registered plugin id from the prompt with `<!--hvy:plugin {"plugin":"PLUGIN_ID","pluginConfig":{}}-->`, or answer that the requested plugin is unavailable.',
    ].join(' ');
  }
  const withoutHvyComments = trimmed.replace(/<!--\s*hvy:[\s\S]*?-->/gi, '');
  if (/<\/?(?:html|body|main|div|section|article|header|footer|nav|table|thead|tbody|tr|td|th|form|input|button|select|option|script|style|h[1-6]|p|ul|ol|li|span|label)\b/i.test(withoutHvyComments)) {
    return [
      `${fieldName} contains HTML/DOM markup, but document edit tools only accept serialized HVY.`,
      kind === 'section'
        ? 'Retry with an HVY section fragment that starts with `<!--hvy: {"id":"..."}-->`, then `#! Title`, then HVY components like `<!--hvy:text {}-->` or `<!--hvy:plugin {...}-->`.'
        : 'Retry with one HVY component fragment that starts with an HVY directive like `<!--hvy:text {}-->`, `<!--hvy:table {...}-->`, `<!--hvy:container {...}-->`, or `<!--hvy:plugin {...}-->`.',
      'Do not use HTML tags such as `<div>`, `<table>`, `<form>`, `<input>`, or `<button>`.',
    ].join(' ');
  }
  if (kind === 'component' && !/^\s*<!--\s*hvy:[a-z][a-z0-9-]*(?::[a-z0-9-]+)*\s*\{/i.test(trimmed)) {
    return `${fieldName} must start with one HVY component directive, for example \`<!--hvy:text {}-->\`.`;
  }
  if (kind === 'section' && !/^\s*<!--\s*hvy:(?:subsection\s*)?\s*\{/i.test(trimmed)) {
    return `${fieldName} must start with one HVY section directive, for example \`<!--hvy: {"id":"new-section"}-->\`.`;
  }
  return null;
}

export function parseHeaderEditToolRequest(source: string): { ok: true; value: HeaderEditToolRequest } | { ok: false; message: string } {
  const cleaned = normalizeToolJsonSource(source);
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: 'Return a single JSON object.' };
    }
    const tool = parsed.tool;
    if (tool === 'done') {
      return { ok: true, value: { tool, summary: typeof parsed.summary === 'string' ? parsed.summary : undefined } };
    }
    if (tool === 'answer' && typeof parsed.answer === 'string' && parsed.answer.trim().length > 0) {
      return { ok: true, value: { tool, answer: parsed.answer } };
    }
    if (tool === 'plan' && Array.isArray(parsed.steps) && parsed.steps.every((step) => typeof step === 'string' && step.trim().length > 0)) {
      return {
        ok: true,
        value: {
          tool,
          steps: parsed.steps.map((step) => step.trim()),
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'mark_step_done' && Number.isInteger(parsed.step)) {
      return {
        ok: true,
        value: {
          tool,
          step: Number(parsed.step),
          summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'request_header') {
      return { ok: true, value: { tool, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined } };
    }
    if (tool === 'grep_header' && typeof parsed.query === 'string' && parsed.query.trim().length > 0) {
      const flags = typeof parsed.flags === 'string' ? parsed.flags : undefined;
      try {
        buildGrepRegex(parsed.query, flags);
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : 'grep_header query must be a valid regex pattern.',
        };
      }
      return {
        ok: true,
        value: {
          tool,
          query: parsed.query,
          flags,
          before: Number.isInteger(parsed.before) ? Number(parsed.before) : undefined,
          after: Number.isInteger(parsed.after) ? Number(parsed.after) : undefined,
          max_count: Number.isInteger(parsed.max_count) ? Number(parsed.max_count) : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'view_header') {
      return {
        ok: true,
        value: {
          tool,
          start_line: Number.isInteger(parsed.start_line) ? Number(parsed.start_line) : undefined,
          end_line: Number.isInteger(parsed.end_line) ? Number(parsed.end_line) : undefined,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    if (tool === 'patch_header' && Array.isArray(parsed.edits) && parsed.edits.length > 0) {
      const edits = parsePatchEdits(parsed.edits);
      if (edits.ok === false) {
        return { ok: false, message: edits.message };
      }
      return {
        ok: true,
        value: {
          tool,
          edits: edits.value,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        },
      };
    }
    return { ok: false, message: 'Return one valid header tool JSON object using the documented shapes.' };
  } catch {
    return { ok: false, message: 'Return valid JSON only, with no surrounding prose.' };
  }
}

function parsePatchEdits(source: unknown[]): { ok: true; value: ComponentPatchEdit[] } | { ok: false; message: string } {
  const edits: ComponentPatchEdit[] = [];
  for (const candidate of source) {
    if (!candidate || typeof candidate !== 'object') {
      return { ok: false, message: 'patch edits must be an array of patch operations.' };
    }
    const edit = candidate as Record<string, unknown>;
    if (edit.op === 'replace' && Number.isInteger(edit.start_line) && Number.isInteger(edit.end_line) && typeof edit.text === 'string') {
      edits.push({ op: 'replace', start_line: Number(edit.start_line), end_line: Number(edit.end_line), text: edit.text });
      continue;
    }
    if (edit.op === 'delete' && Number.isInteger(edit.start_line) && Number.isInteger(edit.end_line)) {
      edits.push({ op: 'delete', start_line: Number(edit.start_line), end_line: Number(edit.end_line) });
      continue;
    }
    if (edit.op === 'insert_before' && Number.isInteger(edit.line) && typeof edit.text === 'string') {
      edits.push({ op: 'insert_before', line: Number(edit.line), text: edit.text });
      continue;
    }
    if (edit.op === 'insert_after' && Number.isInteger(edit.line) && typeof edit.text === 'string') {
      edits.push({ op: 'insert_after', line: Number(edit.line), text: edit.text });
      continue;
    }
    return { ok: false, message: 'patch edits must use replace, delete, insert_before, or insert_after with valid line numbers.' };
  }
  return { ok: true, value: edits };
}

export function inferEditPathFromRequest(request: string): EditPathSelection {
  return /\b(header|front matter|frontmatter|metadata|meta|component_defs|component defs|section_defs|section defs|reusable|theme|reader_max_width|sidebar_label|template|schema|plugin)\b/i.test(
    request
  )
    ? 'header'
    : 'document';
}

export function isLikelyInformationalAnswerRequest(request: string): boolean {
  const normalized = request.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    /\b(add|append|change|convert|create|delete|edit|fix|format|insert|make|move|patch|remove|rename|replace|reorder|set|style|update|write)\b/i.test(
      normalized
    )
  ) {
    return false;
  }
  return (
    /\?$/.test(normalized) ||
    /^(can|could|did|do|does|how|is|should|what|when|where|which|who|why)\b/i.test(normalized) ||
    /^(can|could) you (explain|tell me|answer|clarify)\b/i.test(normalized)
  );
}

function buildGrepRegex(query: string, explicitFlags?: string): RegExp {
  const slashRegexMatch = query.match(/^\/([\s\S]*)\/([dgimsuvy]*)$/);
  const source = slashRegexMatch ? slashRegexMatch[1] ?? '' : query;
  const flags = explicitFlags ?? (slashRegexMatch ? slashRegexMatch[2] : 'i') ?? 'i';

  try {
    return new RegExp(source, flags);
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unknown regex error.';
    throw new Error(`grep query must be a valid regex. ${details}`);
  }
}

function buildToolRegex(query: string, explicitFlags: string | undefined, label: string): RegExp {
  try {
    return buildGrepRegex(query, explicitFlags);
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unknown regex error.';
    throw new Error(`${label} must be a valid regex. ${details}`);
  }
}
