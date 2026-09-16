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
- **Not a text field, not a free colour value.** A name, an entity, an
  `rgba()` someone types out - those stay in the form.
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

Each side has a grip on its middle that bows it out into a barrel or in into a
waist. Four of them rather than one, because one control could not say a waist
on the left and a barrel on the right, and that is a shape people actually
want. The same rule as the corners: the grip stands on the middle of the *bent*
side, so it is always on the thing it moves.

- The outline is a **`clip-path: polygon()` of per cents**, not an SVG path.
  Per cents are read per axis against the box being clipped, so one string is
  the shape at every size the box is ever drawn at, needs no element in the
  document to point at, and costs nothing when the canvas is rescaled. Curves
  cost points instead, and points are cheap - eight segments a side puts the
  worst error under a third of a per cent of the box.
- **The corners are left where they are.** They are shared with the
  neighbouring side, and a corner that moved would tear the outline apart
  wherever two bends disagreed. So the bow is a parabola: nothing at either
  end, the full bend in the middle - which is also why reading a bend back
  off the grip needs no factor, and is an exact inverse.
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
