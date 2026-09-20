
/**
 * Per-element typography, as CSS text.
 *
 * The card puts this on the slot it renders an element into; the canvas
 * editor puts it on the box it previews that element in. It has to be one
 * function, because a size written in em or % resolves against whichever box
 * the element is sitting in - and a preview whose text is a different size
 * from the card's is not previewing the card.
 *
 * @param {any} item element carrying font_size / font_weight / font_color / overflow
 * @param {string} boxSel selector for the box around the element
 * @param {string} elSel selector for the element inside that box
 * @returns {string}
 */
export function itemTypography(item, boxSel, elSel) {
  let styles = '';
  const fc = item.font_adaptive ? 'var(--primary-text-color)' : (item.font_color || '');

  if (item.font_size || item.font_weight || item.font_color || item.font_adaptive) {
    const fsInherit = item.font_size ? `font-size: inherit !important;` : '';
    const fw = item.font_weight ? `font-weight:${item.font_weight}!important;` : '';
    const fccss = fc ? `color:${fc}!important;` : '';

    styles += `${elSel} { ${fsInherit}${fw}${fccss} }\n`;

    let vars = '';
    if (item.font_size) {
      const fsBase = `${item.font_size}${item.font_unit||'px'}`;
      const fsVar = `min(${fsBase}, 100cqh, 100cqi)`;
      vars += `font-size: ${fsVar} !important; --sc-fs-n:${fsVar}; --sc-fs-v:${fsVar}; `;
    }
    if (item.font_weight) { vars += `--sc-fw-n:${item.font_weight}; --sc-fw-v:${item.font_weight}; `; }
    if (fc) { vars += `--sc-fc-n:${fc}; --sc-fc-v:${fc}; `; }

    if (vars) { styles += `${boxSel} { ${vars} }\n`; }
  }

  if (item.overflow) {
    styles += `${boxSel} { overflow: visible !important; }
      ${elSel} { overflow: visible !important; max-width: none !important; text-overflow: clip !important; }\n`;
  }

  return styles;
}
