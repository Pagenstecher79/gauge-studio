/**
 * The card's own icons: Lucide, inlined.
 *
 * Every chip, every button under the canvas and every section heading used to
 * be a character - an arrow from one Unicode block, a wheel from another, an
 * emoji for the headings. A row of those is never a set: each one was drawn
 * by a different hand at a different weight, half of them are coloured by the
 * font rather than by us, and which glyph a system has at all is the system's
 * business, so the same menu did not look the same on two machines.
 *
 * These are one set, one weight, one 24x24 box, and they take their colour
 * from `currentColor` - so a chip's icon follows the chip, and a heading's
 * follows the text, with nothing to keep in step by hand.
 *
 * They are inlined rather than fetched: the card is one bundle that Home
 * Assistant serves from a dashboard, and an icon that arrives over the network
 * is an icon that is missing on the first paint and absent behind a firewall.
 * Two dozen paths cost less than the request would.
 *
 * Lucide is ISC licensed and some of it is MIT (Feather); both notices are in
 * `LICENSES/lucide.txt`, which the licences require us to carry.
 */
import { html, svg } from "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js";

/**
 * An icon is sized by the text around it, not by a number here: `1em` means a
 * chip and a heading each get one that fits, and the one place to change the
 * size of an icon is the font size it sits next to.
 */
const BOX = 'width:1em;height:1em;display:inline-block;vertical-align:-.125em;flex:none';

/**
 * The drawing of each one, without the `<svg>` around it - so the box, the
 * stroke and the joins are decided once, below, and an icon cannot drift from
 * the rest by carrying its own.
 */
const PARTS = {
  'a-large-small':
    svg`<path d="m15 16 2.536-7.328a1.02 1.02 1 0 1 1.928 0L22 16" /> <path d="M15.697 14h5.606" /> <path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" /> <path d="M3.304 13h6.392" />`,
  'align-center-horizontal':
    svg`<path d="M2 12h20" /> <path d="M10 16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" /> <path d="M10 8V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4" /> <path d="M20 16v1a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-1" /> <path d="M14 8V7c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2v1" />`,
  'align-center-vertical':
    svg`<path d="M12 2v20" /> <path d="M8 10H4a2 2 0 0 1-2-2V6c0-1.1.9-2 2-2h4" /> <path d="M16 10h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4" /> <path d="M8 20H7a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h1" /> <path d="M16 14h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1" />`,
  'align-end-horizontal':
    svg`<rect width="6" height="16" x="4" y="2" rx="2" /> <rect width="6" height="9" x="14" y="9" rx="2" /> <path d="M22 22H2" />`,
  'align-end-vertical':
    svg`<rect width="16" height="6" x="2" y="4" rx="2" /> <rect width="9" height="6" x="9" y="14" rx="2" /> <path d="M22 22V2" />`,
  'align-horizontal-distribute-center':
    svg`<rect width="6" height="14" x="4" y="5" rx="2" /> <rect width="6" height="10" x="14" y="7" rx="2" /> <path d="M17 22v-5" /> <path d="M17 7V2" /> <path d="M7 22v-3" /> <path d="M7 5V2" />`,
  'align-start-horizontal':
    svg`<rect width="6" height="16" x="4" y="6" rx="2" /> <rect width="6" height="9" x="14" y="6" rx="2" /> <path d="M22 2H2" />`,
  'align-start-vertical':
    svg`<rect width="9" height="6" x="6" y="14" rx="2" /> <rect width="16" height="6" x="6" y="4" rx="2" /> <path d="M2 2v20" />`,
  'align-vertical-distribute-center':
    svg`<path d="M22 17h-3" /> <path d="M22 7h-5" /> <path d="M5 17H2" /> <path d="M7 7H2" /> <rect x="5" y="14" width="14" height="6" rx="2" /> <rect x="7" y="4" width="10" height="6" rx="2" />`,
  'arrow-left-to-line': svg`<path d="M3 19V5" /> <path d="m13 6-6 6 6 6" /> <path d="M7 12h14" />`,
  'arrow-right-left':
    svg`<path d="m16 3 4 4-4 4" /> <path d="M20 7H4" /> <path d="m8 21-4-4 4-4" /> <path d="M4 17h16" />`,
  'arrow-right-to-line': svg`<path d="M17 12H3" /> <path d="m11 18 6-6-6-6" /> <path d="M21 5v14" />`,
  'axis-3d':
    svg`<path d="M13.5 10.5 15 9" /> <path d="M4 4v15a1 1 0 0 0 1 1h15" /> <path d="M4.293 19.707 6 18" /> <path d="m9 15 1.5-1.5" />`,
  'blend': svg`<circle cx="15" cy="9" r="7" /> <circle cx="9" cy="15" r="7" />`,
  'chart-column':
    svg`<path d="M3 3v16a2 2 0 0 0 2 2h16" /> <path d="M18 17V9" /> <path d="M13 17V5" /> <path d="M8 17v-3" />`,
  'chart-gantt':
    svg`<path d="M10 6h8" /> <path d="M12 16h6" /> <path d="M3 3v16a2 2 0 0 0 2 2h16" /> <path d="M8 11h7" />`,
  'chart-pie':
    svg`<path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z" /> <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />`,
  'check': svg`<path d="M20 6 9 17l-5-5" />`,
  'chevron-down': svg`<path d="m6 9 6 6 6-6" />`,
  'chevron-left':
    svg`<path d="m15 18-6-6 6-6" />`,
  'chevron-right': svg`<path d="m9 18 6-6-6-6" />`,
  'chevron-up': svg`<path d="m18 15-6-6-6 6" />`,
  'chevrons-down': svg`<path d="m7 6 5 5 5-5" /> <path d="m7 13 5 5 5-5" />`,
  'chevrons-up': svg`<path d="m17 11-5-5-5 5" /> <path d="m17 18-5-5-5 5" />`,
  'circle': svg`<circle cx="12" cy="12" r="10" />`,
  'circle-dashed':
    svg`<path d="M10.1 2.182a10 10 0 0 1 3.8 0" /> <path d="M13.9 21.818a10 10 0 0 1-3.8 0" /> <path d="M17.609 3.721a10 10 0 0 1 2.69 2.7" /> <path d="M2.182 13.9a10 10 0 0 1 0-3.8" /> <path d="M20.279 17.609a10 10 0 0 1-2.7 2.69" /> <path d="M21.818 10.1a10 10 0 0 1 0 3.8" /> <path d="M3.721 6.391a10 10 0 0 1 2.7-2.69" /> <path d="M6.391 20.279a10 10 0 0 1-2.69-2.7" />`,
  'circle-off':
    svg`<path d="m2 2 20 20" /> <path d="M8.35 2.69A10 10 0 0 1 21.3 15.65" /> <path d="M19.08 19.08A10 10 0 1 1 4.92 4.92" />`,
  'clapperboard':
    svg`<path d="m12.296 3.464 3.02 3.956" /> <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z" /> <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /> <path d="m6.18 5.276 3.1 3.899" />`,
  'combine':
    svg`<path d="M14 3a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1" /> <path d="M19 3a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1" /> <path d="m7 15 3 3" /> <path d="m7 21 3-3H5a2 2 0 0 1-2-2v-2" /> <rect x="14" y="14" width="7" height="7" rx="1" /> <rect x="3" y="3" width="7" height="7" rx="1" />`,
  'compass':
    svg`<circle cx="12" cy="12" r="10" /> <path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" />`,
  'contrast': svg`<circle cx="12" cy="12" r="10" /> <path d="M12 18a6 6 0 0 0 0-12v12z" />`,
  'copy':
    svg`<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /> <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />`,
  'corner-down-right':
    svg`<path d="m15 10 5 5-5 5" /> <path d="M4 4v7a4 4 0 0 0 4 4h12" />`,
  'corner-right-up': svg`<path d="m10 9 5-5 5 5" /> <path d="M4 20h7a4 4 0 0 0 4-4V4" />`,
  'crosshair':
    svg`<circle cx="12" cy="12" r="10" /> <line x1="22" x2="18" y1="12" y2="12" /> <line x1="6" x2="2" y1="12" y2="12" /> <line x1="12" x2="12" y1="6" y2="2" /> <line x1="12" x2="12" y1="22" y2="18" />`,
  'decimals-arrow-right':
    svg`<path d="M10 18h10" /> <path d="m17 21 3-3-3-3" /> <path d="M3 11h.01" /> <rect x="15" y="3" width="5" height="8" rx="2.5" /> <rect x="6" y="3" width="5" height="8" rx="2.5" />`,
  'divide':
    svg`<circle cx="12" cy="6" r="1" /> <line x1="5" x2="19" y1="12" y2="12" /> <circle cx="12" cy="18" r="1" />`,
  'donut':
    svg`<path d="M20.5 10a2.5 2.5 0 0 1-2.4-3H18a2.95 2.95 0 0 1-2.6-4.4 10 10 0 1 0 6.3 7.1c-.3.2-.8.3-1.2.3" /> <circle cx="12" cy="12" r="3" />`,
  'droplet':
    svg`<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />`,
  'flip-vertical':
    svg`<path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3" /> <path d="M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3" /> <path d="M4 12H2" /> <path d="M10 12H8" /> <path d="M16 12h-2" /> <path d="M22 12h-2" />`,
  'fold-horizontal':
    svg`<path d="M2 12h6" /> <path d="M22 12h-6" /> <path d="M12 2v2" /> <path d="M12 8v2" /> <path d="M12 14v2" /> <path d="M12 20v2" /> <path d="m19 9-3 3 3 3" /> <path d="m5 15 3-3-3-3" />`,
  'gauge': svg`<path d="m12 14 4-4" /> <path d="M3.34 19a10 10 0 1 1 17.32 0" />`,
  'grid-3x3':
    svg`<rect width="18" height="18" x="3" y="3" rx="2" /> <path d="M3 9h18" /> <path d="M3 15h18" /> <path d="M9 3v18" /> <path d="M15 3v18" />`,
  'grip-vertical':
    svg`<circle cx="9" cy="12" r="1" /> <circle cx="9" cy="5" r="1" /> <circle cx="9" cy="19" r="1" /> <circle cx="15" cy="12" r="1" /> <circle cx="15" cy="5" r="1" /> <circle cx="15" cy="19" r="1" />`,
  'hash':
    svg`<line x1="4" x2="20" y1="9" y2="9" /> <line x1="4" x2="20" y1="15" y2="15" /> <line x1="10" x2="8" y1="3" y2="21" /> <line x1="16" x2="14" y1="3" y2="21" />`,
  'image':
    svg`<rect width="18" height="18" x="3" y="3" rx="2" ry="2" /> <circle cx="9" cy="9" r="2" /> <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />`,
  'info': svg`<circle cx="12" cy="12" r="10" /> <path d="M12 16v-4" /> <path d="M12 8h.01" />`,
  'layers':
    svg`<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" /> <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" /> <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />`,
  'lightbulb':
    svg`<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /> <path d="M9 18h6" /> <path d="M10 22h4" />`,
  'link':
    svg`<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /> <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />`,
  'list':
    svg`<path d="M3 5h.01" /> <path d="M3 12h.01" /> <path d="M3 19h.01" /> <path d="M8 5h13" /> <path d="M8 12h13" /> <path d="M8 19h13" />`,
  'lock':
    svg`<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /> <path d="M7 11V7a5 5 0 0 1 10 0v4" />`,
  'lock-open':
    svg`<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /> <path d="M7 11V7a5 5 0 0 1 9.9-1" />`,
  'moon':
    svg`<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />`,
  'mountain': svg`<path d="m8 3 4 8 5-5 5 15H2L8 3z" />`,
  'move-diagonal': svg`<path d="M11 19H5v-6" /> <path d="M13 5h6v6" /> <path d="M19 5 5 19" />`,
  'move-horizontal': svg`<path d="m18 8 4 4-4 4" /> <path d="M2 12h20" /> <path d="m6 8-4 4 4 4" />`,
  'move-vertical': svg`<path d="M12 2v20" /> <path d="m8 18 4 4 4-4" /> <path d="m8 6 4-4 4 4" />`,
  'paintbrush':
    svg`<path d="m14.622 17.897-10.68-2.913" /> <path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z" /> <path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15" />`,
  'palette':
    svg`<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" /> <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /> <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /> <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /> <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />`,
  'pencil':
    svg`<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /> <path d="m15 5 4 4" />`,
  'pill':
    svg`<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" /> <path d="m8.5 8.5 7 7" />`,
  'pin':
    svg`<path d="M12 17v5" /> <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />`,
  // The same pin lying loose, for the off state of a button whose on
  // state is `pin-in`: turned off the upright, shrunk by the same amount
  // the turn would have pushed past the edge of the box.
  'pin-loose':
    svg`<g transform="rotate(-40 12 12) scale(.9) translate(1.33 1.33)"><path d="M12 17v5" /> <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></g>`,
  'plus': svg`<path d="M5 12h14" /> <path d="M12 5v14" />`,
  'pointer':
    svg`<path d="M22 14a8 8 0 0 1-8 8" /> <path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2" /> <path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1" /> <path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10" /> <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />`,
  'proportions':
    svg`<rect width="20" height="16" x="2" y="4" rx="2" /> <path d="M12 9v11" /> <path d="M2 9h13a2 2 0 0 1 2 2v9" />`,
  'puzzle':
    svg`<path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z" />`,
  'rainbow':
    svg`<path d="M22 17a10 10 0 0 0-20 0" /> <path d="M6 17a6 6 0 0 1 12 0" /> <path d="M10 17a2 2 0 0 1 4 0" />`,
  'redo-2':
    svg`<path d="m15 14 5-5-5-5" /> <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />`,
  'rotate-ccw': svg`<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /> <path d="M3 3v5h5" />`,
  'rotate-cw': svg`<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /> <path d="M21 3v5h-5" />`,
  'ruler':
    svg`<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" /> <path d="m14.5 12.5 2-2" /> <path d="m11.5 9.5 2-2" /> <path d="m8.5 6.5 2-2" /> <path d="m17.5 15.5 2-2" />`,
  'save':
    svg`<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /> <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /> <path d="M7 3v4a1 1 0 0 0 1 1h7" />`,
  'scan':
    svg`<path d="M3 7V5a2 2 0 0 1 2-2h2" /> <path d="M17 3h2a2 2 0 0 1 2 2v2" /> <path d="M21 17v2a2 2 0 0 1-2 2h-2" /> <path d="M7 21H5a2 2 0 0 1-2-2v-2" />`,
  'scissors':
    svg`<circle cx="6" cy="6" r="3" /> <path d="M8.12 8.12 12 12" /> <path d="M20 4 8.12 15.88" /> <circle cx="6" cy="18" r="3" /> <path d="M14.8 14.8 20 20" />`,
  'search': svg`<path d="m21 21-4.34-4.34" /> <circle cx="11" cy="11" r="8" />`,
  'separator-horizontal': svg`<path d="m16 16-4 4-4-4" /> <path d="M3 12h18" /> <path d="m8 8 4-4 4 4" />`,
  'settings':
    svg`<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /> <circle cx="12" cy="12" r="3" />`,
  'signal-low': svg`<path d="M2 20h.01" /> <path d="M7 20v-4" />`,
  'signal-medium': svg`<path d="M2 20h.01" /> <path d="M7 20v-4" /> <path d="M12 20v-8" />`,
  'sparkles':
    svg`<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" /> <path d="M20 2v4" /> <path d="M22 4h-4" /> <circle cx="4" cy="20" r="2" />`,
  'sun':
    svg`<circle cx="12" cy="12" r="4" /> <path d="M12 2v2" /> <path d="M12 20v2" /> <path d="m4.93 4.93 1.41 1.41" /> <path d="m17.66 17.66 1.41 1.41" /> <path d="M2 12h2" /> <path d="M20 12h2" /> <path d="m6.34 17.66-1.41 1.41" /> <path d="m19.07 4.93-1.41 1.41" />`,
  'tag':
    svg`<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /> <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />`,
  'trash-2':
    svg`<path d="M10 11v6" /> <path d="M14 11v6" /> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /> <path d="M3 6h18" /> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />`,
  'triangle':
    svg`<path d="M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />`,
  'triangle-alert':
    svg`<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /> <path d="M12 9v4" /> <path d="M12 17h.01" />`,
  'type':
    svg`<path d="M12 4v16" /> <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" /> <path d="M9 20h6" />`,
  'undo-2':
    svg`<path d="M9 14 4 9l5-5" /> <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />`,
  'unfold-horizontal':
    svg`<path d="M16 12h6" /> <path d="M8 12H2" /> <path d="M12 2v2" /> <path d="M12 8v2" /> <path d="M12 14v2" /> <path d="M12 20v2" /> <path d="m19 15 3-3-3-3" /> <path d="m5 9-3 3 3 3" />`,
  'waves':
    svg`<path d="M2 12q2.5 2 5 0t5 0 5 0 5 0" /> <path d="M2 19q2.5 2 5 0t5 0 5 0 5 0" /> <path d="M2 5q2.5 2 5 0t5 0 5 0 5 0" />`,
  'x': svg`<path d="M18 6 6 18" /> <path d="m6 6 12 12" />`,
  'zap':
    svg`<path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z" />`,
  'zoom-in':
    svg`<circle cx="11" cy="11" r="8" /> <line x1="21" x2="16.65" y1="21" y2="16.65" /> <line x1="11" x2="11" y1="8" y2="14" /> <line x1="8" x2="14" y1="11" y2="11" />`,
  'zoom-out':
    svg`<circle cx="11" cy="11" r="8" /> <line x1="21" x2="16.65" y1="21" y2="16.65" /> <line x1="8" x2="14" y1="11" y2="11" />`,
  // The pin of `pin`, driven in: the needle that stands proud of the
  // surface is a stub, because the rest of it is inside. Nothing else
  // changes, so the two read as one thing in two states.
  'pin-in':
    svg`<path d="M12 17v2" /> <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />`,
};

/**
 * @param {string} name
 * @returns {any} the icon, or an empty box when the name is not one we
 * carry - a missing icon must not take the menu down with it.
 */
export function icon(name) {
  const parts = PARTS[name];
  return html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    style=${BOX} aria-hidden="true">${parts || ''}</svg>`;
}

/**
 * The drawing of an icon that a `::before` has to carry.
 *
 * A pseudo-element holds no element, so an icon there can only be a mask -
 * the shape as a data URI, painted with a background. Written out again here
 * rather than read from `PARTS`, because what is in there is a lit template
 * and a template is not text; the pair is kept honest by `icons.test.js`,
 * which asserts the two say the same thing.
 */
const MASK_SOURCE = {
  'chevron-right': '<path d="m9 18 6-6-6-6" />',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" />'
      + '<path d="M7 11V7a5 5 0 0 1 10 0v4" />',
  pointer: '<path d="M22 14a8 8 0 0 1-8 8" />'
         + '<path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />'
         + '<path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1" />'
         + '<path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10" />'
         + '<path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34'
         + 'l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />',
};

/**
 * @param {keyof typeof MASK_SOURCE} name
 * @returns {string} a `url(...)` for `mask` - the icon as a shape, so whatever
 * paints it decides the colour.
 */
export function iconMask(name) {
  const svgText =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"'
    + ' stroke="black" stroke-width="2" stroke-linecap="round"'
    + ' stroke-linejoin="round">' + MASK_SOURCE[name] + '</svg>';
  return `url("data:image/svg+xml,${encodeURIComponent(svgText)}")`;
}

/** The names this module knows, for a test that asks whether one is real. */
export const ICON_NAMES = Object.keys(PARTS);
