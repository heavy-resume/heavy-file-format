import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../component-helpers';

export const renderExpandableEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const stubAddKey = `expandable-stub:${sectionKey}:${block.id}`;
  const contentAddKey = `expandable-content:${sectionKey}:${block.id}`;
  const stub = block.schema.expandableStubBlocks;
  const content = block.schema.expandableContentBlocks;
  const stubBlocks = stub.children;
  const contentBlocks = content.children;
  const stubCount = stubBlocks.length;
  const contentCount = contentBlocks.length;
  const stubOpen = helpers.isExpandableEditorPanelOpen(sectionKey, block.id, 'stub', false);
  const expandedOpen = helpers.isExpandableEditorPanelOpen(sectionKey, block.id, 'expanded', false);
  const stubPreview = stubBlocks
    .slice(0, 2)
    .map((innerBlock) => helpers.renderPassiveEditorBlock(sectionKey, innerBlock))
    .join('');
  const contentPreview = contentBlocks
    .slice(0, 2)
    .map((innerBlock) => helpers.renderPassiveEditorBlock(sectionKey, innerBlock))
    .join('');
  return `
    <div class="expand-chooser-grid">
      <section class="expandable-part expandable-part-stub${stubOpen ? ' is-open' : ' is-closed'}">
        <div class="expandable-header">
          <button type="button" class="expandable-summary expandable-summary-label" data-action="toggle-expandable-editor-panel" data-section-key="${helpers.escapeAttr(
            sectionKey
          )}" data-block-id="${helpers.escapeAttr(block.id)}" data-expandable-panel="stub" aria-expanded="${stubOpen ? 'true' : 'false'}">
            <span class="expandable-label">Stub</span>
          </button>
          <label class="expandable-inline-toggle">
            <input type="checkbox" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
              block.id
            )}" data-field="block-expandable-always" ${block.schema.expandableAlwaysShowStub ? 'checked' : ''} />
            <span>Always show</span>
          </label>
          <label class="expandable-inline-toggle">
            <input type="checkbox" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
              block.id
            )}" data-field="block-expandable-stub-lock" ${stub.lock ? 'checked' : ''} />
            <span>Lock</span>
          </label>
          <button type="button" class="expandable-summary expandable-summary-meta-button" data-action="toggle-expandable-editor-panel" data-section-key="${helpers.escapeAttr(
            sectionKey
          )}" data-block-id="${helpers.escapeAttr(block.id)}" data-expandable-panel="stub" aria-expanded="${stubOpen ? 'true' : 'false'}">
            <span class="expandable-summary-meta">${helpers.escapeHtml(String(stubCount))} component${stubCount === 1 ? '' : 's'}</span>
          </button>
        </div>
        ${
          stubOpen
            ? `<div class="expandable-part-body">
          <div class="container-inner-blocks">
            ${stubBlocks.map((innerBlock) => helpers.renderEditorBlock(sectionKey, innerBlock, stub.lock)).join('')}
          </div>
          ${
            stub.lock
              ? ''
              : `<article class="ghost-section-card add-ghost container-add-ghost" data-action="add-expandable-stub-block" data-section-key="${helpers.escapeAttr(
                  sectionKey
                )}" data-block-id="${helpers.escapeAttr(block.id)}">
                  <div class="ghost-plus-big"><span>+</span></div>
                  <div class="ghost-label">Add Stub Component</div>
                  <label class="ghost-component-picker">
                    <select aria-label="Expandable stub component type" data-field="expandable-stub-new-component-type" data-expandable-key="${helpers.escapeAttr(stubAddKey)}">
                      ${helpers.renderComponentOptions(helpers.getSelectedAddComponent(stubAddKey, 'container'))}
                    </select>
                  </label>
                </article>`
          }
        </div>`
            : `<button type="button" class="expandable-collapsed-preview expandable-collapsed-preview-button" data-action="toggle-expandable-editor-panel" data-section-key="${helpers.escapeAttr(
                sectionKey
              )}" data-block-id="${helpers.escapeAttr(block.id)}" data-expandable-panel="stub" aria-expanded="false">
                 ${stubPreview || '<div class="expandable-collapsed-empty">No stub content yet.</div>'}
               </button>`
        }
      </section>
      <section class="expandable-part expandable-part-expanded${expandedOpen ? ' is-open' : ' is-closed'}">
        <div class="expandable-header">
          <button type="button" class="expandable-summary expandable-summary-label" data-action="toggle-expandable-editor-panel" data-section-key="${helpers.escapeAttr(
            sectionKey
          )}" data-block-id="${helpers.escapeAttr(block.id)}" data-expandable-panel="expanded" aria-expanded="${expandedOpen ? 'true' : 'false'}">
            <span class="expandable-label">Expanded</span>
          </button>
          <label class="expandable-inline-toggle">
            <input type="checkbox" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
              block.id
            )}" data-field="block-expandable-content-lock" ${content.lock ? 'checked' : ''} />
            <span>Lock</span>
          </label>
          <button type="button" class="expandable-summary expandable-summary-meta-button" data-action="toggle-expandable-editor-panel" data-section-key="${helpers.escapeAttr(
            sectionKey
          )}" data-block-id="${helpers.escapeAttr(block.id)}" data-expandable-panel="expanded" aria-expanded="${expandedOpen ? 'true' : 'false'}">
            <span class="expandable-summary-meta">${helpers.escapeHtml(String(contentCount))} component${contentCount === 1 ? '' : 's'}</span>
          </button>
        </div>
        ${
          expandedOpen
            ? `<div class="expandable-part-body">
          <div class="container-inner-blocks">
            ${contentBlocks.map((innerBlock) => helpers.renderEditorBlock(sectionKey, innerBlock, content.lock)).join('')}
          </div>
          ${
            content.lock
              ? ''
              : `<article class="ghost-section-card add-ghost container-add-ghost" data-action="add-expandable-content-block" data-section-key="${helpers.escapeAttr(
                  sectionKey
                )}" data-block-id="${helpers.escapeAttr(block.id)}">
                  <div class="ghost-plus-big"><span>+</span></div>
                  <div class="ghost-label">Add Expanded Component</div>
                  <label class="ghost-component-picker">
                    <select aria-label="Expandable content component type" data-field="expandable-content-new-component-type" data-expandable-key="${helpers.escapeAttr(contentAddKey)}">
                      ${helpers.renderComponentOptions(helpers.getSelectedAddComponent(contentAddKey, 'container'))}
                    </select>
                  </label>
                </article>`
          }
        </div>`
            : `<button type="button" class="expandable-collapsed-preview expandable-collapsed-preview-button" data-action="toggle-expandable-editor-panel" data-section-key="${helpers.escapeAttr(
                sectionKey
              )}" data-block-id="${helpers.escapeAttr(block.id)}" data-expandable-panel="expanded" aria-expanded="false">
                 ${contentPreview || '<div class="expandable-collapsed-empty">No expanded content yet.</div>'}
               </button>`
        }
      </section>
    </div>
  `;
};

export const renderExpandableReader: ComponentReaderRenderer = (section, block, helpers) => {
  const stubHtml = block.schema.expandableStubBlocks.children.map((innerBlock) => helpers.renderReaderBlock(section, innerBlock)).join('');
  const contentHtml = block.schema.expandableContentBlocks.children.map((innerBlock) => helpers.renderReaderBlock(section, innerBlock)).join('');
  const expanded = block.schema.expandableExpanded;
  const alwaysShowStub = block.schema.expandableAlwaysShowStub;
  const stubPaneStyle = helpers.escapeAttr(block.schema.expandableStubCss);
  const contentPaneStyle = helpers.escapeAttr(block.schema.expandableContentCss);
  const toggleAttrs = `data-reader-action="toggle-expandable" data-section-key="${helpers.escapeAttr(section.key)}" data-block-id="${helpers.escapeAttr(
    block.id
  )}" aria-expanded="${expanded ? 'true' : 'false'}"`;
  const stubToggle = `<div class="expandable-pane expandable-pane-stub" style="${stubPaneStyle}">
    <div class="expand-stub-toggle" ${toggleAttrs}>
      <div class="expand-stub">${stubHtml}</div>
    </div>
  </div>`;
  const contentToggleAttrs = `data-reader-action="toggle-expandable" data-expandable-content="true" data-section-key="${helpers.escapeAttr(section.key)}" data-block-id="${helpers.escapeAttr(block.id)}" aria-expanded="true"`;
  const body = expanded
    ? alwaysShowStub
      ? `${stubToggle}<div class="expandable-pane expandable-pane-expanded" style="${contentPaneStyle}"><div class="expand-content" ${contentToggleAttrs}>${contentHtml}</div></div>`
      : `<div class="expandable-pane expandable-pane-expanded" style="${contentPaneStyle}"><div class="expand-content" ${contentToggleAttrs}>${contentHtml}</div></div>`
    : stubToggle;
  return `<div class="expandable-reader is-interactive" data-expandable-id="${helpers.escapeAttr(block.id)}">
    <div class="expandable-reader-body">${body}</div>
  </div>`;
};
