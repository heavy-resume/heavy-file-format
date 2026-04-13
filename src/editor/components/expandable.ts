import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../component-helpers';

export const renderExpandableEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  block.schema.expandableStubComponent = 'container';
  block.schema.expandableContentComponent = 'container';
  const stubPreview = `<div class="reader-block reader-block-container"><div class="reader-container-title">Stub</div><div class="reader-container-body">${helpers.renderComponentFragment(
    'text',
    block.schema.expandableStub,
    block
  )}</div></div>`;
  const expandedPreview = `<div class="reader-block reader-block-container"><div class="reader-container-title">Expanded</div><div class="reader-container-body">${helpers.renderComponentFragment(
    'text',
    block.text,
    block
  )}</div></div>`;
  return `
    <div class="expand-chooser-grid">
      <div class="expandable-part">
        <div class="expandable-label">Stub Container</div>
        ${helpers.renderRichToolbar(sectionKey, block.id, { field: 'block-expandable-stub-rich' })}
        <div class="rich-editor" contenteditable="true" data-section-key="${helpers.escapeAttr(
          sectionKey
        )}" data-block-id="${helpers.escapeAttr(block.id)}" data-field="block-expandable-stub-rich">${helpers.markdownToEditorHtml(
          block.schema.expandableStub
        )}</div>
        <div class="wysiwyg-preview expandable-preview">${stubPreview}</div>
      </div>
      <div class="expandable-part">
        <div class="expandable-label">Expanded Container</div>
        ${helpers.renderRichToolbar(sectionKey, block.id)}
        <div class="rich-editor" contenteditable="true" data-section-key="${helpers.escapeAttr(
          sectionKey
        )}" data-block-id="${helpers.escapeAttr(block.id)}" data-field="block-rich">${helpers.markdownToEditorHtml(block.text)}</div>
        <div class="wysiwyg-preview expandable-preview">${expandedPreview}</div>
      </div>
    </div>
    <label><input type="checkbox" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
      block.id
    )}" data-field="block-expandable-always" ${block.schema.expandableAlwaysShowStub ? 'checked' : ''} /> Always show stub</label>
  `;
};

export const renderExpandableReader: ComponentReaderRenderer = (section, block, helpers) => {
  block.schema.expandableStubComponent = 'container';
  block.schema.expandableContentComponent = 'container';
  const stubHtml = helpers.renderComponentFragment('container', block.schema.expandableStub, block);
  const contentHtml = helpers.renderComponentFragment('container', block.text, block);
  const expanded = block.schema.expandableExpanded;
  const alwaysShowStub = block.schema.expandableAlwaysShowStub;
  const body = expanded
    ? alwaysShowStub
      ? `<div class="expand-stub">${stubHtml}</div><div class="expand-content">${contentHtml}</div>`
      : `<div class="expand-content">${contentHtml}</div>`
    : `<div class="expand-stub">${stubHtml}</div>`;
  return `<div data-reader-action="toggle-expandable" data-section-key="${helpers.escapeAttr(section.key)}" data-block-id="${helpers.escapeAttr(
    block.id
  )}">${body}</div>`;
};
