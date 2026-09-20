import type { CSSResult } from 'lit';

export {};

declare global {
  /**
   * The contract a module registered under window.SupercardModules[name]
   * may implement. Every property is optional because each module only
   * implements the pieces it needs (e.g. the debug module has no
   * renderCustomBlock, the layout module has no editorFields).
   */
  interface SupercardModule {
    /** Called on every card render; returns style/DOM fragments to inject. */
    update?: (ctx: {
      stateObj: any;
      stateVal: any;
      val: number;
      isNum: boolean;
      config: any;
      hass: any;
    }) => Record<string, any>;
    /** Called after the shadow DOM has been (re)rendered. */
    onAfterRender?: (shadow: ShadowRoot, config: any, extra?: any) => void;
    /** Declarative field list rendered by the generic module-editor form. */
    editorFields?: () => any[];
    /**
     * Custom LitElement editor block rendered in the main modular editor.
     * `cardConfig` is the whole Lovelace card config, for the few keys that
     * live there rather than in the slot: `grid_options`, which is Home
     * Assistant's own, and the top-level `entity` that YAML written by hand
     * sets instead of the slot's. Commit into it with the `__card__` key.
     */
    renderCustomBlock?: (
      commitFn: (key: string, value: any) => void,
      hass: any,
      slot: any,
      cardConfig?: any
    ) => any;
    /**
     * A fresh, unconfigured entry for this module's list, so that whoever
     * adds one - the module's own editor, or the canvas - gets the same
     * thing. What an entry contains is the module's business.
     */
    newEntry?: () => any;
    /**
     * The canvas editor is where these elements are added and configured, so
     * the module's own section is left out of the main editor on a card that
     * has a canvas. A card still on rows and cells keeps it.
     */
    ownedByCanvas?: boolean;
    /** Extra <style> text injected once per render. */
  }

  /** What `renderField` needs to draw a field and write what it changes. */
  interface EditorFieldCtx {
    entry: any;
    slot?: any;
    hass?: any;
    set: (id: string, value: any) => void;
    setDebounced?: (id: string, value: any) => void;
    [key: string]: any;
  }

  interface SliderOpts {
    min?: number; max?: number; step?: number | string; width?: string; style?: string; int?: boolean;
    dynamicStep?: boolean;
  }

  /** What `lengthRow` takes: which units are offered, and where the unit lives. */
  interface LengthOpts {
    units?: readonly string[];
    /** The unit, where it has a key of its own rather than riding in the value. */
    unit?: string;
    onUnit?: (u: string) => void;
    /** What the element is drawn at when nothing is set - it names the unit. */
    dflt?: string;
    placeholder?: string;
    min?: number; max?: number; step?: number | string;
  }

  /** Shared number/color/target helpers, set up once by supercard-01-core.js. */
  interface SupercardUtilsApi {
    safeFloat: (v: any, d: number) => number;
    hexToRgb: (hex: string) => [number, number, number] | null;
    rgbToHex: (r: number, g: number, b: number) => string;
    /** Reads [r,g,b] arrays, #rgb/#rrggbb and rgb()/rgba(); var() only with resolveVars. */
    toRgb: (value: any, opts?: { resolveVars?: boolean }) => [number, number, number] | null;
    /** Looks up a var(--x) against the document root; anything else passes through. */
    resolveVar: (v: string) => string;
    sampleGradient: (stops: { pos: number; color: string }[], pct: number) => string;
    getAvailableElements: (slot: any) => Record<string, string>;
    /** The gauges and progress bars a slot contains, as {id, label} records. */
    listElements: (slot: any) => {
      gauges: { id: string; label: string }[];
      bars: { id: string; label: string }[];
    };
    /**
     * What to call an element in front of a person - the entry's own label,
     * else the entity's alias or friendly name - or '' when the card knows
     * nothing better than the id.
     */
    elementLabel: (slot: any, hass: any, id: string, cardEntity?: string) => string;
    /**
     * Whether the card actually draws this element. False only on a canvas
     * card that has no box for the id - there, being absent from the canvas
     * is what "removed" means.
     */
    showsElement: (config: any, id: string) => boolean;
    /**
     * The selector for the shadow part the layout renderer draws an element
     * in, for a bare element id. Both models name their item boxes this way.
     */
    elementPartSelector: (id: string) => string;
    /** Resolves entity/attribute through the global alias list. */
    resolveAlias: (
      list: { id: string; entity: string; attribute: string; alias?: string }[],
      cfg: any,
      entityKey?: string,
      attrKey?: string
    ) => { entity: string; attribute: string; alias: string; match: any };
    /** Every entity id referenced anywhere in a config object. */
    collectEntityIds: (node: any, out?: Set<string>, depth?: number) => Set<string>;
    /**
     * Whether a new `hass` can change what a component reading `ids` draws.
     * Themes, locale and language count as inputs - formatters read them.
     */
    hassInputsChanged: (oldHass: any, newHass: any, ids: Iterable<string>) => boolean;
    /** A copy of `list` with one field of entry `idx` replaced. */
    withPatch: <T>(list: T[], idx: number, key: string, value: any) => T[];
    /**
     * Whether a gauge takes its size from the box it sits in. Always true on a
     * canvas, where the element is the size control; otherwise the gauge's own
     * `gauge_size_responsive`. The renderer and fx-glass must agree on it.
     */
    gaugeIsResponsive: (gaugeConfig: any, onCanvas?: boolean) => boolean;
    /**
     * Whether the card draws from its canvas - a `canvas` key plus the
     * `layout_active` that gates the renderer. A card with the layout off
     * draws the plain content row whatever canvas it still carries.
     */
    onCanvas: (slot: any) => boolean;
    /**
     * Whether the card draws itself as a pill. Never on a canvas card, where
     * the shape control is not offered and a leftover `pill` would be a shape
     * nothing could change.
     */
    cardIsPill: (slot: any) => boolean;
    /**
     * The card's corner radius as a CSS length, or null when it has not set
     * one - the fallback differs per caller. A `%` radius is resolved against
     * the named side of the card's measured size, because border-radius's own
     * percentage draws an ellipse rather than a corner.
     */
    cardRadius: (slot: any) => string | null;
    /** The swatch-and-text colour control, drawn the same in every editor. */
    colorRow: (value: string, onInput: (v: string) => void, opts?: {
      fallback?: string; placeholder?: string; hexOnly?: boolean; textFallback?: boolean;
    }) => any;
    /** `colorRow` under its own label. */
    colorField: (label: string, value: string, onInput: (v: string) => void, opts?: {
      fallback?: string; placeholder?: string; hexOnly?: boolean; textFallback?: boolean;
    }) => any;
    /**
     * A length and the unit it is measured in - the number, and the menu
     * beside it saying what the number means. Pass `unit`/`onUnit` where the
     * unit has a key of its own; leave them out and it rides in the value.
     */
    lengthRow: (value: string | number | undefined, onInput: (v: string) => void, opts?: LengthOpts) => any;
    /** `lengthRow` under its own label. */
    lengthField: (label: any, value: string | number | undefined, onInput: (v: string) => void, opts?: LengthOpts) => any;
    /** A stored length taken apart; the number comes back as typed. */
    splitLength: (value: string | number | undefined | null, dflt?: string) => { n: string; unit: string };
    /** The ready-made colour ramps as swatches; the caller says what a pick means. */
    rampGrid: (onPick: (id: string) => void, opts?: { label?: string }) => any;
    /** The range input alone, for a row a module draws itself. */
    slider: (value: number, onInput: (v: number) => void, opts?: SliderOpts) => any;
    /** A slider beside its label. */
    sliderRow: (label: any, value: number, onInput: (v: number) => void, opts?: SliderOpts) => any;
    /** A slider under its label, with the value read out beside it. */
    sliderField: (label: any, value: number, onInput: (v: number) => void, opts?: SliderOpts & { shown?: any }) => any;
    /** The ⓘ that opens one explanation in a balloon. */
    tipDot: (text: any, opts?: { right?: boolean }) => any;
    /** One field of an editor built from a field array. */
    renderField: (field: any, ctx: EditorFieldCtx) => any;
    /** Every field of a list, in order. */
    renderFields: (fields: any[], ctx: EditorFieldCtx) => any[];
    /** Whether the canvas has taken a field over and it is not to be drawn. */
    fieldFramed: (field: any, entry: any, framed?: Set<string>) => boolean;
    /** Which of a field's parts took it, for the line that stands in for it. */
    framedPart: (field: any, entry: any, framed?: Set<string>) => string | null;
    /** Shared chrome for the card-list module editors (ha-switch family). */
    editorStyles: CSSResult;
    /** Shared chrome for the compact config forms (.toggle family). */
    formStyles: CSSResult;
  }

  interface Window {
    SupercardModules: Record<string, SupercardModule>;
    SupercardUtils: SupercardUtilsApi;
  }
}
