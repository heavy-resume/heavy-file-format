import { state } from '../state';
import { escapeAttr, escapeHtml } from '../utils';
import { getPdfExportPlanModalTemplates } from './plan-modal-templates';

export function renderPdfExportPlanModal(): string {
  const modal = state.pdfExportPlanModal;
  if (!modal) {
    return '';
  }
  const templates = getPdfExportPlanModalTemplates(state.document);
  const template = templates.find((entry) => entry.id === modal.templateId) ?? templates[0];
  if (!template) {
    return '';
  }
  const variableEntries = Object.entries(template.variables);
  const diagnostics = modal.plan?.diagnostics ?? [];
  const hasErrors = diagnostics.some((entry) => entry.severity === 'error') || !!modal.error;
  const canExport = !!modal.plan && !hasErrors && !modal.isRunning;
  const statusText = modal.error ?? modal.status ?? (modal.plan ? 'Plan ready for review.' : 'Fill in the prompt fields, then create a plan.');
  const renderJson = (value: unknown): string => escapeHtml(JSON.stringify(value, null, 2));
  return `
    <div class="modal-root pdf-export-plan-modal-root">
      <div class="modal-overlay" data-action="close-pdf-export-plan"></div>
      <section class="modal-panel pdf-export-plan-modal" role="dialog" aria-modal="true" aria-labelledby="pdfExportPlanTitle">
        <div class="modal-head">
          <div>
            <h3 id="pdfExportPlanTitle">Plan PDF Export</h3>
            ${template.description ? `<p class="muted">${escapeHtml(template.description)}</p>` : ''}
          </div>
          <div class="modal-head-actions">
            <button type="button" class="ghost" data-action="close-pdf-export-plan">Close</button>
          </div>
        </div>
        <form id="pdfExportPlanForm" class="pdf-export-plan-form">
          ${
            templates.length > 1
              ? `<label>
                   <span>Template</span>
                   <select id="pdfExportTemplateSelect">
                     ${templates.map((entry) => `<option value="${escapeAttr(entry.id)}" ${entry.id === template.id ? 'selected' : ''}>${escapeHtml(entry.label)}</option>`).join('')}
                   </select>
                 </label>`
              : ''
          }
          ${variableEntries.map(([name, variable]) => {
            const value = modal.values[name] ?? '';
            const label = variable.label || name;
            const field = variable.type === 'text'
              ? `<input type="text" data-pdf-export-value="${escapeAttr(name)}" value="${escapeAttr(value)}" placeholder="${escapeAttr(variable.placeholder ?? '')}">`
              : `<textarea data-pdf-export-value="${escapeAttr(name)}" placeholder="${escapeAttr(variable.placeholder ?? '')}">${escapeHtml(value)}</textarea>`;
            return `
              <label>
                <span>${escapeHtml(label)}${variable.required === false ? '' : ' *'}</span>
                ${field}
                ${variable.helpText ? `<small class="muted">${escapeHtml(variable.helpText)}</small>` : ''}
              </label>
            `;
          }).join('')}
          <div class="pdf-export-plan-actions">
            <button type="submit" class="hvy-button" ${modal.isRunning ? 'disabled' : ''}>${modal.isRunning ? 'Planning...' : 'Create Plan'}</button>
            <button type="button" class="hvy-button" data-action="export-pdf-plan" ${canExport ? '' : 'disabled'}>Export PDF</button>
          </div>
        </form>
        <div class="pdf-export-plan-status ${hasErrors ? 'is-error' : ''}">${escapeHtml(statusText)}</div>
        ${
          diagnostics.length > 0
            ? `<ul class="pdf-export-plan-diagnostics">
                 ${diagnostics.map((entry) => `<li class="is-${escapeAttr(entry.severity)}">${escapeHtml(entry.message)}</li>`).join('')}
               </ul>`
            : ''
        }
        <details class="pdf-export-plan-guts" open>
          <summary>Planning Guts</summary>
          <div class="pdf-export-plan-debug-grid">
            <section>
              <h4>Rendered Prompt</h4>
              <pre>${escapeHtml(modal.plan?.renderedPrompt ?? template.prompt)}</pre>
            </section>
            <section>
              <h4>Content View</h4>
              <pre>${renderJson(modal.plan?.contentView ?? {})}</pre>
            </section>
            <section>
              <h4>Strategy</h4>
              <pre>${renderJson(modal.plan?.strategy ?? {})}</pre>
            </section>
            <section>
              <h4>Prep Script</h4>
              <pre>${escapeHtml(modal.plan?.prepScript ?? '')}</pre>
            </section>
            <section>
              <h4>Decisions</h4>
              <pre>${renderJson(modal.plan?.decisions ?? [])}</pre>
            </section>
            <section>
              <h4>Preview Stats</h4>
              <pre>${renderJson(modal.plan?.previewStats ?? {})}</pre>
            </section>
          </div>
        </details>
      </section>
    </div>
  `;
}
