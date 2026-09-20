/**
 * Which of a form's rows the canvas has taken, and what is left where they
 * were.
 *
 * Two rules and the bookkeeping around them. A setting the drawing expresses
 * belongs on the drawing, and the form has to let go of it in the same
 * change - `framedBy` on a field says which part replaces it, `framedWhen` is
 * the mirror for the line that stands in. Both editors apply them, so they
 * cannot live inside either one.
 *
 * The counting is here rather than in the editor for the same reason it is
 * worth doing at all: a fold that has lost three of its five rows and one
 * that has lost all five need different sentences, and the panel on the
 * drawing needs the same answer from the other side - whether there is still
 * something below worth going down to. One rule, asked twice.
 */

/**
 * Which part of a field's `framedBy` is the one currently in hand.
 *
 * A field may name several parts, for a setting that more than one of them
 * offers - where the dial starts is asked under the ring that draws the sweep
 * and under the pointer that walks it, and the form lets go for either. So
 * reading `framedBy` back is not the answer; which of them is framed is.
 *
 * @param {any} field
 * @param {any} entry the config being edited
 * @param {Set<string>|undefined} framed the parts the canvas has taken over
 * @returns {string|null}
 */
export function framedPart(field, entry, framed) {
  if (!field) return null;
  const by = typeof field.framedBy === 'function'
    ? field.framedBy(entry) : field.framedBy;
  const parts = Array.isArray(by) ? by : (by ? [by] : []);
  return parts.find((p) => framed?.has?.(p)) ?? null;
}

/**
 * Whether a field has been handed over to the canvas and should not be drawn.
 *
 * @param {any} field
 * @param {any} entry
 * @param {Set<string>|undefined} framed
 * @returns {boolean}
 */
export function fieldFramed(field, entry, framed) {
  if (!field) return false;
  if (framedPart(field, entry, framed)) return true;
  return !!field.framedWhen && !framed?.has?.(field.framedWhen);
}

/** Headings and standing text are not rows: they say nothing and set nothing. */
const CHROME = new Set(['section', 'subsection', 'note']);

/**
 * Whether a field is drawn as a row of the form right now.
 *
 * @param {any} field
 * @param {any} entry
 * @param {any} slot
 * @param {Set<string>|undefined} framed
 * @returns {boolean}
 */
export function fieldShown(field, entry, slot, framed) {
  if (!field || CHROME.has(field.type)) return false;
  if (field.condition && !field.condition(entry, slot)) return false;
  return !fieldFramed(field, entry, framed);
}

/**
 * A flat field array cut into the folds it is drawn as.
 *
 * A subsection is a fold of its own and gets its own entry: the note that
 * stands in for missing rows is drawn wherever those rows were, and a ring's
 * distance and a value's offsets live at different depths of the same menu.
 * Everything before the first heading is the form's own top, which has no
 * name and so is no menu.
 *
 * @param {any[]} fields
 * @returns {{ id: string, title: string, items: any[] }[]}
 */
export function splitMenus(fields) {
  const out = [];
  let cur = null;
  for (const f of Array.isArray(fields) ? fields : []) {
    if (f?.type === 'section' || f?.type === 'subsection') {
      cur = { id: f.id || '', title: String(f.label || '').replace('── ', ''), items: [] };
      out.push(cur);
    } else if (cur) {
      cur.items.push(f);
    }
  }
  return out;
}

/**
 * How many of a fold's rows are still drawn.
 *
 * @param {any[]} items
 * @param {any} entry
 * @param {any} slot
 * @param {Set<string>|undefined} framed
 * @returns {number}
 */
export function menuRest(items, entry, slot, framed) {
  let n = 0;
  for (const f of Array.isArray(items) ? items : []) {
    if (fieldShown(f, entry, slot, framed)) n += 1;
  }
  return n;
}

/**
 * What has happened to a fold: which part took rows from it, and how many
 * rows it still has.
 *
 * Null when nothing was taken, which is the usual case and the one that gets
 * no note at all.
 *
 * @param {any[]} items
 * @param {any} entry
 * @param {any} slot
 * @param {Set<string>|undefined} framed
 * @returns {{ part: string, rest: number }|null}
 */
export function framedIn(items, entry, slot, framed) {
  let part = null;
  for (const f of Array.isArray(items) ? items : []) {
    // A row that is not drawn for a reason of its own was never taken: a
    // setting the entry has no use for cannot have moved to the drawing.
    if (f?.condition && !f.condition(entry, slot)) continue;
    const p = framedPart(f, entry, framed);
    if (p) { part = p; break; }
  }
  if (!part) return null;
  return { part, rest: menuRest(items, entry, slot, framed) };
}

/**
 * The folds a part has taken rows from, seen from the drawing: each one
 * named, with what is left in it.
 *
 * Folds, plural, because a part is usually in two of them. A gauge's needle
 * takes its length and its offset from *Shape & Position* and its colour and
 * its material from *Pointer*, and a panel that named only the first would
 * send someone to the fold with none of what they were looking for. So it
 * answers all of them, in the order the form has them, and the caller drops
 * the ones with nothing left - a fold a part emptied is nowhere to be sent.
 *
 * @param {any[]} fields the editor's whole field array
 * @param {any} entry
 * @param {any} slot
 * @param {string} part
 * @returns {{ id: string, title: string, rest: number }[]}
 */
export function menusFor(fields, entry, slot, part) {
  const framed = new Set([part]);
  const out = [];
  for (const menu of splitMenus(fields)) {
    if (!framedIn(menu.items, entry, slot, framed)) continue;
    out.push({ id: menu.id, title: menu.title,
               rest: menuRest(menu.items, entry, slot, framed) });
  }
  return out;
}
