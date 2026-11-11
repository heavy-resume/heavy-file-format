import type { HvyPluginContext } from '../types';
import { SCRIPTING_LIBRARY_OPTIONS, type ScriptingLibraryName } from '../scripting/python-program';
import { renderFormRangeEditorInputs, normalizeFormRangeBound, normalizeFormRangeStep } from '../form-range-field/form-range-field';
import { reconcileLiveState, type LiveFormState } from '../form-live-state/form-live-state';
import {
  DEFAULT_FORM_FIELD,
  FORM_FIELD_TYPES,
  formatOptionsText,
  makeUniqueFieldLabel,
  makeUniqueScriptName,
  normalizeFieldRows,
  normalizeFieldType,
  normalizePositiveInt,
  normalizeSubmitAction,
  parseFormSpec,
  parseOptionsText,
  serializeFormConfig,
  serializeFormSpec,
  type FormSpec,
  type FormTriggerName,
} from '../form-spec/form-spec';
import { escapeAttr, escapeHtml } from '../../utils';

export interface FormEditorMount {
  refresh(): void;
  unmount(): void;
}

export function mountFormEditor(ctx: HvyPluginContext, root: HTMLElement, live: LiveFormState): FormEditorMount {
  let forceEditorRender = false;
  let skipNextEditorRefresh = false;
  let openFieldMetaLabel: string | null = null;

  const parseCurrent = () => parseFormSpec(ctx.block.text, ctx.block.schema.pluginConfig);
  const commitSpec = (spec: FormSpec, options?: { refreshEditor?: boolean }) => {
    skipNextEditorRefresh = options?.refreshEditor !== true;
    ctx.setText(serializeFormSpec(spec));
  };
  const commitBehavior = (spec: FormSpec) => {
    skipNextEditorRefresh = true;
    ctx.setConfig(serializeFormConfig(spec));
  };

  function renderEditor(): void {
    const { spec, error } = parseCurrent();
    const scriptNames = Object.keys(spec.scripts);
    const showAdvancedControls = ctx.editor.mode === 'edit' && ctx.editor.detailLevel >= 2;
    root.innerHTML = '';

    if (error) {
      const errorBox = document.createElement('div');
      errorBox.className = 'hvy-form-error';
      errorBox.textContent = `Form YAML error: ${error}`;
      root.appendChild(errorBox);
    }

    const fieldSection = document.createElement('section');
    fieldSection.className = 'hvy-form-editor-section';
    const fieldHead = document.createElement('div');
    fieldHead.className = 'hvy-form-editor-head';
    fieldHead.innerHTML = '<strong>Fields</strong>';
    const addField = document.createElement('button');
    addField.type = 'button';
    addField.className = 'ghost';
    addField.dataset.formAction = 'add-field';
    addField.textContent = 'Add Field';
    fieldHead.appendChild(addField);
    fieldSection.appendChild(fieldHead);

    spec.fields.forEach((field, index) => {
      const article = document.createElement('article');
      article.className = 'hvy-form-field-editor';
      article.dataset.formFieldIndex = String(index);
      article.innerHTML = `
        <div class="hvy-form-field-editor-head">
          <strong>${escapeHtml(field.label)}</strong>
          <span>
            <button type="button" class="ghost" data-form-action="move-field-up" data-form-field-index="${index}">Up</button>
            <button type="button" class="ghost" data-form-action="move-field-down" data-form-field-index="${index}">Down</button>
            ${showAdvancedControls ? `<button type="button" class="ghost" data-form-action="toggle-field-meta" data-form-field-index="${index}">Meta</button>` : ''}
            <button type="button" class="danger" data-form-action="remove-field" data-form-field-index="${index}">Remove</button>
          </span>
        </div>
        <div class="hvy-form-editor-grid">
          ${renderTextInput('Label', 'label', field.label, index)}
          <label><span>Type</span><select data-form-field-index="${index}" data-form-field-prop="type">${FORM_FIELD_TYPES.map((type) => `<option value="${type}"${field.type === type ? ' selected' : ''}>${type}</option>`).join('')}</select></label>
          ${field.type === 'checkbox'
            ? `<label class="hvy-form-checkbox-label"><span>Default Checked</span><input type="checkbox" data-form-field-index="${index}" data-form-field-prop="value" ${field.value === true ? 'checked' : ''}></label>`
            : field.type === 'range'
              ? renderFormRangeEditorInputs(field, index)
              : field.type === 'photo' ? '' : renderTextInput('Default Value', 'value', String(field.value ?? ''), index)}
          ${field.type === 'photo' || field.type === 'range' ? '' : renderTextInput('Placeholder', 'placeholder', field.placeholder, index)}
          ${field.type === 'textarea' ? `<label><span>Rows</span><input type="number" min="1" step="1" value="${field.rows || 2}" data-form-field-index="${index}" data-form-field-prop="rows"></label>` : ''}
          ${field.type === 'range' ? '' : `<label class="hvy-form-checkbox-label"><span>Required</span><input type="checkbox" data-form-field-index="${index}" data-form-field-prop="required" ${field.required ? 'checked' : ''}></label>`}
          ${field.type === 'hidden' ? '' : `<label class="hvy-form-checkbox-label"><span>Disabled</span><input type="checkbox" data-form-field-index="${index}" data-form-field-prop="disabled" ${field.disabled ? 'checked' : ''}></label>`}
        </div>
        ${(field.type === 'select' || field.type === 'radio')
          ? `<label class="hvy-form-options-editor"><span>Options</span><textarea rows="4" data-form-field-index="${index}" data-form-field-prop="options" placeholder="Label | optional-value">${escapeHtml(formatOptionsText(field.options))}</textarea></label>`
          : ''}
      `;
      fieldSection.appendChild(article);
    });

    root.appendChild(fieldSection);
    if (showAdvancedControls && openFieldMetaLabel) {
      const fieldIndex = spec.fields.findIndex((field) => field.label === openFieldMetaLabel);
      const field = spec.fields[fieldIndex];
      if (field) {
        const modal = document.createElement('div');
        modal.className = 'hvy-form-meta-modal-backdrop';
        modal.innerHTML = `
          <section class="hvy-form-meta-modal" role="dialog" aria-modal="true" aria-label="Field metadata">
            <div class="hvy-form-meta-modal-head">
              <strong>Meta: ${escapeHtml(field.label)}</strong>
              <button type="button" class="ghost" data-form-action="close-field-meta">Close</button>
            </div>
            <div class="hvy-form-meta-modal-body">
              <label>
                <span>CSS</span>
                <textarea rows="5" data-form-field-index="${fieldIndex}" data-form-field-prop="metaCss" placeholder="margin: 0.5rem 0;">${escapeHtml(field.meta.css)}</textarea>
              </label>
              ${field.type === 'photo' ? `
                <label><span>Accepted MIME types</span><input data-form-field-index="${fieldIndex}" data-form-field-prop="metaAccept" value="${escapeAttr(field.meta.accept.join(', '))}" placeholder="image/jpeg, image/png"></label>
                <label><span>Maximum bytes</span><input type="number" min="1" step="1" data-form-field-index="${fieldIndex}" data-form-field-prop="metaMaxBytes" value="${field.meta.maxBytes || ''}"></label>
                <label><span>Maximum width</span><input type="number" min="1" step="1" data-form-field-index="${fieldIndex}" data-form-field-prop="metaMaxWidth" value="${field.meta.maxWidth || ''}"></label>
                <label><span>Maximum height</span><input type="number" min="1" step="1" data-form-field-index="${fieldIndex}" data-form-field-prop="metaMaxHeight" value="${field.meta.maxHeight || ''}"></label>
              ` : ''}
              ${renderScriptSelect('Input Script', 'input', field.triggers.input ?? '', fieldIndex, scriptNames)}
              ${renderScriptSelect('Change Script', 'change', field.triggers.change ?? '', fieldIndex, scriptNames)}
              ${renderScriptSelect('Blur Script', 'blur', field.triggers.blur ?? '', fieldIndex, scriptNames)}
            </div>
          </section>
        `;
        root.appendChild(modal);
      } else {
        openFieldMetaLabel = null;
      }
    }

    const scriptSection = document.createElement('section');
    scriptSection.className = 'hvy-form-editor-section';
    const scriptHead = document.createElement('div');
    scriptHead.className = 'hvy-form-editor-head';
    scriptHead.innerHTML = '<strong>Scripts</strong>';
    const addScript = document.createElement('button');
    addScript.type = 'button';
    addScript.className = 'ghost';
    addScript.dataset.formAction = 'add-script';
    addScript.textContent = 'Add Script';
    scriptHead.appendChild(addScript);
    scriptSection.appendChild(scriptHead);
    const scriptControls = document.createElement('div');
    scriptControls.className = 'hvy-form-editor-grid';
    scriptControls.innerHTML = `
      ${renderTopScriptSelect('Initial Script', 'initialScript', spec.initialScript, scriptNames)}
      ${renderTopScriptSelect('Change Script', 'changeScript', spec.changeScript, scriptNames)}
      <label><span>Submit Action</span><select data-form-top-submit-action>
        <option value="script"${spec.submitAction === 'script' ? ' selected' : ''}>Script</option>
        <option value="ai-generate"${spec.submitAction === 'ai-generate' ? ' selected' : ''}>AI Generate</option>
      </select></label>
      ${renderTopScriptSelect('Submit Source Script', 'submitSourceScript', spec.submitSourceScript, scriptNames)}
      ${renderTopScriptSelect('Submit Script', 'submitScript', spec.submitScript, scriptNames)}
      <label><span>Submit Prompt</span><textarea rows="4" data-form-top-text="submitPrompt">${escapeHtml(spec.submitPrompt)}</textarea></label>
      <label><span>Input Limit</span><input type="number" min="1" data-form-top-number="submitInputCharLimit" value="${spec.submitInputCharLimit}"></label>
      <label><span>Output Limit</span><input type="number" min="1" data-form-top-number="submitOutputCharLimit" value="${spec.submitOutputCharLimit}"></label>
      <label><span>Script Step Budget</span><input type="number" min="1" data-form-top-number="scriptStepBudget" value="${spec.scriptStepBudget}"></label>
      <label><span>Submit Label</span><input data-form-top-text="submitLabel" value="${escapeAttr(spec.submitLabel)}"></label>
      <label class="hvy-form-checkbox-label"><span>Show Submit</span><input type="checkbox" data-form-top-checkbox="showSubmit" ${spec.showSubmit ? 'checked' : ''}></label>
      <label class="hvy-form-checkbox-label"><span>Disable Submit</span><input type="checkbox" data-form-top-checkbox="submitDisabled" ${spec.submitDisabled ? 'checked' : ''}></label>
      <label><span>Disabled Reason</span><input data-form-top-text="submitDisabledReason" value="${escapeAttr(spec.submitDisabledReason)}" placeholder="Shown under the disabled submit button"></label>
      <label><span>Form CSS</span><textarea rows="4" data-form-top-text="formCss" placeholder="display: grid; gap: 0.75rem;">${escapeHtml(spec.formCss)}</textarea></label>
      <label><span>Actions CSS</span><textarea rows="4" data-form-top-text="actionsCss" placeholder="grid-column: 1 / -1;">${escapeHtml(spec.actionsCss)}</textarea></label>
      <label><span>Submit CSS</span><textarea rows="4" data-form-top-text="submitCss" placeholder="justify-self: end;">${escapeHtml(spec.submitCss)}</textarea></label>
      <fieldset class="hvy-form-library-fieldset">
        <legend>Script Libraries</legend>
        ${SCRIPTING_LIBRARY_OPTIONS.map((library) => `
          <label class="hvy-form-checkbox-label">
            <span>${escapeHtml(library)}</span>
            <input type="checkbox" data-form-library="${escapeAttr(library)}" ${spec.scriptLibraries.includes(library) ? 'checked' : ''}>
          </label>
        `).join('')}
      </fieldset>
    `;
    scriptSection.appendChild(scriptControls);
    for (const [name, source] of Object.entries(spec.scripts)) {
      const article = document.createElement('article');
      article.className = 'hvy-form-script-editor';
      article.innerHTML = `
        <div class="hvy-form-field-editor-head">
          <label><span>Script Name</span><input data-form-script-name="${escapeAttr(name)}" value="${escapeAttr(name)}"></label>
          <button type="button" class="danger" data-form-action="remove-script" data-form-script-name="${escapeAttr(name)}">Remove</button>
        </div>
        <textarea rows="7" spellcheck="false" data-form-script-source="${escapeAttr(name)}">${escapeHtml(source)}</textarea>
      `;
      scriptSection.appendChild(article);
    }
    root.appendChild(scriptSection);
  }

  const onEditorInput = (event: Event) => {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (!target) return;
    const { spec } = parseCurrent();
    if (target.dataset.formFieldIndex && target.dataset.formFieldProp) {
      const index = Number.parseInt(target.dataset.formFieldIndex, 10);
      const field = spec.fields[index];
      if (!field) return;
      const prop = target.dataset.formFieldProp;
      if (prop === 'type') field.type = normalizeFieldType(target.value);
      if (prop === 'required' && target instanceof HTMLInputElement) field.required = target.checked;
      if (prop === 'disabled' && target instanceof HTMLInputElement) field.disabled = target.checked;
      if (prop === 'value') field.value = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value;
      if (prop === 'options' && target instanceof HTMLTextAreaElement) field.options = parseOptionsText(target.value);
      if (prop === 'label') field.label = target.value;
      if (prop === 'placeholder') field.placeholder = target.value;
      if (prop === 'rows') field.rows = normalizeFieldRows(target.value);
      if (prop === 'min') field.min = normalizeFormRangeBound(target.value, field.min);
      if (prop === 'max') field.max = normalizeFormRangeBound(target.value, field.max);
      if (prop === 'step') field.step = normalizeFormRangeStep(target.value, field.step);
      if (prop === 'metaCss') field.meta.css = target.value;
      if (prop === 'metaAccept') field.meta.accept = target.value.split(',').map((value) => value.trim()).filter(Boolean);
      if (prop === 'metaMaxBytes') field.meta.maxBytes = normalizePositiveInt(target.value, 0);
      if (prop === 'metaMaxWidth') field.meta.maxWidth = normalizePositiveInt(target.value, 0);
      if (prop === 'metaMaxHeight') field.meta.maxHeight = normalizePositiveInt(target.value, 0);
      // A new type changes which inputs exist, so this redraws even with focus inside the form.
      if (prop === 'type') forceEditorRender = true;
      commitSpec(spec, { refreshEditor: prop === 'type' || prop === 'options' });
      if (prop === 'type') {
        root.querySelector<HTMLElement>(`[data-form-field-index="${index}"][data-form-field-prop="type"]`)?.focus({ preventScroll: true });
      }
      return;
    }
    if (target.dataset.formFieldIndex && target.dataset.formTrigger) {
      const index = Number.parseInt(target.dataset.formFieldIndex, 10);
      const field = spec.fields[index];
      const trigger = target.dataset.formTrigger as FormTriggerName;
      if (!field) return;
      if (target.value.trim().length > 0) {
        field.triggers[trigger] = target.value.trim();
      } else {
        delete field.triggers[trigger];
      }
      commitSpec(spec);
      return;
    }
    if (target.dataset.formTopScript) {
      const key = target.dataset.formTopScript as 'initialScript' | 'changeScript' | 'submitSourceScript' | 'submitScript';
      spec[key] = target.value.trim();
      commitBehavior(spec);
      return;
    }
    if (target.dataset.formTopSubmitAction !== undefined) {
      spec.submitAction = normalizeSubmitAction(target.value);
      commitBehavior(spec);
      return;
    }
    if (target.dataset.formTopText === 'submitLabel' || target.dataset.formTopText === 'submitDisabledReason' || target.dataset.formTopText === 'submitPrompt' || target.dataset.formTopText === 'formCss' || target.dataset.formTopText === 'actionsCss' || target.dataset.formTopText === 'submitCss') {
      const key = target.dataset.formTopText as 'submitLabel' | 'submitDisabledReason' | 'submitPrompt' | 'formCss' | 'actionsCss' | 'submitCss';
      spec[key] = target.value;
      commitBehavior(spec);
      return;
    }
    if (target.dataset.formTopNumber === 'submitInputCharLimit' || target.dataset.formTopNumber === 'submitOutputCharLimit' || target.dataset.formTopNumber === 'scriptStepBudget') {
      const key = target.dataset.formTopNumber as 'submitInputCharLimit' | 'submitOutputCharLimit' | 'scriptStepBudget';
      spec[key] = normalizePositiveInt(target.value, spec[key]);
      commitBehavior(spec);
      return;
    }
    if ((target.dataset.formTopCheckbox === 'showSubmit' || target.dataset.formTopCheckbox === 'submitDisabled') && target instanceof HTMLInputElement) {
      spec[target.dataset.formTopCheckbox] = target.checked;
      commitBehavior(spec);
      return;
    }
    if (target.dataset.formLibrary && target instanceof HTMLInputElement) {
      const library = target.dataset.formLibrary as ScriptingLibraryName;
      const nextLibraries = new Set(spec.scriptLibraries);
      if (target.checked) {
        nextLibraries.add(library);
      } else {
        nextLibraries.delete(library);
      }
      spec.scriptLibraries = SCRIPTING_LIBRARY_OPTIONS.filter((name) => nextLibraries.has(name));
      commitBehavior(spec);
      return;
    }
    if (target.dataset.formScriptSource) {
      spec.scripts[target.dataset.formScriptSource] = target.value;
      commitSpec(spec);
      return;
    }
    if (target.dataset.formScriptName) {
      const oldName = target.dataset.formScriptName;
      const nextName = target.value.trim();
      if (nextName.length === 0 || nextName === oldName || nextName in spec.scripts) return;
      spec.scripts[nextName] = spec.scripts[oldName] ?? '';
      delete spec.scripts[oldName];
      if (spec.initialScript === oldName) spec.initialScript = nextName;
      if (spec.changeScript === oldName) spec.changeScript = nextName;
      if (spec.submitSourceScript === oldName) spec.submitSourceScript = nextName;
      if (spec.submitScript === oldName) spec.submitScript = nextName;
      for (const field of spec.fields) {
        for (const trigger of ['input', 'change', 'blur'] as const) {
          if (field.triggers[trigger] === oldName) field.triggers[trigger] = nextName;
        }
      }
      commitSpec(spec);
      if (spec.initialScript === nextName || spec.changeScript === nextName || spec.submitSourceScript === nextName || spec.submitScript === nextName) {
        commitBehavior(spec);
      }
    }
  };

  const onClick = (event: Event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-form-action]');
    if (!button) return;
    const { spec } = parseCurrent();
    const action = button.dataset.formAction;
    if (action === 'add-field') {
      const label = makeUniqueFieldLabel(spec.fields);
      spec.fields.push({ ...DEFAULT_FORM_FIELD, label });
      forceEditorRender = true;
    }
    if (action === 'remove-field') {
      const index = Number.parseInt(button.dataset.formFieldIndex ?? '', 10);
      if (!Number.isNaN(index)) spec.fields.splice(index, 1);
      forceEditorRender = true;
    }
    if (action === 'move-field-up' || action === 'move-field-down') {
      const index = Number.parseInt(button.dataset.formFieldIndex ?? '', 10);
      const targetIndex = action === 'move-field-up' ? index - 1 : index + 1;
      if (targetIndex >= 0 && targetIndex < spec.fields.length) {
        const [field] = spec.fields.splice(index, 1);
        if (field) spec.fields.splice(targetIndex, 0, field);
      }
      forceEditorRender = true;
    }
    if (action === 'toggle-field-meta') {
      const index = Number.parseInt(button.dataset.formFieldIndex ?? '', 10);
      const field = spec.fields[index];
      if (!field) return;
      openFieldMetaLabel = field.label;
      forceEditorRender = true;
      renderEditor();
      return;
    }
    if (action === 'close-field-meta') {
      openFieldMetaLabel = null;
      forceEditorRender = true;
      renderEditor();
      return;
    }
    if (action === 'add-script') {
      spec.scripts[makeUniqueScriptName(spec.scripts)] = '# Python form script';
      forceEditorRender = true;
    }
    if (action === 'remove-script') {
      const name = button.dataset.formScriptName ?? '';
      delete spec.scripts[name];
      if (spec.initialScript === name) spec.initialScript = '';
      if (spec.changeScript === name) spec.changeScript = '';
      if (spec.submitSourceScript === name) spec.submitSourceScript = '';
      if (spec.submitScript === name) spec.submitScript = '';
      commitBehavior(spec);
      forceEditorRender = true;
    }
    commitSpec(spec, { refreshEditor: forceEditorRender });
  };

  const refresh = () => {
    const { spec } = parseCurrent();
    reconcileLiveState(live, spec);
    if (skipNextEditorRefresh && !forceEditorRender) {
      skipNextEditorRefresh = false;
      return;
    }
    skipNextEditorRefresh = false;
    if (!forceEditorRender && root.contains(document.activeElement)) {
      return;
    }
    forceEditorRender = false;
    renderEditor();
  };

  root.addEventListener('input', onEditorInput);
  root.addEventListener('change', onEditorInput);
  root.addEventListener('click', onClick);

  return {
    refresh,
    unmount: () => {
      root.removeEventListener('input', onEditorInput);
      root.removeEventListener('change', onEditorInput);
      root.removeEventListener('click', onClick);
    },
  };
}

function renderTextInput(label: string, prop: string, value: string, index: number): string {
  return `<label><span>${escapeHtml(label)}</span><input data-form-field-index="${index}" data-form-field-prop="${escapeAttr(prop)}" value="${escapeAttr(value)}"></label>`;
}

function renderScriptSelect(label: string, trigger: FormTriggerName, selected: string, index: number, scriptNames: string[]): string {
  return `<label><span>${escapeHtml(label)}</span><select data-form-field-index="${index}" data-form-trigger="${trigger}">${renderScriptOptions(selected, scriptNames)}</select></label>`;
}

function renderTopScriptSelect(label: string, key: string, selected: string, scriptNames: string[]): string {
  return `<label><span>${escapeHtml(label)}</span><select data-form-top-script="${escapeAttr(key)}">${renderScriptOptions(selected, scriptNames)}</select></label>`;
}

function renderScriptOptions(selected: string, scriptNames: string[]): string {
  return [
    `<option value=""${selected.length === 0 ? ' selected' : ''}>None</option>`,
    ...scriptNames.map((name) => `<option value="${escapeAttr(name)}"${selected === name ? ' selected' : ''}>${escapeHtml(name)}</option>`),
  ].join('');
}
