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
- **2** - The dim pulse works in Chrome and not in Safari. Needs a real
  Safari to say why; the suspicion is `filter` on SVG elements. Whatever
  replaces it has to keep an element's own opacity intact (a frame ring at
  0.4, the bar's label at 0.8), which is the reason it is a filter today.

## Gauge

- **3** - Halve the thickness of the dashed sizing lines on the round
  elements.
- **7** - Sectors created and shaped on the canvas: a permanent `+ sector`
  button in the top right corner, then a chip per sector holding the options
  that cannot be set by hand (gradient, opacity). Inner and outer radius by
  grips on the edges, length and width likewise.
- **8** - Dragging a sector moves it along a concentric path, without
  shortening its reach.
- **9** - The gap between sectors set by a dashed ring, the way every other
  round element is set.
- **23** - The up/down cursor over a gauge's dashed circle should point at the
  gauge's centre - an arrow head that turns with the pointer's position.
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
- **28** - Scale label: repair or rework.
- **30 / 48** - Gauge background options reachable from the gauge editor's
  canvas, as a dropdown - the top edge is probably the right place for one.
  If it works, the same for the progress bar.
- **34** - Glass FX for the pointer and the centre point; possibly a relief FX
  for ticks and texts.
- **40** - On a very thin frame it is hard to tell whether the inner or the
  outer radius is being grabbed.
- **46** - Ticks, sub-ticks and every text should answer the gauge background
  adaptively. Visible on a light dashboard theme when the big gauge's
  background goes red: the marks become unreadable.

## Bar

- **4** - The gauge's colour presets for the bar too, and templates under
  `+ add object`: first the bar type, then a second menu offering default or
  a colour template.
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
- **19** - The bar label has no weight in its chip menu; neither do the bar's
  tick labels.
- **20** - The bar label cannot be dragged out and placed by hand.
- **35** - Check the pill's automatic alignment, and make sure the pill never
  wraps to two lines - shrinking the font where it must.
- **42** - The corner radius should be set exactly the way a surface's is.
- **49** - The indicator line has no adaptive colour, or no switch for one.

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

- **10** - Show an object's edit button only in live-preview mode - or better,
  have the button switch to live preview for as long as the object editor is
  open.
- **15** - Reset the canvas zoom to its default when the card editor is opened
  again.
- **16** - In the ordinary canvas view, show each object's lock button
  permanently and make it toggle. Keep the lock button under the canvas for
  locking and unlocking whole groups.
- **21** - The main icon should only be dragged out square, and be configured
  on the canvas through its own edit button (picking the icon from HA's
  dropdown).
- **22** - Inside an object editor, clicking to select should behave as it
  does on the main canvas: clicking the same spot cycles through elements
  that lie over one another.
- **24** - ~~Make the chip menus resizable, with a grip in one of the lower
  corners, bounded so they can be neither too large nor too small.~~ Done. A
  grip in the bottom right corner scales the whole menu between three
  quarters and double; the size is one setting for all the menus and outlives
  the dialog.
- **29** - ~~Scale label, label, multiplier and value: their option boxes must
  not cover the element they belong to.~~ Done with 5: the same rule covers
  every part, because it is read off the drawing rather than off a list of
  parts. The scale label has no menu to place yet - see 28.
- **31** - New feature: an interactive glass FX editor for the canvas.
- **32** - "Layers (3) - the top of the list is drawn on top" - the list seems
  to work the other way round.
- **39** - ~~A circular bar placed through `+ add object` appears at about 63%
  of the box it was drawn in.~~ Done. The ghost under the crosshair and the
  click sized the box from different slots: the click asks the slot *with* the
  entry it is adding, the ghost asked the slot as it is - where the ring is not
  there yet, so `isSquareLocked` said no and the template's `aspect: 1` fell
  through to the strip rule, drawing a box half as wide again as the square the
  click then made. Two thirds, times `circular_scale: 90`, is the 63%.
  `pendingPatch` is now the one place that knows what the slot gains, and both
  callers ask it.

## Card and editor

- **6** - ~~Grey out *Apply* when there is nothing to save.~~ Done. The
  dialog already knew: Home Assistant compares its working copy against the
  config it opened with, and `dialogHasUnsavedWork` reads that same
  bookkeeping `markDialogClean` writes to. Asked at every render and again
  when the pointer reaches the button, because the dialog also goes dirty for
  a card size set in the Layout tab, which this editor never sees. Anything
  unreadable leaves the button live - the click explains itself, a grey
  button does not.
- **18** - *Card & Dimensions* and *Basics & Entity(ies) & Aliases* belong
  above the canvas after all.
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
- **41** - The `+ add` button of *Global entities (alias)* should look like the
  canvas's `+ add object` button.
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
