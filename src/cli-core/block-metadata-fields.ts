import type { BlockSchema, BuiltinComponentName } from '../editor/types';
import type { JsonObject } from '../hvy/types';

// JSON replacement resets precisely the fields exposed by JSON readback.
// Child trees, table data, and runtime state live outside this metadata file.
const commonBlockFields = [
  'id',
  'css',
  'lock',
  'align',
  'slot',
  'sortKeys',
  'derivedSortKeyNames',
  'derivedGroupKeyNames',
  'groupKeys',
  'tags',
  'description',
  'hideIfYes',
  'placeholder',
  'fillIn',
  'editorOnly',
  'visibleScript',
  'xrefTitle',
  'xrefDetail',
] as const satisfies readonly (keyof BlockSchema)[];

const componentBlockFields: Partial<Record<BuiltinComponentName, readonly (keyof BlockSchema)[]>> = {
  'container': ['containerTitle', 'containerExpanded', 'containerCollapsedPreviewRem'],
  'expandable': ['expandableAlwaysShowStub', 'expandableExpanded', 'expandableStubCss', 'expandableContentCss', 'expandableStubDescription', 'expandableContentDescription'],
  'component-list': ['componentListComponent', 'componentListItemLabel', 'componentListDefaultSortKey', 'componentListDefaultSortDirection', 'componentListDefaultGroupKey', 'componentListGroupsExpanded', 'componentListGroupCollapsedPreviewRem'],
  'grid': ['gridColumns', 'gridStackWidth'],
  'xref-card': ['xrefTarget', 'xrefTargetTagFilter'],
  'table': ['tableShowHeader'],
  'image': ['imageFile', 'imageAlt', 'caption', 'allowDocumentImageReuse'],
  'carousel': ['carouselImages', 'allowDocumentImageReuse', 'carouselDurationMs', 'carouselPauseOnHover', 'carouselShowControls', 'carouselShowIndicators', 'carouselShowFrame'],
  'plugin': ['plugin', 'pluginConfig', 'pluginSortValues', 'pluginGroupValues'],
  'text': ['showCopy'],
  'code': ['codeLanguage'],
  'button': ['buttonLabel', 'buttonAction', 'buttonVisibleScript', 'buttonSourceScript', 'buttonPrompt', 'buttonTargetScript', 'buttonInputCharLimit', 'buttonOutputCharLimit', 'buttonPositionTargetId', 'buttonCss'],
};

export function cliBlockMetadata(schema: BlockSchema, baseComponent: BuiltinComponentName): JsonObject {
  return Object.fromEntries(
    [...commonBlockFields, ...(componentBlockFields[baseComponent] ?? [])]
      .map((field) => [field, schema[field]])
  ) as JsonObject;
}
