# Backlog

Collected over two days of driving the card, 18-19 September 2026. The
numbers are the ones they were reported under and do not change: they are how
an item is referred to in a commit message or a branch name, and a finished
item is struck through rather than removed, so the numbering stays stable.

Nothing here is scheduled. The order below is by area, not by priority.

## Naming: objects and elements

A thing on the canvas is an **object** - a gauge, a bar, a surface, the main
icon. The pieces an object is drawn from are its **elements** - a pointer, a
centre point, a tick, a tick label, a pill.

Until now both were called elements, which is why "element" in the code means
two different things one line apart. The change is being made from the
outside in:

1. **Every word a user reads** says object or element in this sense - buttons,
   chip labels, tooltips, dialog text.
2. **The docs** follow, this one included.
3. **Internal identifiers** follow where they are touched anyway. Not as a
   sweep: `canvas.elements`, `el.id` and the rest are read by code that is
   fine, and renaming them all at once is a large diff with no user-visible
   result.
4. **The config key stays `elements`.** It is written into people's
   dashboards. Renaming it means a migration in `config-cleanup.js` that
   would have to be carried for years, to no end but tidiness.

So: `INNER_KINDS`' `parts` are elements; what the canvas lays out are objects.

## Highlight

- **1** - ~~2.3s and 47% dim, the test slider and field back out, and the
  element in hand lent a colour that stands out against what it is drawn on -
  away for five seconds while its own colour is being chosen.~~ Done. The ink
  is picked by contrast (`highlight-ink.js`) against the gauge's own
  background where it paints one and the card's otherwise, and handed to the
  renderer as `--sc-hl-ink`. A pill keeps its own colour and only breathes:
  the value stands on it, so inking it would hide the thing being set.
- **2** - ~~The dim pulse works in Chrome and not in Safari.~~ Done, in the
  same change that wrote this list down, which is why it was never struck
  through. The suspicion was right: a CSS `filter` reaches the outermost
  `<svg>` in Safari and not the `<line>` and `<text>` inside it, so Safari
  computed the animation and painted nothing. The pulse is the `opacity`
  property now, which every engine paints on an SVG child, and the marks
  that carry an opacity of their own keep it because the keyframes multiply
  rather than set: the drawing puts its own number in `--sc-hl-own` and the
  mark breathes from where it already was.

## Gauge

- **3** - ~~Halve the thickness of the dashed sizing lines on the round
  elements.~~ Done, and measured in pixels rather than in the gauge's own
  units. A band drawn in user units was a different line on every gauge - a
  hair on a small one and a rope on a big one, and thicker again at every step
  of the canvas zoom, which is wrong for a measure: the part frames and the
  grip crosshair are 1px whatever is under them. A band is now `BAND_PX`, one
  pixel, which is thinner than it came to on a gauge of any size and the same
  weight as the frames it is read beside. Half a pixel was tried first and is
  too little to see.
- **7** - Sectors created and shaped on the canvas: a permanent `+ sector`
  button in the top right corner, then a chip per sector holding the options
  that cannot be set by hand (gradient, opacity). Inner and outer radius by
  grips on the edges, length and width likewise.
- **8** - Dragging a sector moves it along a concentric path, without
  shortening its reach.
- **9** - The gap between sectors set by a dashed ring, the way every other
  round element is set.
- **23** - ~~The up/down cursor over a gauge's dashed circle should point at
  the gauge's centre - an arrow head that turns with the pointer's position.~~
  Done. `ns-resize` was on every band and it is the truth only at the top and
  the bottom of a circle: at three o'clock a ring is dragged sideways. The
  cursor is now a double-headed arrow lying along the radius, turned to
  wherever on the ring the hand is, and it keeps turning through the drag.
  Eight pictures cover the circle - a double arrow reads the same turned by
  half a turn - and they are memoised, so a drag right round a ring decodes
  each of them once. See `ring-grab.js`.
- **25** - ~~The pointer's grips become crosshairs while held - only the one
  actually held.~~ Done, and a real one: a vertical and a horizontal line
  crossing at the handle, dashed so they do not hide the marks they are being
  read against. Only while a handle is held, only for the handle actually
  held, and the browser's own arrow is taken away for as long as it is up.
- **27** - ~~The pointer's chip menu must never sit over the needle: where it
  would, show it in two columns above or below the horizontal centre line.
  The point grip takes the size of the label box's grip.~~ Done. The needle
  turns about the centre, so the half of the gauge its tip is not in is the
  half with nothing in it: the menu stands on the centre line and grows away
  from the tip, in two columns because half a gauge is not tall enough for
  eight rows of one. The needle's two handles are now ten pixels across
  whatever the gauge's size, which is what the label box's grip is.
- **28** - ~~Scale label: repair or rework.~~ Repaired, as it was meant. What
  it says is the prefix the card has auto-scaled to, and the unit behind it if
  it is asked for - and both of those can be nothing, so a gauge that is not
  auto-scaling and shows no unit drew a `<text>` with nothing in it. Invisible
  is the smaller half of that: an empty text measures 0x0, so on the canvas it
  was a part with no frame to grab and, because the switch said it was drawn,
  no offer to switch it back on either - a setting that had gone somewhere
  there was no way back from. Now nothing is drawn where there is nothing to
  say, the canvas counts the part as drawn only where it is, and switching it
  on from a chip brings the unit with it the way the multiplier brings ticks.
  Its unit is also the value's question in the same words, so it is asked the
  same way: `show unit` then `replace unit` then the custom one. A card that
  typed a custom unit was replacing with it, and `stripDeadConfig` says so on
  the next edit, so nothing on a dashboard changes what it reads.
- **30 / 48** - Gauge background options reachable from the gauge editor's
  canvas, as a dropdown - the top edge is probably the right place for one.
  If it works, the same for the progress bar.
- **34** - ~~Glass FX for the pointer and the centre point~~; possibly a
  relief FX for ticks and texts. The glass half is done, and it was measured
  before it was built - see `docs/perf-cpu.md`. The cost of glass on a needle
  is the *movement*: a needle sits on its own layer so its rotation is a
  compositor transform, and a `backdrop-filter` takes that away. So the shape
  of the setting follows the measurement. The centre point does not move and
  is free, so its glass has no gate. The needle gets the half that costs
  nothing - a translucent body and a lit rim - as plain `glass`. The lens is
  a second effect and appears only where the needle is wide enough to bend
  anything (`POINTER_LENS_MIN_WIDTH`, four units): at the default width of
  two it bends by a single pixel. The blur is a slider that starts at zero
  and carries the warning, and at zero it writes no `blur()` at all, because
  `blur(0px)` still pays for a backdrop root. The relief for ticks and texts
  is still open.
- **40** - ~~On a very thin frame it is hard to tell whether the inner or the
  outer radius is being grabbed.~~ Done, and it was worse than hard to tell:
  the two hit strokes were the same width and centred on their own bands, so
  on a thin frame they lay on top of one another and the one drawn last - the
  inner edge - took every press. The outer edge, which is the only handle a
  gauge's size has, could not be grabbed at all. `hitZones` now cuts the
  ground at the midpoint between two bands, so a hand from outside finds the
  size and one from inside finds the width; where the frame is nothing and
  the two are one circle the zones meet back to back and the outer edge keeps
  the outward side. Telling them apart is a word on the drawing - `gauge
  size`, `frame width` - because at a pixel apart lighting one of the two up
  is not a difference an eye can read; the band under the hand also goes
  solid. Two things only the running editor showed: a `stroke-width` in the
  stylesheet beats the attribute, so every zone was silently the same size
  again, and a stable sort by radius gave the outward side to the wrong edge
  where the two coincided.
- **46** - ~~Ticks, sub-ticks and every text should answer the gauge
  background adaptively. Visible on a light dashboard theme when the big
  gauge's background goes red: the marks become unreadable.~~ Done.
  "Adaptive" meant `var(--primary-text-color)`, which is the right answer for
  a mark standing on the card and the wrong one the moment the gauge paints a
  field of its own. `adaptive-ink.js` answers the two questions separately:
  what the mark is drawn on - a threshold's or a pulse's fill first, else the
  background's own colour, a gradient averaged, and nothing at all once the
  opacity lets the card through - and then black or white against it. By
  seen lightness, not the WCAG ratio: against `#ff3232` the ratio prefers
  near-black, which is the very colour the complaint is about. Each mark asks
  at its own radius, because a tick label sent out past the background circle
  - where the default puts it - is standing on the card again, and the dial's
  ink there would be the same bug mirrored.

## Bar

- **4** - ~~The gauge's colour presets for the bar too, and templates under
  `+ add object`: first the bar type, then a second menu offering default or
  a colour template.~~ Done, in all three places a bar's colour is chosen.
  `gradientPresetPatch` in `gradient-presets.js` takes the kind it is writing
  for, so one catalogue answers both shapes of key - the gauge's
  `manual_stops` on a percent scale, the bar's `gradient_stops` - and the grid
  of swatches moved into core as `SC.rampGrid`, which is what the gauge's form
  already drew. So the bar's form has the same grid under its gradient switch,
  the new `fill` chip on the canvas holds the same catalogue as a list of
  names, and `+ add object` shows a second page: pick a bar type and it asks
  which colours, with a live miniature per row and *Default* at the top. A
  gauge still places straight from the first page - it has no colours to ask
  about that its own template has not already set.
- **5** - ~~A selected, zoomed bar should put its chips and their menus in the
  free space beside the bar where there is any - today the chip menu covers
  the pill it is meant to be setting. That means the canvas zoom must stop
  resetting on a click beside the canvas: reset only through the edit and
  reset buttons. And while the indicator-line slider is held, only the
  indicator line should dim-pulse.~~ Done, in three parts. A chip menu now
  steps off the mark it is setting, one move along one axis, measured off the
  drawing itself through `data-sc-part` (`_partBox`); the zoom is given back
  only by the edit button that brought it and by the reset button; and the
  indicator line carries its own name beside the pill's, so a row that holds
  the line's colour or thickness pulses the line alone.
- **19** - ~~The bar label has no weight in its chip menu; neither do the bar's
  tick labels.~~ Done. Both now carry the gauge's three-step weight button on
  their chip - `weight` was only ever drawn on a part's frame, and a bar's
  parts have chips rather than frames, so it is drawn on the chip too. The
  label's weight was `label_bold`, a checkbox with two of the three; it is
  `label_font_weight` now, the renderer still reads the checkbox where nothing
  has replaced it, and `stripDeadConfig` rewrites it on the next edit so the
  two never sit in one config. The tick labels had no weight at all, and the
  one they are given is written only once somebody sets it - a label with none
  keeps inheriting the card's, which is what every bar drawn so far is doing.
  The value's `value_bold` went the same way in the same change, so the three
  texts of a bar are set the same way as a gauge's - it has no chip, being no
  part of the canvas, so its three weights are in the form alone.
- **20** - ~~The bar label cannot be dragged out and placed by hand.~~ Done on
  a straight bar, where there is somewhere to drag it to. The label is a part
  now (`BAR_LABEL_PARTS`) rather than a chip, so it gets the gauge's frame:
  dragged where it goes, sized by the corner, `+ Label` at the side when it is
  switched off, and the two offset fields gone from the form while the frame
  is up. What it travels in is the bar's own base unit, which is a length only
  the drawing knows - `measureBar` reads `cqmin` and its siblings off the
  track and a plain `px` off the box's own zoom. The gauge's 25-unit bound went
  with it: that is 25 viewBox units, and the bound that means the same thing
  on a bar is the bar's own box, so a part may now carry a `limit` and a type
  range of its own. A ring keeps the chip - its label has a
  `circular_label_offset_y` and no x at all, so there is nothing to drag it
  sideways to, and `can` on both tables keeps exactly one of the two in the
  editor at a time.
  The frame brought the text with it: a part may now name the config key it
  draws (`text`), and a pencil beside the frame's drop button opens a field
  in the frame itself, so a label is typed where it is read. The gauge's own
  label has one too. See `docs/canvas-editing.md` §9.
- **35** - ~~Check the pill's automatic alignment, and make sure the pill never
  wraps to two lines - shrinking the font where it must.~~ Done. `auto` used to
  cross the pill with the bar, on the reasoning that a pill lying along the bar
  covers a long stretch of it. On a horizontal bar that stood the reading on
  its end, where it has only the bar's *height* to fit into - so it shrank
  until it could not be read. `auto` is 0 degrees now, whichever way the bar
  runs: upright is what a reading is for. A pill turned on its end by hand is
  the one arrangement that can be asked for and not fit, so the card answers
  that where it is asked - a `@container` rule against the bar's own box,
  written by `pillCrossExtent`, stands such a pill upright wherever the bar is
  too flat to hold it and lets it lie back down when there is room. The
  setting is kept, not rewritten, and the rule goes on answering as the
  dashboard is resized, which nothing measured at render time could. The
  rotation row says so, in the form and on the chip.
  The pill is `nowrap` as well, and `pillFontSize` in `pill-glass.js` caps the
  type size against both of the bar's measures: the line of text along its own
  direction, the pill's one line across it - which is what keeps a slim
  vertical bar from breaking the reading over two lines, and keeps the bar's
  own `overflow: hidden` from taking the rounded ends off. Rotation is a
  transform, so which screen axis the text ends up on is known only in the
  renderer, which is why it hands the two extents over rather than the helper
  working them out. The cap is in `cqw`/`cqh` against the bar's own container,
  so it costs no measurement and no second layout pass on the one element that
  moves every frame.
- **42** - ~~The corner radius should be set exactly the way a surface's is.~~
  Done. The grips in the corners were already there; what a surface had and a
  bar did not was the choice of unit, so the number-and-unit row became
  `SC.lengthRow`/`SC.lengthField` and a `'length'` field, and the two
  hand-written copies - the surface's and the glass's - were replaced by it.
  A bar keeps its unit in the value the way every length it owns does, so
  nothing had to be migrated and no renderer changed; the grip is told the
  unit by the value it is about to write and hands it back untouched. The
  glass got the other half of the question as a switch of its own, *Link
  corner radius*: on, the pane rounds exactly as the object under it does and
  follows when that changes; off, it rounds on its own. It defaults to
  whatever the card was already doing, so nothing moved.
- **49** - ~~The indicator line has no adaptive colour, or no switch for
  one.~~ Done. The line marks the fill's edge, so half of it lies on the
  fill and half on the track, and one ink has to be wrong on one of them.
  So the adaptive line is drawn twice and clipped, the way the bar's ticks
  already are, and each half is `adaptive-ink.js`'s answer to the field
  under it - lightness rather than a contrast ratio, because a two-pixel
  line on a saturated hue is read by lightness. Over the track the field is
  not asked at all: a track is a tenth of its colour by default, so what the
  eye reads there is the card, and a white track at half strength over a dark
  dashboard reads as mid-grey while its colour says white - which is how the
  first attempt came out near-black on grey and all but vanished. The theme's
  own text colour is right on the card by definition. The switch is
  *Dual-adaptive colour*, worded as the ticks' own, in the form and on the
  pill's chip.

## Surfaces

- **11** - Put every colour option in the chip menu, as a trial: two-colour
  gradient and multi-colour with the gradient editor.
- **12** - ~~A surface deleted from the canvas must not come back configured
  when a new one is created under the same id - `surface0` deleted and
  recreated should be a fresh surface.~~ Done. A surface *is* its box, so
  deleting it left its paint, its glass and its push behind under
  `elm_surface_0`, and the next `surface_0` drawn came up wearing them.
  `withoutElementConfig` takes those three lists with it, in the same commit
  as the canvas - and the undo step remembers the lists it cleared rather
  than all of them, so undoing a deletion brings the paint back without
  reverting a colour edit made in between.
- **13** - ~~The curvature grips should snap gently at their zero position,
  the way the pointer's do.~~ Done, and then loosened: the window is two
  *pixels*, not a per cent of the box. Read as a per cent it gave a
  400-wide surface six pixels on its sides and two on its top, so one box
  snapped differently depending on which edge you took hold of and the wide
  sides lost the first of their travel. The crest gets the same window round
  the middle of its side.
- **14** - ~~A side curved outwards should become the surface's new outer edge
  on the canvas, and be taken into account by the automatic editing zoom.~~
  Done. A clip path cannot be stroked, so the dashed frame stayed a straight
  rectangle while the paint bowed past it; the same polygon is now drawn as
  an SVG over the same grown layer and the box's own border steps aside. The
  editing zoom fits `bentBox` - what the element reaches - rather than the
  box. Dragging, resizing and aligning still work on the box, which is the
  thing being placed.
- **17** - ~~Glass FX ignores the surface corner radius. *Dimensions & Shape*
  needs checking (the automatic mode is wrong), and every *Manual adjustment*
  with it - they do not work, or are partly pointless.~~ Done; two separate
  faults. The manual edge distance and radius were never read for an element
  target at all - the values went into the config and the glass went on
  fitting itself - so `manual_override`, the switch the editor has always
  drawn, now actually gates them, and the shape lock with them. And a
  surface's corner does not live on its box but on its colour pattern, so
  `inherit` asked the wrong box and answered square every time; the glass
  reads `patternRadiusCss` instead.

## Canvas

- **10** - ~~Show an object's edit button only in live-preview mode - or
  better, have the button switch to live preview for as long as the object
  editor is open.~~ Done, the better way. The frames sit on the drawing, so
  with plain boxes there is nothing for them to sit on and the button used to
  be greyed out with a note asking for the switch to be thrown first - a
  button explaining what to do instead of doing it. Opening an element now
  brings the drawing with it and closing it takes it away again. Nothing is
  committed: `_live` answers yes while the parts are in hand, the switch goes
  on and out of reach for as long as that lasts and says why, and the card
  keeps whatever it was set to.
- **15** - ~~Reset the canvas zoom to its default when the card editor is
  opened again.~~ Done by taking the memory out. The zoom used to be kept for
  the life of the page, keyed by the canvas' shape, so that a glance at
  another card did not cost the magnification you had set up. The other half
  of that bargain is what it actually felt like: the zoom that was right for
  one corner is the wrong thing to be handed when the card is opened again for
  something else, and a view nobody set is a view nobody can account for.
  Opening the editor now shows the whole card.

  It costs nothing inside one dialog, which was measured rather than assumed:
  Home Assistant takes this editor out of the document for the Layout tab, but
  it keeps the element and puts the same instance back, so the zoom survives a
  tab switch by itself. A second opening of the dialog builds a new editor,
  and that is the one case the memory ever covered.
- **16** - ~~In the ordinary canvas view, show each object's lock button
  permanently and make it toggle. Keep the lock button under the canvas for
  locking and unlocking whole groups.~~ Done. The lock in the top right
  corner of a box was a badge that appeared once the box was locked, so it
  answered "is this locked" and nothing else - shutting one meant selecting
  it and pressing the button under the canvas, a long way round for one box.
  It is a button now, on every box, and it toggles that box alone without
  touching or taking the selection. The one under the canvas stays, because
  a group is what it is good at. An open lock is drawn quietly and a shut one
  is not: sixteen bright locks over sixteen gauges are a row of buttons with a
  drawing behind them, and the state worth reading across the canvas is the
  shut one. The frames own the drawing while an element's parts are in hand,
  so the locks step aside for as long as that lasts.
- **21** - ~~The main icon should only be dragged out square, and be configured
  on the canvas through its own edit button (picking the icon from HA's
  dropdown).~~ Done, in two halves. The icon draws on a square em box like a
  gauge draws on a circle, so its shape is its nature and not a choice:
  `isSquareLocked` answers for it now, which is one rule fewer than the
  exception `newBox` used to carry alone, and the corner grip keeps it square
  wherever it is dragged. The other half is that the icon had no setting
  anywhere - it took the entity's own icon and there was nothing to say
  otherwise - so an entity put on a card to mean something else had no say.
  It is a kind in `INNER_KINDS` now, with one part and one chip, and the chip
  holds HA's own `ha-icon-picker`; `icon_override` is what it writes and what
  the core reads before falling back to the entity's icon.
- **22** - ~~Inside an object editor, clicking to select should behave as it
  does on the main canvas: clicking the same spot cycles through elements
  that lie over one another.~~ Done, in both places a part is taken hold of.
  A press on the drawing answered with the topmost thing under it and nothing
  else, so a tick lying under the pill and a ring under the pointer could be
  reached only by hunting along the row of chips - `drawnPartsAt` hands back
  the whole stack in that same order now, and a second press at the same spot
  takes the next one. A press on a text's frame walks the frames the same way,
  measured off the rects the frames are drawn from and grown by the slack they
  are grabbed with, so the walk finds exactly what the press can hit. The
  rules are the canvas' own: a press that moved was a drag and picks nothing
  new, a press with a modifier is adding to what is held rather than walking,
  bare ground starts over, and the spot that is already in hand stays in hand
  for as long as the finger is down - so a part clicked down to can still be
  dragged.
- **24** - ~~Make the chip menus resizable, with a grip in one of the lower
  corners, bounded so they can be neither too large nor too small.~~ Done. A
  grip in the bottom right corner scales the whole menu between three
  quarters and double; the size is one setting for all the menus and outlives
  the dialog.
- **29** - ~~Scale label, label, multiplier and value: their option boxes must
  not cover the element they belong to.~~ Done with 5: the same rule covers
  every part, because it is read off the drawing rather than off a list of
  parts. The scale label has its own menu since 28.
- **31** - New feature: an interactive glass FX editor for the canvas.
- **32** - ~~"Layers (3) - the top of the list is drawn on top" - the list seems
  to work the other way round.~~ Done, though not as a fix to the order: the
  order was measured and is right. Every element on the canvas computes the
  same `z-index: 2` and sits in one stacking parent, so what is drawn on top
  is simply what comes last in the array, the rendered DOM order is that array
  order, and the list reverses it - the top row really is the front. What was
  wrong is that the grip beside each row was decoration: the whole row was an
  HTML5 `draggable`, which has no touch at all, so on a tablet the list could
  not be reordered by hand and the chevrons were the only way. The grip now
  carries the row through the list on pointer events, and dragging past
  either end means the front or the back.

  The confusion had a second half, and it is gone too: there were *two* lists
  over the same objects, the folded stack list and the list of boxes under it,
  in opposite orders, both with a pair of chevrons - so the same button meant
  "forward" in one and "back" in the other, and the fold meant the one you saw
  without opening anything was the one running the wrong way. They are now one
  list, front at the top, unfolded, carrying the grip and the four order
  buttons of the stack list and the numbers and the lock of the other. It no
  longer hides the rows that are not selected either: a stack list that shows
  one object is not a stack list.
- **39** - ~~A circular bar placed through `+ add object` appears at about 63%
  of the box it was drawn in.~~ Done. The ghost under the crosshair and the
  click sized the box from different slots: the click asks the slot *with* the
  entry it is adding, the ghost asked the slot as it is - where the ring is not
  there yet, so `isSquareLocked` said no and the template's `aspect: 1` fell
  through to the strip rule, drawing a box half as wide again as the square the
  click then made. Two thirds, times `circular_scale: 90`, is the 63%.
  `pendingPatch` is now the one place that knows what the slot gains, and both
  callers ask it.
- **50** - The main icon draws a background behind itself; there should be an
  option to take it away, so the icon stands on the card with nothing under
  it.

## Card and editor

- **6** - ~~Grey out *Apply* when there is nothing to save.~~ Done. The
  dialog already knew: Home Assistant compares its working copy against the
  config it opened with, and `dialogHasUnsavedWork` reads that same
  bookkeeping `markDialogClean` writes to. Asked at every render and again
  when the pointer reaches the button, because the dialog also goes dirty for
  a card size set in the Layout tab, which this editor never sees. Anything
  unreadable leaves the button live - the click explains itself, a grey
  button does not.
- **18** - ~~*Card & Dimensions* and *Basics & Entity(ies) & Aliases* belong
  above the canvas after all.~~ Done. `moduleOrder` puts `core` back in front
  of `layout`, so both menus are folded at the top of the dialog and the
  canvas follows them; the second of them is now *Basics, Entity & Aliases*.
  The canvas being the card is why it led - but it is also the tallest thing
  in the dialog, and a settings menu below it is a menu nobody scrolls to.
- **26** - "This one is on the canvas ..." should name the menu that is gone:
  "<name> settings are on the canvas ...". Where only part of a menu has
  moved: "Parts of the <name> settings are in the canvas options box, ...",
  and the canvas options box in question says that more settings are below.
- **36** - ~~A card made almost square through the layout tab keeps a
  rectangular canvas in the editor, so an object cannot be drawn out to the
  full card. *Match the card* should fire automatically after a size change
  in the layout tab.~~ Done. It did fire; it matched the card against the
  480-pixel reference section, because the Layout tab takes the editor out of
  the document and the measurement is read by walking up out of it. The last
  measurement taken while it was mounted is kept now.
- **37** - ~~Setting card height to *auto* collapses the layout tab's height
  to one row, and *Match the card* switches back to fixed rows. Expected:
  *auto* stays on and the canvas follows the layout tab.~~ Done, as far as it
  can be: the one row is Home Assistant's, which pins `min_rows ?? 1` when
  auto height goes off because it has no way to ask a card what it is worth.
  That fallback is now caught and the height the card actually has is pinned
  instead - the same thing this card's own switch does.
- **38** - ~~A new card on a sections dashboard is one row high. It should try
  to come up roughly square.~~ Done: a new card starts as near a square as
  whole rows allow, at any width (`defaultShapeRows`).
- **41** - ~~The `+ add` button of *Global entities (alias)* should look like
  the canvas's `+ add object` button.~~ Done, and the rest of that editor with
  it. The button was a blue `<div>` with its look written into it; it is the
  `.add-btn` every other list uses, with the set's own `plus` beside the word -
  which needed the rule adding to `formStyles`, because the two stylesheets are
  different visual languages but an add button is not one of the things that
  differs. The alias rows carried Material icons from Home Assistant's set - a
  grip, a bin, a clear cross - and so did the colour editor's centre button and
  the five action kinds in the interaction editor; all of them are the card's
  own icons now. The one that could not be, the fold marker under the canvas,
  was a `▶` character: a `::before` holds no element, so it is the same
  chevron as a mask. `mdi:` is left in exactly one place, the icon a user picks
  for the card, which is Home Assistant's to draw.
- **43** - ~~After a card size change in the layout tab, the frames of a gauge
  and a circular bar are no longer square on the way back to the canvas - the
  circular bar is even re-rendered oval.~~ Done, same two causes as 36: the
  canvas was reshaped to a section it is not in, and under auto height a
  width change imposed the old 2:1 default shape on a canvas someone had
  drawn square. Neither happens now; worth a second look if a ring still
  comes back oval.
- **44** - ~~The automatic conversion is still wrong. Cards 10 and 11 in the
  showcase 2 section are where to see it.~~ Done. Both cards carried a rows
  layout that was switched *off*, so the old renderer never drew it and its
  row height was a value somebody stopped typing - `flex: 1` and `flex: 2`,
  which are one and two per cent of the card. Reproduced faithfully, the two
  gauges in them came out as boxes two units across on a four-hundred-unit
  canvas. A layout that is on is still reproduced exactly; one that is off now
  goes through `filledRows`, which shares the card between the rows and leaves
  the widths - the arrangement - alone. Both cards convert to the two
  half-width gauges they have always shown.
- **45** - ~~On some cards HA does not return to the dashboard when the
  dashboard is clicked beside the card editor.~~ Done. Those were the cards
  that get something committed while the editor is opening - the staged
  rows-to-canvas migration, and the `layout_active` switch for a card carrying
  a canvas nobody can see. Home Assistant reads any difference from the config
  it opened with as unsaved work, passes `prevent-scrim-close` to the dialog
  and switches the light dismiss off, so the click beside it does nothing at
  all - not even a confirmation. Both commits now tell the dialog to forget
  them (`markDialogClean`), and the first real edit is what makes it dirty
  again.

## Later

- **33** - Tidy the code: the bundle is approaching 750 kB. Fold blocks that
  do the same job back together, and write the function that covers several
  similar ones where there is one. See the *v3.0.0 redundancy audit* note.
- **47** - Glass FX: markedly better spherical distortion and refraction
  towards the edges. After the bugs above.
