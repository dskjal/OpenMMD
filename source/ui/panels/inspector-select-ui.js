/**
 * Replaces the options of a select element.
 * @param {object} options - Render options.
 * @param {HTMLSelectElement|null} options.select - Target select.
 * @param {Document} [options.documentRef] - Source document.
 * @param {Array<{value: string, label: string}>} options.items - Select options.
 * @param {string} options.value - Selected value.
 * @param {boolean} options.disabled - Disabled state.
 */
export function replaceSelectOptions(options) {
  const {
    select,
    documentRef = globalThis.document,
    items,
    value,
    disabled,
  } = options;
  if (!select || !documentRef) {
    return;
  }

  select.innerHTML = '';
  items.forEach((item) => {
    const option = documentRef.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  });
  select.disabled = disabled;
  select.value = value;
}
