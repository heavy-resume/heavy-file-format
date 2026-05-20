# CSS Import Order Conflict Audit

Date: 2026-05-20

Scope: source CSS under `src/`, with emphasis on selectors that can match the same element and depend on bundle/import order to win. I focused on layout-affecting properties: `display`, `min-height`, `height`, `width`, `padding`, `margin`, grid/flex alignment, and modal sizing.

## Findings

### Grid add ghost can lose to shared ghost card rules

Element:

```html
<div class="ghost-section-card add-ghost grid-add-ghost">
```

Sources:

- `src/editor/components/grid/grid.ts:17`
- `src/editor/components/grid/grid.css:66`
- `src/editor/editor.css:556`
- `src/editor/editor.css:627`

Conflict:

- `.grid-add-ghost` has specificity `0,1,0`.
- `.ghost-section-card` has specificity `0,1,0`.
- `.add-ghost` has specificity `0,1,0`.

The grid variant sets:

```css
.grid-add-ghost {
  min-height: 100%;
  margin: 0;
  align-self: stretch;
}
```

The shared rules set:

```css
.ghost-section-card {
  min-height: 120px;
}

.add-ghost {
  padding: 0.8rem;
  margin-top: 0.35rem;
}
```

If `editor.css` lands after `grid.css` in a bundle, the base ghost rules can override the grid add ghost's `min-height` and `margin`. This is the closest remaining match to the component-list issue.

Applied fix:

```css
.ghost-section-card.grid-add-ghost {
  min-height: 100%;
  margin: 0;
  align-self: stretch;
}
```

If the intent is also to override `.add-ghost` padding, include `padding` explicitly in the same combined selector.

### Active insert ghost depends on same-file order

Element:

```html
<div class="ghost-section-card add-ghost compact-add-component-ghost active-component-insert-ghost ...">
```

Sources:

- `src/editor/render.ts:587`
- `src/editor/editor.css:631`
- `src/editor/editor.css:660`

Conflict:

- `.compact-add-component-ghost` has specificity `0,1,0`.
- `.active-component-insert-ghost` has specificity `0,1,0`.

The compact rule sets `height`, `padding`, `min-height`, `width`, layout, and gap. The active-insert rule used to override several of those properties through a single-class selector, which was safe only because both rules lived in `editor.css` and `active-component-insert-ghost` appeared later.

Applied fix:

```css
.compact-add-component-ghost.active-component-insert-ghost {
  min-height: 0;
  height: 2rem;
  width: 100%;
  margin: 0.25rem 0;
  padding: 0.25rem 0.6rem;
}
```

### Component metadata modals can lose to `.hvy-document .modal-panel`

Elements:

```html
<section class="modal-panel component-meta-modal">
<section class="modal-panel section-meta-modal">
```

Sources:

- `src/modal.css:20`
- `src/modal.css:34`
- `src/reader/render.ts:1278`
- `src/reader/render.ts:1437`
- `src/reader/render.ts:1467`
- `src/reader/render.ts:1531`
- `src/reader/render.ts:1641`

Conflict:

- `.component-meta-modal` and `.section-meta-modal` have specificity `0,1,0`.
- `.hvy-document .modal-panel` has specificity `0,2,0`.

The base modal rule includes:

```css
.modal-panel,
.hvy-document .modal-panel {
  width: min(920px, calc(100% - 2rem));
}
```

The variants use:

```css
.component-meta-modal,
.section-meta-modal {
  width: min(640px, calc(100% - 2rem));
}
```

Inside `.hvy-document`, `.hvy-document .modal-panel` can beat the variant width regardless of order. Other modal variants in the same file already include scoped companions, for example `.hvy-document .reusable-template-modal`.

Applied fix:

```css
.component-meta-modal,
.section-meta-modal,
.hvy-document .component-meta-modal,
.hvy-document .section-meta-modal {
  width: min(640px, calc(100% - 2rem));
}
```

### Image camera modal can lose to `.hvy-document .modal-panel`

Element:

```html
<section class="modal-panel image-camera-modal">
```

Sources:

- `src/editor/components/image/image.ts:103`
- `src/editor/components/image/image.css:229`
- `src/modal.css:20`

Conflict:

- `.image-camera-modal` has specificity `0,1,0`.
- `.hvy-document .modal-panel` has specificity `0,2,0`.

The image camera modal sets `width`, `max-height`, `display`, `grid-template-rows`, `gap`, `overflow`, and `padding`. In a `.hvy-document` host, the base modal panel rule can override at least `width`, `max-height`, `overflow`, and `padding`.

Applied fix:

```css
.image-camera-modal,
.hvy-document .image-camera-modal {
  width: min(38rem, calc(100% - 1rem));
  max-height: calc(100% - 1rem);
  overflow: hidden;
  padding: 0.75rem;
}
```

### Image camera modal root can lose padding to `.hvy-document .modal-root`

Element:

```html
<div class="modal-root image-camera-modal-root">
```

Sources:

- `src/editor/components/image/image.ts:100`
- `src/editor/components/image/image.css:221`
- `src/modal.css:1`

Conflict:

- `.image-camera-modal-root` has specificity `0,1,0`.
- `.hvy-document .modal-root` has specificity `0,2,0`.

Most declarations match the base modal root, but padding differs:

```css
.modal-root,
.hvy-document .modal-root {
  padding: 1rem;
}

.image-camera-modal-root {
  padding: 0.75rem;
}
```

Applied fix:

```css
.image-camera-modal-root,
.hvy-document .image-camera-modal-root {
  padding: 0.75rem;
}
```

## Recently Addressed Pattern

The component-list add ghost had the same shape as the grid add ghost:

```html
<div class="ghost-section-card add-ghost component-list-add-ghost">
```

The source now uses a combined selector:

```css
.ghost-section-card.component-list-add-ghost {
  min-height: 0;
  padding-block: 0.55rem;
  align-content: center;
}
```

That combined selector has specificity `0,2,0`, so it is no longer dependent on whether `component-list.css` or `editor.css` appears later in the bundle.

## Lower-Risk Notes

- Button variants such as `button.ghost`, `button.secondary`, and `button.danger` are mostly wrapped in `:where(...)` in `src/style.css`, which intentionally keeps base button specificity low. That reduces import-order risk for specialized button classes like `.remove-x`, `.table-add-button`, and `.search-apply-filter-button`.
- Graph expanded modals already include scoped variants such as `.hvy-document .hvy-graph-expanded-modal`, so they do not have the same modal specificity problem as `.image-camera-modal`.
- Several ghost variants in `src/editor/editor.css` are order-sensitive within that file, but not import-order-sensitive today because the base and variant rules are colocated. The highest-risk one from this pass, `active-component-insert-ghost`, has been moved to a combined selector.

## Action Items

- [x] Harden the grid add ghost selector.
   Update `src/editor/components/grid/grid.css` so the variant styles are attached to `.ghost-section-card.grid-add-ghost` instead of only `.grid-add-ghost`. Include any intended overrides for `.add-ghost` properties, especially `margin` and `padding`.

- [x] Make active insert ghost self-contained.
   Update `src/editor/editor.css` so active insert overrides use `.compact-add-component-ghost.active-component-insert-ghost`. This keeps the intended compact-insert layout stable if the compact and active styles are ever split across files.

- [x] Add scoped modal width rules for component metadata modals.
   Update `src/modal.css` to include `.hvy-document .component-meta-modal` and `.hvy-document .section-meta-modal` alongside the unscoped modal variants.

- [x] Add scoped image camera modal rules.
   Update `src/editor/components/image/image.css` to include `.hvy-document .image-camera-modal` for the modal panel overrides and `.hvy-document .image-camera-modal-root` for the root padding override.

- [ ] Add regression coverage for order-sensitive bundled CSS.
   Add a focused embedded-mode test that mounts the affected controls inside `.hvy-document` and asserts computed layout values for grid add ghost, component metadata modal width, and image camera modal sizing. This should catch future bundle-order drift rather than relying on source-file order.

- [ ] Prefer combined selectors for same-node base plus variant classes going forward.
   When markup uses a shared base class and a variant class on the same element, write the variant rule as `.base.variant` when it overrides base layout properties. Avoid relying on a single-class variant selector to beat a single-class base selector by import order.
