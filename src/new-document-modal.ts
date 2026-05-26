export function renderNewDocumentModal(
  open: boolean,
  deps: { escapeAttr: (value: string) => string; escapeHtml: (value: string) => string }
): string {
  if (!open) {
    return '';
  }
  const choices = [
    { extension: '.hvy', label: 'HVY', detail: 'Document' },
    { extension: '.thvy', label: 'THVY', detail: 'Template' },
    { extension: '.phvy', label: 'PHVY', detail: 'PDF Doc' },
  ];
  return `
    <div id="newDocumentModalRoot" class="modal-root new-document-modal-root">
      <div class="modal-overlay" data-new-document-action="cancel"></div>
      <section class="modal-panel new-document-modal" role="dialog" aria-modal="true" aria-labelledby="newDocumentModalTitle">
        <div class="modal-head">
          <div>
            <h3 id="newDocumentModalTitle">New Document</h3>
            <p class="muted">Choose the document type to start from.</p>
          </div>
          <div class="modal-head-actions">
            <button type="button" class="ghost" data-new-document-action="cancel">Cancel</button>
          </div>
        </div>
        <div class="new-document-choice-grid">
          ${choices.map((choice) => `
            <button
              type="button"
              class="new-document-choice"
              data-new-document-action="choose"
              data-new-document-extension="${deps.escapeAttr(choice.extension)}"
            >
              <strong>${deps.escapeHtml(choice.label)}</strong>
              <span>${deps.escapeHtml(choice.detail)}</span>
            </button>
          `).join('')}
        </div>
      </section>
    </div>
  `;
}
