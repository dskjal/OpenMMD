# OpenMMD UI Components Specification

## Summary

OpenMMD uses shared custom elements for common UI controls. The current implementation lives in `source/ui-components.js`, and the shared visual defaults live in `source/styles/ui-components.css`.

The main goal is to avoid duplicated button and numeric-input markup in `index.html` while keeping the usage model simple:

- use the custom element itself as the canonical control
- read and write values through the host element
- listen to `input` and `change` on the host element
- style the host with CSS variables rather than reaching into shadow DOM

## Components

| Element | Purpose |
|---|---|
| `openmmd-button` | Shared button wrapper with icon, toolbar, and compact text variants |
| `openmmd-number-control` | Standalone number input |
| `openmmd-range-control` | Standalone range input |
| `openmmd-range-number-control` | Linked range + number control with a single canonical value |

## `openmmd-button`

### Purpose

Wraps a native `button` inside shadow DOM and provides a shared visual style for ordinary buttons, icon buttons, toolbar buttons, and compact text buttons.

### Public API

- `disabled`
- `type`
- `title`
- `aria-label`
- `variant`
- `focus()`

### Variants

- `variant="icon"`
  - fixed square button size controlled by `--openmmd-icon-button-size`
- `variant="toolbar"`
  - compact padding suited for transport and tool buttons
- `variant="text-small"`
  - reduced padding and smaller text for auxiliary actions

### CSS variables

- `--openmmd-button-border-color`
- `--openmmd-button-radius`
- `--openmmd-button-background`
- `--openmmd-button-color`
- `--openmmd-button-padding`
- `--openmmd-button-white-space`
- `--openmmd-button-overflow-wrap`
- `--openmmd-button-word-break`
- `--openmmd-button-text-align`
- `--openmmd-icon-button-size`
- `--openmmd-toolbar-button-padding`
- `--openmmd-button-icon-size`

### Notes

- The host element does not expose the internal `button` directly.
- Host-level `border` and `padding` styles do not affect the internal button. Use the CSS variables above instead.
- Slotted `img` elements are sized automatically.

## `openmmd-number-control`

### Purpose

Standalone number input wrapped in a custom element.

### Public API

- `value`
- `disabled`
- `min`
- `max`
- `step`
- `placeholder`
- `focus()`

### Events

- `input`
- `change`

Both events bubble and are composed, so the host can be treated like a regular form control.

### CSS variables

- `--openmmd-number-width`
- `--openmmd-number-min-width`
- `--openmmd-number-padding`

## `openmmd-range-control`

### Purpose

Standalone range input wrapped in a custom element.

### Public API

- `value`
- `disabled`
- `min`
- `max`
- `step`
- `focus()`

### Events

- `input`
- `change`

### CSS variables

- `--openmmd-range-width`

## `openmmd-range-number-control`

### Purpose

Linked range + number input with one canonical host value. This is the preferred control for most slider-based settings in OpenMMD.

### Public API

- `value`
- `disabled`
- `min`
- `max`
- `step`
- `placeholder`
- `focus()`
- `defer-number-input-sync` attribute

### Behavior

- the range and number inputs stay synchronized
- both inner inputs update the host `value`
- `input` and `change` are re-emitted from the host
- `focus()` targets the number input
- when `defer-number-input-sync` is present, the number input can emit live `input` updates without resynchronizing the range input until the edit is committed by `change`, blur, or Enter

### CSS variables

- `--openmmd-range-number-width`
- `--openmmd-range-number-gap`
- `--openmmd-range-flex`
- `--openmmd-number-flex`
- `--openmmd-range-number-value-width`
- `--openmmd-range-number-value-min-width`
- `--openmmd-number-padding`

## Usage Rules

- Use the host element id as the canonical id for linked numeric controls.
- Do not target internal shadow DOM elements from page CSS.
- Prefer `openmmd-range-number-control` for paired slider + numeric input settings.
- Prefer `openmmd-number-control` for standalone numeric settings.
- Prefer `openmmd-button` for buttons that should share OpenMMD's common look and interaction model.
- If a control must span the full width of its container, set the layout on the host element or the surrounding grid, not on the inner shadow DOM input.
