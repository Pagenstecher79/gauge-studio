# Editing on the canvas

What was learned building the gauge's part editor - the mode where a gauge's
own label, value, ring, ticks, needle and hub are set by taking hold of them on
the drawing rather than by finding their sliders in a form.

It is written for the next canvas, not as a record of this one. The rules are
the ones that cost something to find; the code that follows them lives in
`src/supercard-04-layout.js` and `src/gauge-inner-boxes.js`.

---

## 1. The rule the whole thing follows

**A setting that the drawing expresses belongs on the drawing.**

A slider says `pointer_length: 12`. The drawing says how long the needle is.
The person setting it is looking at the second and reading the first, eight
folds down a dialog, and the two are only connected by memory. Everything below
is in service of closing that gap.

The corollary is the part people forget: **the form must let go of what the
canvas has taken.** Two live controls for one value is worse than one badly
placed control, because now they can disagree on screen. In this codebase that
is `field.framedBy` - a field names the part whose frame replaces it, and
disappears while that part is framed. Add the canvas control and the `framedBy`
in the same change, never in two.

## 2. Grab the thing, not a proxy for it

The needle was first draggable by a ring at its base. It worked, and it could
not express a tail that reaches past the pivot - because a radius has no far
side. Re-cast as **a line with two ends**, each end dragged along the needle's
own axis by a *signed* projection, it could:

```js
const along = ((p.x - cx) * Math.cos(a) + (p.y - cy) * Math.sin(a)) / pxPerUnit;
```

Negative is simply the other side. The lesson is not about needles: **when a
gesture cannot reach a value the setting can hold, the handle is modelling the
wrong thing.** Look for the geometry the value actually lives in before adding
a second handle or a clamp.

The line between the two ends is a third grip, and it asks the other question:
the ends say how long the needle is, the line says where on its own axis it
sits. So it writes `pointer_offset` and leaves `pointer_length` alone, and the
tail follows the tip.

That one is **relative where the ends are absolute**. An end is a point and
can be dragged to wherever the pointer is; a line is taken hold of somewhere
along its length, and jumping the tip to the pointer would throw the needle by
however far from the tip the hand happened to grab it. So the grab records the
radius it began at and follows the travel from there.

The line is also what a press selects the pointer by, which is why it is the
one grip with a slop: under `CHIP_DRAG_SLOP` pixels nothing is written, and a
press with a shaking hand stays a press. A handle needs no such guard - nobody
reaches for a 2.4-unit circle by accident.

The tail rests on the pivot, within `NEEDLE_CENTRE_SNAP` of it. A rest is
worth adding where two drawings differ and only one of them is what anybody
meant - a needle that starts at the centre against one that starts a hair off
it - and where the hand cannot hit the value on its own: the tail is behind
the hub exactly as it reaches the centre, hidden by the thing it is being
lined up with. Keep such a rest **narrow** - a few pixels at an ordinary
size. It is there to catch a hand already on the value, not to pull one
towards it: a reach wide enough to feel like help takes the last of the
travel away, and the handle stops answering the hand over the stretch where
it matters most. It must also pull straight through; a tail dragged out the
far side is a dial people draw on purpose and must not stick on the way. The
tip gets none: it is lined up against a ring that is drawn, and where it
should sit is something you can see.

**A rest lands on the value, not near it**, and that is worth the one place
where the two rules collide. Every one of these drags writes on the tenth its
slider steps in, but the length that puts the tail on the pivot is the ring's
radius over the scale, and the ring sits half a stroke in from the edge - a
`stroke_width` of 0.5 leaves that length on a quarter. Rounded to the
nearest tenth it lands beside the pivot by as much as the rest is wide, which
is the rest failing at exactly its job. So the snapped length is the
exception that is written finer.

Worth knowing before reaching for the scale: it is not in this. The tip is
`ring - offset * scale` and the ring is itself a multiple of the scale, so
the scale cancels out of `tip / scale` entirely. `gauge_scale` cannot make
this land or miss, and no default for it would have.

## 3. Only one edge of a band can move

A ring drawn with a stroke centred on radius `r` has its outer edge at
`r + stroke/2`. If `r` is itself derived from the stroke - here
`(25 - stroke/2 - 1) * scale` - the outer edge stands still and *all* thickness
grows inward. So the inner edge is the only edge a drag can be measured
against. Work out which edge actually moves before writing the handle;
otherwise the drag fights the geometry and the number jumps.

## 4. Hit-testing is the hard part, and it is mostly stacking

Every bug in the part editor that a user noticed was a hit-testing bug.

- **The last thing drawn is the first thing hit.** In SVG there is no
  z-index; order is everything.
- **A fat transparent stroke is the handle, not a fat transparent fill.**
  `pointer-events: stroke` on a wide invisible circle or line gives a generous
  grab without swallowing what is inside it. A filled circle eats every press
  in its middle - including the handle at the centre.
- **Labels are obstacles.** A chip that names a ring stands *on* that ring. On
  a small ring - a needle's hub is about two units across - it stands on the
  pivot, over the handle that is dragged to exactly there. Two fixes, both
  needed: a floor on how near the centre a chip may be placed, and a separate
  layer above the chips for the handles.
- **Put the handles in their own layer** and give it the top z-index. Then
  every later question about ordering has one answer.

## 5. Let go, not just take hold

A selection that can only be replaced cannot be cleared. If framing a part
hides its fields (§1), then with no way to unframe, the form has no way back
to its whole list.

**Bare background is the way out.** It costs one line, because every handle
already stops its own event - so any press that reaches the background is, by
construction, a press on nothing:

```js
// Reached only by a press that no part claimed.
if (this._innerSel) this._innerSel = null;
```

### Holding more than one

Four texts that belong under one another - a name, a reading, a scale label, a
multiplier - are arranged against *each other*, not one at a time against the
gauge. So several parts can be held at once, and the gesture is the one the
canvas already uses for its elements: **shift, ctrl or cmd adds a part to what
is held**, a plain press takes one alone, and a plain press on something
already held drags the whole group.

Two rules keep the state honest, and both were bugs before they were rules:

- **Read what is held before the press changes it.** The head of the group is
  whatever is in hand, so assigning the new selection first and asking what is
  held second loses the part that was in hand a line earlier.
- **The head is not also a member.** Pressing a part that was held alongside
  makes it the head and takes it out of the rest; without that the group keeps
  a second copy of its own head, and letting go of that head promotes it back.

The row of alignment buttons under the canvas is then read three ways, in the
order a press is meant: the two middle-axis buttons put whatever is held back
on the gauge's own axis (an offset of zero *is* the middle, so nothing is
measured), the four edges line the held parts up on each other, and with
nothing held at all they do what they have always done to the elements.

Lining parts up cannot be done from the offsets. A part's offset places its
*anchor*, and one part's anchor is the middle of its text where the next one's
is a baseline - two parts sharing an offset do not share an edge. `alignParts`
works off the measured boxes and returns a *travel*, which is why the anchor
each part uses cancels out and a baseline needs no special case.

## 6. Zoom is part of the mode, not a setting beside it

Parts that are a couple of viewBox units across cannot be aimed at, let alone
dragged, at the zoom a whole canvas is arranged at. So entering the mode zooms
to the thing being worked on, and leaving hands the canvas back at the zoom it
was left at.

Three things that were each wrong once:

- **Fit with no margin.** The usual "zoom to selection" leaves 10-15% as air,
  so a selection can be seen in its surroundings. Inside one object there are
  no surroundings - it *is* the subject - and that margin makes entering the
  mode zoom *out* whenever the object fills its canvas. Use the full fit there
  and keep the margin for the fit *button*.
- **Never zoom out on the way in.** Floor the fit at the zoom already set. The
  way in should only ever be a way closer.
- **Going back out is a preference, not a rule.** Leaving happens by clicking
  beside the element at least as often as by pressing the button, and someone
  working their way around one element at a time loses the magnification every
  time their aim is off. So there is a switch in the zoom row, and it is read
  on the way *out* rather than on the way in, so throwing it while an element
  is open means it. It lives beside the zoom memory, for the same reason: a
  preference of the bench, never written to a card.
- **The window's shape is a variable.** If the zoom window carries the canvas'
  aspect ratio, a flat canvas (12 columns by 2 rows) has no vertical room at
  all: the height is already the tight axis at 100%, and the fit comes out
  below 1 however the margin is set. **Square the window off while the mode is
  on** and restore its shape on the way out - and then the fit must reckon with
  the height the window *has*, not the height its shape implies:

  ```js
  const z = Math.min(c.w / boxW, c.h * stretch / boxH);
  ```

## 7. Follow the compositor, not the state

A chip and a dashed line that track a needle driven by a CSS transition cannot
be rendered from state: the state is one frame behind what the compositor is
showing. Read the live transform and write the positions straight to the DOM:

```js
const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
const angle = Math.atan2(m.b, m.a);
```

And end the follow loop on **exact equality**, not on a small threshold - an
ease-out's tail moves by less than any threshold worth setting, so a threshold
stops the loop while the thing is still visibly moving.

## 8. One gesture is one undo step

A drag that commits forty times must still be one press of undo. Here that is a
`quiet` flag on the writer: the first commit of a gesture goes on the stack and
every commit after it inside the same gesture does not. Decide this at the same
time as the gesture, not afterwards.

## 8a. A finger is the page's until it is on something

`touch-action` decides who owns a gesture before a single event is fired, and
on a touchscreen it decides whether the editor can be scrolled at all. The
canvas and the strip around it - the full width of the editor - once said
`touch-action: none`, for the selection frame and the pinch. The cost was
the whole dialog: a finger anywhere near the canvas was swallowed, and the
only way down the page was the sliver outside the strip.

The rule now is that the canvas hands the pan back (`pan-x pan-y`) and
everything that is actually dragged says `none` for itself - the element box,
a part's frame, the grips, the chips. So a finger drawn across the canvas
scrolls the editor, and a finger that lands on a box moves the box.

What that costs, and it is worth naming: a selection frame by finger, which is
a mouse gesture now, and the pinch, whose second finger the browser may take
for a two-finger scroll - the zoom buttons under the canvas are what a
touchscreen has instead.

This cannot be checked in a desktop browser with emulated touch: emulation
still sends mouse events, and a synthetic `TouchEvent` does not scroll
anything. It is checked on the iOS simulator, against a page that puts the
editor in a box that scrolls, and the test is the number: swipe over the empty
canvas and read `scrollTop` before and after, then drag a box and read its x/y.
With the old rule the first number does not move; with this one it does, and
the second still does when the finger starts on the box.

## 9. What a control on the canvas may be

Not everything fits on a chip. What worked:

- **A drag** for anything that is a distance or a position. It is the whole
  point.
- **Steppers under the chip** for the number that is reached for next once the
  distance is right - a count, a length, a thickness, a type size. Under the
  chip, because the ring is already saying one thing by being dragged, and a
  second meaning for the same gesture is no meaning at all.
- **A swap button on the chip** for a setting with two or three values - a
  shape, a weight. It steps round; the tooltip says what the *next* press will
  do, so the preposition belongs in the value's own label
  (`'to normal'`, `'a triangle'`) or the sentence reads wrong.
- **A switch, a short list, a swatch.** A checkbox for something that is on or
  off, a `<select>` of two or three words, and a swatch that opens the
  browser's own colour control each take the three cells the buttons and the
  number would, so every row still reads as one line of the grid. A swatch is
  worth it because a colour is one of the things a mark *is*; a picker that
  needs a dialog of its own is not.
- **A slider** for a value that is a taste rather than a count - a blur, an
  opacity, an angle, a width. It takes two of the four cells and hands the last
  to the number, because a slider with nothing reading out of it says only
  "about here". Steppers stay where the answer is a specific number and the
  next one up is a real choice.
- **A menu that drops a whole design.** A list of ready-made ramps is one
  `<select>` and writes half a dozen keys at once. Two things make it read as
  an offer rather than a mode: nothing records which one was picked, and the
  menu snaps back to its own name afterwards, so it never claims to be showing
  the state of anything. Such a row hands back a patch instead of naming a key.
- **A row that has nothing to set is not drawn.** Every row may carry a
  condition on the config: the four that shape a shadow are not offered while
  there is no shadow, and the three colours of a symmetric ramp are not offered
  while the ring is being coloured from a list. A panel that is eight rows deep
  whatever the part is doing is a panel nobody reads to the bottom.
- **Not a text field, not a free colour value.** A name, an entity, an
  `rgba()` someone types out - those stay in the form. A list that is edited by
  dragging its items about - a gradient's stops - stays there too: it is not
  one control but a small editor, and it needs the room the form has.
- **All of it, or the part will be looked for in both places.** Once a chip
  carries a part's settings it carries the whole of them, minus only what the
  frame already does by being dragged. A chip with three of a part's eight
  settings is a chip that has to be left again for the other five.

Two layout notes that cost an iteration each:

- **One number per line, in a grid**, not a row that wraps. Three pairs of
  identical buttons in a row read as a cluster, wrap wherever the object
  happens to end, and put values of different widths out of line. Four columns
  - glyph, less, value, more - line up and hug their content.
- **`width: max-content` on an absolutely placed cluster**, or it is shrunk to
  the room left of its own left edge - half the object - and wraps although it
  would fit.
- **A glyph, not a word.** A word in front of each number is wider than the
  object the numbers stand on. Pick glyphs that point the way the thing itself
  does: a tick runs outward, so its length is the up-and-down arrow and its
  width the one across.

## 10. Space the labels for what hangs off them

Chips were placed at angles chosen so the chips themselves do not collide.
Then the numbers moved under the selected chip, three lines deep, and landed on
a neighbouring chip. **Whatever hangs off a label is part of that label's
footprint.** Re-check the spacing whenever anything is added to it, and measure
it - the gap is a number, not an impression.

Spacing alone stopped being enough once a panel could be eight rows deep, and
two rules finish the job:

- **The panel stands over the other chips, not under them.** Under was the
  first answer, on the reasoning that a chip is the only way to take a
  different part in hand and must not be covered by something temporary. At
  three rows they rarely met; at eight, a chip lying across the panel took rows
  away with nothing to say that it had. The chips are still there underneath
  and come back the moment the part is let go.
- **The panel is measured and nudged back inside the canvas.** How tall it is
  is a layout result, so nothing that places it can know it in advance: it is
  measured once drawn, pushed off the far edge first and the near one second,
  and capped in height against the canvas - not with a per cent, which would be
  read against the element it hangs on rather than the canvas. The nudge
  already applied is read back off the element rather than remembered, because
  lit rewrites the whole style attribute whenever the chip moves and takes the
  property with it.
- **And it steps off the mark it is setting.** A menu lying across the very
  thing it changes is a menu you have to move to see what you did: the pill's
  numbers sat squarely on the pill, and a gauge's value on the value. Which
  pixels to keep clear is read off the drawing and not off the measured rects,
  because those cover only the texts a frame can be put round: every renderer
  already names each mark with `data-sc-part` for the highlight, so
  `_partBox` asks the same attribute and takes the box around every piece it
  finds. The way out is one step along one axis past the nearest edge of the
  mark, clamped back inside the canvas and then checked again - and a mark
  that fills the view has no beside, so nowhere clear leaves the panel where
  it was rather than shoving it off the edge to honour the rule.
- **The needle's menu is placed by geometry, not by dodging.** Its chip rides
  the middle of the line, so a panel hanging under that chip hangs straight
  down the needle, and the needle moves. The needle turns about the centre,
  which makes the half of the gauge its tip is *not* in the half with nothing
  in it but the hub: the panel stands on the horizontal centre line and grows
  away from the tip. Half a gauge is not tall enough for eight rows of one, so
  that panel is drawn in two columns - a row is four cells of the grid
  whatever the grid's width, so twice the columns simply pairs the rows up.
- **A held needle handle draws a crosshair, and takes the arrow away.** Two
  lines, one each way, crossing where the handle is - dashed and thin,
  because they are drawn across the very ticks they are there to line the
  handle up against, and a solid pair hid them. One handle at a time: a
  crosshair on both ends says nothing about either. While it is up the
  browser's own pointer goes, on the host and on every descendant - nearly
  everything under it sets a cursor of its own, so inheritance alone would
  not reach - because two pointers for one hand, one of them drawn over the
  crossing point the other is there to show, is one too many. The lines are
  moved between renders the same way the handles are, each only along the
  axis it is not drawn on.
- **The grip in the bottom corner sets how big the menus are drawn.** A scale
  and not a width and a height: the rows are a grid whose column widths the
  contents decide, so there is nothing for a width to give. It is one setting
  for every menu, because how big a menu has to be to be hit is a question
  about the person and not about the part, and it is written straight onto the
  box rather than through state - a re-render would rewrite the style
  attribute the fitting has just put its nudge into, and the panel would jump
  once per frame of the drag. The scale is last in the transform, so the nudge
  in front of it stays in plain window pixels and the fitting can go on
  measuring in them. The panel scrolls when it is taller than the canvas, so
  nothing may hang outside it that is not meant to be scrolled to: the grip's
  invisible hit pad grows inwards and upwards only, because six pixels of it
  past the bottom right corner put a scrollbar on a menu that fitted, and the
  height that bar took made the vertical one true as well.
- **A two-column menu draws a line where the second column begins.** A group
  is always four columns wide, so in the eight-column form every second one
  starts the fifth column - which is the only way to name that column at all,
  the widths being the contents'. The line is drawn on that cell and stretched
  to the row, so the only thing that breaks it is the gap between rows.
- **The other chips step aside, and they step aside from each other too.** The
  panel is placed from where its own chip belongs and never moves for anything;
  every chip is then walked once, the selected one first, and each takes the
  shortest way out along one axis that is both inside the canvas and clear of
  everything already placed - then joins the list of what is in the way. One
  axis, because a chip that goes round a corner reads as a chip that has
  wandered. Without the second half of that rule a chip that had dodged the
  panel landed on its neighbour, which is the same fault one step further on.
- **The open element stops clipping.** An element's own box draws its chips,
  and a box with `overflow: hidden` cuts the chip it has just pushed outwards
  in half. Only the element being worked on gets `overflow: visible`, so
  nothing else on the canvas gains the right to spill.
- **One invisible frame, not a margin at each place that places something.**
  The room anything floating may use is the seen rectangle drawn in a little,
  and the panel, the chips and the add buttons are all held inside that one
  rectangle - the panel clamped to it and capped in height by it, every chip
  pulled inside it whether or not anything else is in its way. A margin written
  out at three call sites is three chances to write a different one, and a
  control flush with the edge reads as clipped even when it is not: a rounded
  corner, a focus ring and the view's own scrollbar all live in those last few
  pixels.
- **Fitting once is not always enough.** Moving the panel can change what it is
  measured against - a row that reflows, a scrollbar that appears as the canvas
  grows - so the second reading lands a few pixels from the first, which is
  exactly the few pixels that show. It repeats while anything is still moving
  and gives up after a handful of frames rather than chasing something that
  will not settle.
- **What clips at zoom is the view, not the canvas.** Past fit-to-window the
  canvas is larger than the frame it scrolls inside, so the room a panel
  actually has is the canvas intersected with the view - and it is measured
  again on scroll.
- **A second press on the chip puts the panel away.** A press that turned into
  a drag moved the chip and is not a press - a chip writes no config, so the
  flag that means "already committed once" everywhere else here has to be set
  by hand for it, past a few pixels of slop, or the panel shuts every time the
  chip is put somewhere else. A plain second press on the chip that is already
  selected lets the part go. Without it the only way out of a
  ten-row panel was to take hold of something else.

## 11. The second kind is where the design is tested, the third is the proof

Everything above was written for one kind of element. Adding a second - a
surface, whose parts are a colour and a corner rather than a ring and a needle
- is what says whether any of it was a design or just an arrangement.

What survived unchanged: the frames, the chips, the numbers under a chip, the
zoom that belongs to the mode, letting go by pressing bare canvas. What turned
out to be about a gauge and not about a canvas was only three things - where
the config lives, which parts there are, and which editor holds their settings.
Those three are a registry entry (`INNER_KINDS`), and nothing else needed to
know a gauge from a surface.

**So write the second kind before believing the first one is general.** The
cost of finding out later is every call site that named the first kind out
loud.

The third kind - a bar - cost an entry, five `spot` parts and nothing else.
That is what the second kind was for.

Two smaller lessons came with it:

- **Not every part is on a ring.** A part that is told where to stand - a
  `spot` in per cent of the box - is the same offer, drawn from a different
  number, and pressing it is only ever taking it in hand. The needle was
  already that and had a special case of its own; naming the general thing
  retired the special case.
- **Can and is are different questions.** `on` says the part is switched on;
  `can` says the element is the sort of thing that has one at all. Running them
  together is how a bar drawn as a ring came to be offered a pill it can never
  draw - the offer is for a part that is off, and off is not the same as
  impossible. A part with no `can` is one every element of its kind can have,
  which is most of them.
- **A measurement is per kind, the sameness check is not.** A gauge
  letterboxes a viewBox inside its box, has text rects to follow and a needle
  that is still moving; a box is its own frame and holds still. Both answer
  the same record, and the part that decides whether to write it - which is
  the part that turns a measurement into a render loop if it is wrong - is
  written once.

## 12. Grips on the frame: the corners and the sides

A corner radius is set by a grip in a corner, and there are two of them, at the
bottom left and the top right, both writing the same number. **Which grip is
used is only ever a question of which is free** - whatever the element sits
next to, and whatever is drawn over it, one of the two can be reached. Two
grips for one value is not two controls for one value; two *different* controls
would be.

**Each grip lives on one edge and slides along it**, the way a DTP app or
Inkscape does it: the bottom-left grip runs along the bottom edge, the
top-right one down the right-hand side, and the distance it has travelled from
its corner *is* the radius. Nothing is pulled diagonally and nothing is
averaged - a grip that leaves its edge would be saying something the value
cannot express, so it never does. The invariant is in the tests, and
`gripHome` is the exact inverse of `radiusFromGrip`, in both units.

The rest of the arithmetic is worth stating because it is not obvious:

- **Pixels map to the screen one for one at any zoom.** The browser draws
  `border-radius: 8px` as eight screen pixels in a box the zoom has made twice
  as wide, so there is no zoom factor to divide by - and putting one in would
  be wrong. The px stop is half the *short* side, because that is where a
  radius stops growing.
- A percentage on `border-radius` is of the box's **own width across and its
  height down** - per axis, which is exactly the axis each grip runs along, so
  the percentage a grip reads is the percentage CSS will draw. The stop is 50%.
- `.el` is `overflow: hidden`, so a grip drawn astride the border would be
  sliced in half. Each is drawn *tangent* to its edge instead - the bottom one
  sits above the line, the right-hand one to the left of it - with a
  `::after` inset of a few pixels to make it worth aiming at.
- **A grip on the border needs room outside the border.** Entering inner edit
  fills the window, which for a gauge is only ever a way of making its parts
  bigger; for a kind whose controls stand on its own edge it would put them
  under the rim of the window, where a press that misses by a pixel takes hold
  of the view and pans it. `RIM_FILL` is the air that buys, and the kind asks
  for it simply by having corners.

### Bending the sides

Each side has a grip that bows it out into a barrel or in into a waist. Four
of them rather than one, because one control could not say a waist on the left
and a barrel on the right, and that is a shape people actually want. The same
rule as the corners: the grip stands on the crest of the *bent* side, so it is
always on the thing it moves.

It is the one handle here that travels on both axes. **Across** the side it
sets how deep the bow is; **along** it, where the crest of that bow sits
(`bend_<side>_at`, per cent in the direction the side runs, the middle by
default). A crest pushed towards a corner turns a barrel into a wave, a fin, a
leaf - and the cursor is `move`, because a one-axis cursor on a two-axis
handle is a lie.

- The outline is a **`clip-path: polygon()` of per cents**, not an SVG path.
  Per cents are read per axis against the box being clipped, so one string is
  the shape at every size the box is ever drawn at, needs no element in the
  document to point at, and costs nothing when the canvas is rescaled. Curves
  cost points instead, and points are cheap - eight segments a side puts the
  worst error under a third of a per cent of the box.
- **The corners are left where they are.** They are shared with the
  neighbouring side, and a corner that moved would tear the outline apart
  wherever two bends disagreed. So the bow is a parabola: nothing at either
  end, the full bend at the crest - which is also why reading a bend back
  off the grip needs no factor, and is an exact inverse.
- **The crest is a warp, not a second curve.** The same parabola is read
  through `u = t ** k`, with `k` chosen so `u` is a half where `t` is the
  crest. Two half-curves joined at the crest meet at an angle and the eye
  finds the join at once; a warp cannot. A crest in the middle gives `k = 1`
  and the plain parabola back, to the last digit - the clip path of every
  card written before sides could be dragged along is byte for byte what it
  was. What the warp does cost is sampling: eight even steps leave the steep
  short flank to two points, and eight even steps *up the bow* crowd them all
  into that flank and cut the long one off with a chord, so the points are
  the union of both sets.
- **Flat snaps, and it snaps in pixels.** A side that is straight and one
  bowed by a third of a per cent are different drawings and only one of them
  was meant, but a grip sitting on the side it sets gives no way of telling
  you are on it. Two pixels catch a hand that is already flat - in pixels
  because a hand is in pixels: read as a per cent of the box, the same rule
  gave a wide surface a six-pixel window on its sides and a two-pixel one on
  its top, so one box snapped differently depending on which edge you took
  hold of. The crest gets the same window round the middle, and a side let go
  flat has its crest put back there, because a bow of nothing has no crest.
- **The dashed frame follows the bow.** A clip path cannot be stroked, so a
  bent surface used to keep a straight dashed rectangle round it while its
  paint bowed out past it - and the rectangle is what the eye reads as the
  edge. The same polygon goes into an SVG over the same grown layer, and the
  box's own border is taken away while it is there. The SVG needs its width
  and height spelled out as well as its inset: it is a replaced element, so
  four offsets alone leave it at its intrinsic 1:1 size, which on a wide
  surface is a square outline hanging a long way below the thing it is meant
  to be drawn round.
- **A bow outward is the surface's edge**, so the editing zoom fits what the
  element *reaches* (`bentBox`) rather than what its box says - the bow being
  the very thing somebody zooming in on a bent surface has come to look at.
  Everything else - dragging, resizing, aligning - still works on the box.
- **A clip can only take paint away.** A side bowing outward has to have paint
  out there to keep, so the layer is grown by the room a bow may need and the
  path hands back all of it but the shape. Growing it is free because the path
  clips it straight back; what it costs is that the box has to stop clipping
  its own contents, so only a box that *actually* bows outward is asked to.
- Bending and rounding compose - both clip, and the result is the
  intersection - so a bent box can still have a corner radius.

## 13. The bench is not the work

A chip stands where its part is, which is right up to the moment the part it
names is underneath it. So a chip can be dragged anywhere on the element, and
it carries its own numbers with it.

**Where it was put is not config.** It is the bench the work is done on, not
the work, and writing it would put one person's arrangement of the editor into
everybody's dashboard. It lives beside the zoom - a module-level map, keyed by
the element and the part, gone with the tab - and a double-click puts the chip
back where its part says.

The same move took out an accident: a chip used to pass its press on to its
ring, so dragging one resized the thing it named. That is §2 again - a lever on
a part rather than the part - and the ring's own band was already the better
handle.

## 14. How to know it works

Not from the diff. Build it, drive the real component, and read the numbers
back:

- the value the gesture wrote, against the value intended;
- the rectangles, for every control, against the window - *is it reachable*;
- every panel against every other label, for collisions;
- both ways out of the mode, not just the button.

Every genuine bug in this work was found this way, and several would have read
as correct in the diff.
