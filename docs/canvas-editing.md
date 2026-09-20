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

And then say so at both ends. A fold that has quietly lost three of its five
rows reads as a fold that is missing something, and a panel on the drawing
that holds three rows of a menu says nothing about the eight still sitting
below it. `framed-fields.js` answers both from the same rule: `framedIn` tells
a fold which part took its rows and how many it has left, so the line standing
in for them can name the menu and know whether to say *the* settings or
*parts of the* settings; `menusFor` asks it from the drawing's side, naming
every fold a part came out of and what is left in each, so a panel points down
at the menus that have something to show and stays quiet when none has. Folds,
plural, and that is the part worth knowing: a needle takes its length from
*Shape & Position* and its material from *Pointer*, so a line that named only
the first would send someone to the fold without what they were looking for.
A note that says "this one is on the canvas" is true and useless: eight folds
down a dialog, what the reader needs is the name of the thing that moved.

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
- **Two handles on one ring must not share the ground.** The frame's two
  edges mean different things - the outside is the gauge's size, the inside
  is how wide the frame is drawn - and on a thin frame they are nearly the
  same circle. Two fat strokes of the same width then lay on top of one
  another, and because the inner one is drawn last it took every press: the
  outer edge, which is the only handle a gauge's size has, could not be
  grabbed at all. `hitZones` in `ring-grab.js` cuts the ground at the
  midpoint between two bands and gives each one its own side, so a hand
  coming from outside the gauge always finds the size and one coming from
  inside always finds the width. Where the frame's width is nothing and the
  two are one circle, the zones meet back to back rather than overlapping,
  and the edge named first - the outer one - keeps the outward side.
- **Write that width in the markup, not in the stylesheet.** A presentation
  attribute loses to any CSS rule, so a `stroke-width` in the rule silently
  puts every zone back to the same size. This was found by driving the real
  editor, not by reading the diff.

### Say which edge, in a word

A highlight is not enough when the two bands are a pixel apart: lighting one
of them up is not a difference an eye can read at that distance. So the edge
under the hand is named on the drawing - `gauge size`, `frame width` - in
white on a dark outline, standing just inside the band at the angle the hand
is at. Only a ring that has more than one edge names them; one band is the
ring, and a word for it would be a word on every drag.

The angle is kept as one of twelve sectors rather than as itself. The caption
has to stand near the hand, not follow it exactly, and a render per degree of
travel would be forty of them across one ring.

### The arrow points the way the drag goes

`ns-resize` on a ring is the truth at the top and the bottom of the circle and
nowhere else: at three o'clock a ring is dragged sideways. So the cursor is a
double-headed arrow lying along the radius, turned to wherever on the ring the
pointer is (`radialCursor`). It is written straight onto the element as the
pointer moves rather than through a render - it changes with every event and
nothing else about the drawing does - and it is memoised per sector, so a drag
right round a ring decodes eight images and no more. The drag keeps it
turning, because the element has the pointer captured and the moves keep
arriving.

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

What that costs is a selection frame by finger and the pinch, whose second
finger the browser may take for a two-finger scroll. Neither is gone, because
the two uses do not have to share a gesture - they share a switch instead.
`fingerDraws` gives the canvas its finger back (`touch-action: none` on the
pad and the canvas, the `.finger` class), and the page is then scrolled
beside the canvas rather than across it. It is drawn twice, in the tool row
above the canvas and in the tools below it, since a switch you have to scroll
to is no use to the scroll that is stuck, and it is drawn only on a device
with a coarse pointer, where `touch-action` decides anything at all. Like the
zoom it is the bench and not the card: module scope, never written to a
config.

This cannot be checked in a desktop browser with emulated touch: emulation
still sends mouse events, and a synthetic `TouchEvent` does not scroll
anything. It is checked on the iOS simulator, against a page that puts the
editor in a box that scrolls, and the test is the number: swipe over the empty
canvas and read `scrollTop` before and after, then drag a box and read its x/y.
With the old rule the first number does not move; with this one it does, and
the second still does when the finger starts on the box. The switch is the
same test once more with it pressed: `scrollTop` must then stand still, and a
frame must be drawn.

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
- **The text a part draws, typed in the part's own frame.** Not in the
  stepper grid - a field is wider than the four cells and the grid stops
  reading as a grid - but in the frame itself, where the words land. What a
  label says and how much room it has are one question, and answering it in a
  row of the form means reading the answer somewhere else. The pencil beside
  the frame's drop button opens it, Enter and Escape close it, and every
  keystroke is written straight through so the drawing answers as it is
  typed. Two things this needs: the field keeps the *last* frame the part was
  measured at, because a text cleared to be retyped is a text the card draws
  nothing for and the frame would vanish under the caret; and the value goes
  in as the `value` attribute rather than the `.value` property, or the render
  that each keystroke asks for puts the caret back at the end. A part says it
  has one with `text: '<the key>'`, and the form keeps the field as well -
  a card written by hand has no frames, and for a bar it is also the name the
  list is read by.
- **Not a free colour value, and no text that is not drawn.** An entity, an
  `rgba()` someone types out, a unit to substitute - those stay in the form:
  there is nothing on the drawing for them to be typed *into*.
- **A part is taken in hand by its name.** The four texts a gauge draws are
  the smallest marks on it - a scale label is a few pixels tall - and until
  the head of their frame became a handle the only way to take one was to hit
  the text itself. The head is already standing beside the thing it names and
  is the bigger target, so a press on it selects, and a drag from it moves the
  part with the pointer the way a press on the text does.
- **The middle axis.** A guide rather than a mark: a dashed line down the
  dial's own square, switched on beside the grid and the highlight, and only
  offered while a gauge's parts are open. A part dragged within a few screen
  pixels of it is taken by it - `snapToCentre`, and the tolerance is in
  pixels, not units, or the same number would be half the dial on a small
  gauge and nothing on a big one. Off by default, because a text nudged a hair
  off centre on purpose would have no way to stay there; and never while
  several parts are held, because a group that is being carried keeps its
  arrangement. The line goes solid while something sits on it, which is the
  whole of the feedback: what the hand wants to know is whether it took.
- **A ramp is a picture.** The catalogue of ready-made ramps is a strip of
  swatches under a chip, not a menu of names: *Fresh to stuffy* means nothing
  until the purple at the top has been seen, which is why the form has always
  drawn them. What a chip cannot take is the form's three-by-three grid - that
  is the panel rather than a row in it - so the same pictures lie in one strip
  that scrolls sideways, each with its name under it, because what a ramp is
  *for* is the one thing its colours do not say. `ramps` on a step; it reads
  nothing back, since a ramp is not a mode but a list of stops written into
  the row below.
- **A small editor, where it is what the part is.** A list edited by dragging
  its items about is not one control, so it was at first the one thing left in
  the form while everything around it moved. That did not hold: a gradient is
  what the thing it colours *is*, and a chip carrying the type, the ramp, the
  angle and the effect while the colours themselves sit five folds down is
  exactly the split these frames exist to end - and it is the split the rule
  below forbids. So the stop list goes under the chip wherever a part is
  coloured from one: a surface's paint, a gauge's ring, the disc a gauge
  is drawn on, and a bar's fill. It takes its unit with it, because a position
  read on the entity's scale and one read in per cent are the same number
  meaning two things - a bar has neither that question nor bands, so its row
  carries the list alone. `<sc-gradient-stops>` is the one editor rather than
  a second one
  (`stops` on a step, with `absolute` and `blocks` where the reading of a
  position is a question of the config), and the panel's size grip
  is what makes room for it - a panel at its default width is too narrow to
  drag a stop about in. Two things it needs: the panel is dark and the editor
  is the form's, so the host sets the half-dozen theme properties it reads;
  and a press inside it must not reach the canvas, which `stopPropagation`
  on the host does, shadow DOM retargeting doing the rest.
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
- **Each obstacle asks for the clearance it deserves.** Eight pixels for the
  panel and for the frame being worked on, two between one chip and the next.
  One figure for all of them was the first answer and it produced the very
  overlap it was written to stop: on a small element there is not eight
  pixels of room around four chips, a column of add buttons and a panel, so
  nothing came back clear, the least-overlap fallback took over and a chip
  ended up lying on an add button. A chip standing against a chip is untidy;
  a chip over the one press that adds a part is a fault.
- **What is being worked on is kept clear, frame or no frame.** A part with a
  frame is protected by the frame; one whose only mark is a ring - the ticks,
  the pointer - is protected by its measured box where it has one. The rings
  themselves have none and want none: a tick ring is spread over the whole
  circle, and a chip resting on one arc of it hides nothing that cannot be
  read somewhere else.
- **A frame is drawn only while its part is held.** The label, the value, the
  multiplier and the scale each have one, and four dashed boxes with four
  tinted fills over a gauge is a drawing nobody can judge any more. An unheld
  frame shows nothing but its head: no outline, no fill, no shadow, no grip.
  It is still all there to be taken hold of - the box keeps its size and the
  8 px its `::after` adds, so a part is held by pressing where it is drawn, and
  it shows itself the moment it is held. It stays an obstacle while bare, too:
  the outline is gone, but the text is still drawn in that box, and that is
  what a chip must not land on.
- **Frames are obstacles too, and a frame's head is a chip.** A part's frame is
  worked on the way the panel is read, so the chips give way to its drawing and
  to the field it is being typed into. Its head is not an obstacle but a chip
  of its own: it steps aside like the rest, and before them, because the parts
  drawn in a gauge's middle - the label, the value, the multiplier, the scale -
  are exactly the ones the steppers hang over, and a head under the panel is a
  bin and a pencil nobody can press. It may only go about its own height either
  way, or it stops reading as that frame's name.
- **A head goes round its own frame rather than onto it.** Its frame asks it
  for no clearance - a head sits against the thing it names on purpose - but
  the frame is still something not to be *on*. The panel hangs directly over
  the parts in a gauge's middle, so above the frame is exactly where the
  value's and the multiplier's heads have no room, and given the frame away
  entirely they were left lying on the drawing they name. A head may take any
  of its frame's other three sides instead, further than the cap allows and
  let through anyway: against its frame it still reads as that frame's, from
  whichever side.
- **Over the panel, for the chip that had nowhere to go.** Behind it is the
  better picture and stays the rule, but a chip that cannot be pressed is not a
  chip, so one still covered when everything else has been tried is raised
  above it instead.
- **The dodge is animated, nothing else is.** A chip's own place is `left`/
  `top` and a chip dragged by hand writes those; the stepping aside is a
  `transform`. Transitioning only the transform glides a chip out of the way
  and still lets a dragged one keep up with the finger. It takes 0.9s and is
  slowest at both ends, because a chip is getting out of the way of something
  the eye is already on and the movement has to be possible to ignore; at 160ms
  it read as a jump, and at 1.2s - tried on the toolbar for an afternoon - it
  was slow enough to watch.
- **One chip, and its buttons at the right end.** A ring's chip and a frame's
  head are the same surface: the name, then what the part reads (the pencil),
  then the way back out (the bin), in that order wherever a chip is drawn. The
  bin is last because it is the one press that pressing again does not undo,
  and it is a bin rather than a minus sign - a minus in a row of steppers reads
  as one fewer of something. The frame's two buttons used to be placed
  separately at its right corner, which on a wide frame put a part's name and
  the button acting on it half the drawing apart.
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

## 11a. A part there may be several of

Every part above is one of a kind: a gauge has one needle, one hub, one ring of
ticks, and each of them is a line in a table. A sector is not - a gauge has as
many as somebody has added, and they are a list in its config. That cost three
things and nothing else.

- **The table is read off the config.** `listed` on the kind answers the parts
  it has several of, keyed by index - `sector:0` - and `_innerTarget` merges
  that answer into the rings. The key is the only name such a part has, and the
  chip, the frame and the form's own fold are all keyed by it. The answer is
  memoised on the list itself, because a commit writes a new array and a new
  array is a new table; anything else is a fresh set of closures several times
  a render.
- **Where its settings live is the part's own business.** Every other part's
  rows read and write the element's config. A sector's read the entry in the
  list, and write a patch of the whole list. That is a `lens` on the part -
  one accessor, not a `read` and a `patch` on every row it has - and the
  panel, the steppers and the drags all go through it. `_writeInner` takes the
  part as its third argument for exactly this, and reads the colour-hold rule
  *before* the lens, because through one every patch is called `sectors`.
- **Taking one off renumbers the rest.** So `turnOff` may be a function of the
  config - a sector's answers the list without it - and nothing can stay in
  hand afterwards, whichever of them the button was on.

The offer is the other way round too. Every other `+` on the right-hand side is
for a part that is *off*; a gauge can always have another sector, so that
button is permanent and stands at the top of the column, solid rather than
dashed. It is `adds` on the kind, and the new part arrives in hand the way a
part switched on does.

**What a sector is dragged by** is five handles rather than one band: its two
arcs are the radii, its two ends are what stretch of the scale it covers, and
the band between them moves it round without changing either. The arcs are
drawn as arcs and not as circles - a full circle round a quarter-sector is a
frame round three quarters of nothing - and they share their hit zones through
the same `hitZones` two edges of a frame do, because a thin sector puts them a
pixel apart. The band is filled, takes presses and paints nothing, and is drawn
only for the sector in hand: a filled shape over a dial swallows every press
meant for what is under it.

**The fifth is the distance from the centre**, which is a radius like any
other and so is a dashed ring - drawn at the middle of the band and right
across the dial, because that is what the measure is about and the sector is
only the piece of it that is painted. It is grabbed *outside* the sector's own
span, where the ring runs over free ground: inside the span the band is what
the hand has hold of, and a hit stroke there would take the sideways gesture
away. Dragging it carries both radii together, so the band keeps its width and
stops at the centre rather than folding through it (`sectorReachPatch`).

A sector may hang ten per cent over either end of the scale (`SECTOR_OVERHANG`),
so one can be placed *against* an end rather than stopping short of it. The
form's own Start slider reaches the same distance, for the same reason.

**Travel round the dial is measured on the scale, not in degrees.** A
semicircle has ninety degrees below it that no value lives on, and a sector
dragged out into that dead space would otherwise count a third of the dial as
travel and come up the other side. `percentFromDeg` answers with the nearer end
out there, and the wrap from a hundred back to nought is allowed only where the
dial really does come full circle (`isRound`).

The arithmetic is `gauge-sector.js`, and it is the usual reason - a wrong
number there moves a band on somebody's dashboard, and it is pure, so it is
tested.

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

**Switched off at the moment.** `sides` on the surface kind is `false`, so no
side grip is drawn and none can be taken hold of - on the user's call, until
the shape is worth the four handles it costs. Nothing else changed: a card
that carries a bow is still drawn with it, `canvas-bend.js` is untouched, and
one word back to `true` brings the grips back. The rest of this section is
how they work when they are on.

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
