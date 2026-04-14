import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../component-helpers';

export const renderExpandableEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const stubAddKey = `expandable-stub:${sectionKey}:${block.id}`;
  const contentAddKey = `expandable-content:${sectionKey}:${block.id}`;
  return `
    <div class="expand-chooser-grid">
      <div class="expandable-part">
        <div class="expandable-label">Stub</div>
        <div class="container-inner-blocks">
          ${(block.schema.expandableStubBlocks ?? []).map((innerBlock) => helpers.renderEditorBlock(sectionKey, innerBlock)).join('')}
        </div>
        <article class="ghost-section-card add-ghost container-add-ghost" data-action="add-expandable-stub-block" data-section-key="${helpers.escapeAttr(
          sectionKey
        )}" data-block-id="${helpers.escapeAttr(block.id)}">
          <div class="ghost-plus-big"><span>+</span></div>
          <div class="ghost-label">Add Stub Component</div>
          <label class="ghost-component-picker">
            <span>Component</span>
            <select data-field="expandable-stub-new-component-type" data-expandable-key="${helpers.escapeAttr(stubAddKey)}">
              ${helpers.renderComponentOptions(helpers.getSelectedAddComponent(stubAddKey, 'container'))}
            </select>
          </label>
        </article>
      </div>
      <div class="expandable-part">
        <div class="expandable-label">Expanded</div>
        <div class="container-inner-blocks">
          ${(block.schema.expandableContentBlocks ?? []).map((innerBlock) => helpers.renderEditorBlock(sectionKey, innerBlock)).join('')}
        </div>
        <article class="ghost-section-card add-ghost container-add-ghost" data-action="add-expandable-content-block" data-section-key="${helpers.escapeAttr(
          sectionKey
        )}" data-block-id="${helpers.escapeAttr(block.id)}">
          <div class="ghost-plus-big"><span>+</span></div>
          <div class="ghost-label">Add Expanded Component</div>
          <label class="ghost-component-picker">
            <span>Component</span>
            <select data-field="expandable-content-new-component-type" data-expandable-key="${helpers.escapeAttr(contentAddKey)}">
              ${helpers.renderComponentOptions(helpers.getSelectedAddComponent(contentAddKey, 'container'))}
            </select>
          </label>
        </article>
      </div>
    </div>
    <label><input type="checkbox" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
      block.id
    )}" data-field="block-expandable-always" ${block.schema.expandableAlwaysShowStub ? 'checked' : ''} /> Always show stub</label>
  `;
};

export const renderExpandableReader: ComponentReaderRenderer = (section, block, helpers) => {
  const stubHtml = (block.schema.expandableStubBlocks ?? []).map((innerBlock) => helpers.renderReaderBlock(section, innerBlock)).join('');
  const contentHtml = (block.schema.expandableContentBlocks ?? []).map((innerBlock) => helpers.renderReaderBlock(section, innerBlock)).join('');
  const expanded = block.schema.expandableExpanded;
  const alwaysShowStub = block.schema.expandableAlwaysShowStub;
  const toggleAttrs = `data-reader-action="toggle-expandable" data-section-key="${helpers.escapeAttr(section.key)}" data-block-id="${helpers.escapeAttr(
    block.id
  )}" aria-expanded="${expanded ? 'true' : 'false'}"`;
  const stubToggle = `<div class="expand-stub-toggle" ${toggleAttrs}>
    <div class="expand-stub">${stubHtml}</div>
  </div>`;
  const collapseStrip = `<div class="expand-collapse-strip" ${toggleAttrs}>Collapse</div>`;
  const body = expanded
    ? alwaysShowStub
      ? `${stubToggle}<div class="expand-content">${contentHtml}</div>`
      : `<div class="expand-content">${contentHtml}</div>${collapseStrip}`
    : stubToggle;
  return `<div class="expandable-reader">
    <div class="expandable-reader-body">${body}</div>
  </div>`;
};
