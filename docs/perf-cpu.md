# Where the CPU goes

Measured 2026-09-13 against a real dashboard (24 cards, 73 gauges, 9
progress bars, ~24 800 DOM nodes, 20 glass panes in view) on a 120 Hz display,
Chrome 153, and against a synthetic reproducer on the Docker instance.

CPU numbers are `ps` process-time deltas over 10-14 s of an **idle** page -
nothing hovered, nothing scrolled, no interaction. "GPU" is Chrome's GPU
process, "renderer" the process for that tab. 100 % is one core.

## The measurements

| state of the page | GPU | renderer | total |
|---|---|---|---|
| as shipped | 63 % | 78 % | **141 %** |
| only the fx-glass repaint animation removed | 50 % | 10 % | **60 %** |
| every animation and transition disabled | 49 % | 12 % | 61 % |
| all cards hidden (`visibility: hidden`) | 14 % | 33 % | 47 % |

The second row is one line of CSS. It is worth ~80 points of a core, and it
gets nearly all of what disabling *every* animation gets.

## 1. The fx-glass "awake" animation

`supercard-07-fx-glass.js` gives every pattern's `::after` - the pane that
carries `backdrop-filter: blur(...)` - this:

```css
@keyframes sc-glass-awake-<id> { 0% { opacity: 0.99 } 100% { opacity: 1 } }
animation: sc-glass-awake-<id> 0.5s infinite alternate !important;
```

An invisible opacity nudge that exists only to keep the pane repainting. It
came in with the first upload and no commit explains it; the name says it was
meant to keep the backdrop from going stale.

On a backdrop-filtered layer, repainting means re-sampling and re-blurring the
backdrop - the most expensive thing on the page - and `infinite` means every
frame, 120 times a second, for every pattern on the card, forever, whether or
not anything under the glass has changed.

### The fix: nudge on render, not on every frame

The pane only needs a repaint when what is behind it changed - and the card
already knows when that is, because that is when it re-renders. fx-glass now
implements `onAfterRender`, which flips a class on the card host, and the
generated CSS moves the pane's opacity by a thousandth on that class. One
repaint per change; an idle dashboard costs nothing.

Verified on the reproducer: with the animation gone, four glassed gauges show
exactly the same needle as the four unglassed ones beside them after a value
change (`blur: 0.5` so the backdrop is legible), and the bevel, ring and
frosted interior are unchanged.

**`steps(1)` does not help.** Measured on the reproducer: `on` 60 % GPU,
`steps(1)` 60 %, removed 50 %. The compositor keeps the layer live either way,
so the fix has to be removal, with the repaint driven by the change that needs
it if one turns out to be needed at all.

**Is it needed?** In the reproducer, no: with the animation gone, four glassed
gauges track their value exactly like the twelve unglassed ones beside them
(same needle, same arc, `blur: 0.5` so the backdrop is legible). The case the
author hit is not recorded, and may be another engine - verify on iOS/Safari
before removing it for good.

## 2. Box-shadows inside the progress bars

Forcing a full repaint of the viewport and measuring the frame interval
(120 Hz display, so 8.3 ms is the floor):

| | frame |
|---|---|
| as shipped | 33.3 ms |
| the 8 visible progress bars hidden | 9.0 ms |
| the 20 visible gauges hidden | 25.0 ms |
| both hidden | 8.3 ms |
| every `box-shadow` inside the bars off | 16.7 ms |
| only the 60 `sc-seg-inner` shadows off | 17.6 ms |
| only the 7 eleven-layer shadows off | 25.1 ms |
| every `filter: url(#...)` off (65 of them) | 33.3 ms - no change |

So a repaint of eight bars costs ~24 ms, and almost all of it is box-shadow:
~16 ms for the segment shadows (60 segments, 3 to 5 shadow layers each - glow
plus relief) and ~8 ms for seven elements carrying *eleven* shadow layers.
The SVG filters cost nothing measurable; `backdrop-filter` costs nothing when
it is not being animated.

This is what makes scrolling expensive, and it is why the glass animation above
was so costly on this dashboard in particular.

## 3. What an animating card costs

Twelve bars on a canvas, two value changes a second, sensor driven from the
page (reproducer view `perfbars`):

| | GPU | renderer |
|---|---|---|
| 6 segmented circular + 6 gradient linear | 140 % | 50 % |
| only the 6 gradient linear (segmented hidden) | 20 % | 40 % |
| only the 6 segmented circular | 140 % | 50 % |
| the same 6 segmented, segment `box-shadow` off | 80 % | 40 % |

So the animation that costs is the **segmented circular bar**: ~20 % of a core
each while moving, and nearly half of that is the segments' box-shadows -
the same shadows that make a static repaint expensive in §2. Linear and
gradient bars are cheap.

### Frames that draw the same picture

`_animatePct` writes `_displayPct` - reactive state - on every frame, so the
whole component re-renders 120 times a second while a value moves. Twelve bars
at two changes a second: **1 049 component renders a second**.

A bar cannot show more than it can draw: a segmented ring lights whole
segments, a counting value shows so many decimals, a fill edge lands on a
whole pixel. Skipping the writes between those steps takes it to **615/s**.

Honest result: **that did not move the CPU** (140 %/50 % either way), and
neither did capping those writes at 30 a second (259 renders/s, same CPU). The
cost of an animating bar is paint, not JavaScript. Both are kept because they
are provably invisible work - 790 component renders a second of it - which will
matter where the main thread is the bottleneck, but neither is the fix for the
CPU number and neither should be sold as one.

### What it really was: the fade under the sweep

Every `.sc-seg-inner` carried `transition: background 150ms ease, box-shadow
150ms ease`. So each segment that lights does not just change colour - it
animates for 150 ms, and it does that while carrying two blurred halos. During
a sweep segments light continuously, so there is always a transition running,
and the ring repaints at the display's full rate no matter how few writes the
JavaScript makes. That is why neither of the two changes above moved anything.

Six rings, two value changes a second:

| | GPU | renderer |
|---|---|---|
| as shipped | 140-150 % | 40-50 % |
| glow off (transitions still on) | 90 % | 40 % |
| glow at half radius | 140 % | 40 % |
| glow only on the three leading segments | 150 % | 50 % |
| `background` transition only, no `box-shadow` | 120 % | 30 % |
| **no per-segment transition** | **30 %** | **20 %** |

The radius does not matter and the number of glowing segments does not matter,
because the segments that repaint are the ones at the edge of the sweep - and
those are lit in every variant. What matters is whether they are *transitioning*.

**The fix**: the fade is what a segment does when it lights on its own. While
the ring is sweeping, the sequence of segments *is* the motion, and the fade is
a second animation laid over it that nobody can pick out. `_animatePct` sets
`data-sweeping` on the host for the duration, and `:host([data-sweeping])`
drops the transition. Measured on the same twelve bars: **150 % / 40 % ->
40 % / 20 %**. The glow, the colours and the sweep itself are untouched.

## 4. What the glass costs when nothing happens

With the repaint animation gone the GPU process still sat at 50 %, against 10 %
with the glass CSS removed. Measured with the cards **frozen** - `shouldUpdate`
forced to `false`, zero renders, zero running animations, a completely static
page:

| | GPU |
|---|---|
| 16 glass panes | 50 % |
| 8 panes | 30 % |
| 4 panes | 10 % (the floor) |
| 16 panes, `backdrop-filter` removed, everything else kept | 10 % |
| 16 panes, `backdrop-filter: blur(0px)` | 30 % |
| 16 panes, `will-change: auto` forced everywhere | 50 % |
| 16 panes, `translateZ(0)` removed | 50 % |
| 16 panes, masks removed | 50 % |

So it is not the layer hints, not the compositing hacks and not the masks:
**a pane carrying `backdrop-filter` costs the GPU about 2.5 % of a core for as
long as it is on screen, even when the page is frozen.** Twenty panes on a
dashboard is half a core, permanently, for a static picture. That matches the
real dashboard exactly: 20 panes in view, 50 % GPU with every animation off.

A zero blur costs nearly the same as a real one - the property, not the radius,
is what puts the pane on the expensive path.

**The fix**: write `backdrop-filter` only when it shows. A blur of zero is the
property at full price for no picture, and behind a pane that is fully opaque
there is nothing to see blurred. Both are now gated.

What is left is a real cost for a real effect, and it is worth saying plainly
in the editor: every glass pattern on screen costs the GPU whether or not
anything moves, so twenty of them is a different dashboard from four.

## The reproducer

Docker instance, dashboard `gauge-studio-demo`, view `perf`: five cards of sixteen
gauges, four glass patterns each (`elm_gauge_N`). Build carries a temporary
switch - `window.SC_AWAKE = 'on' | 'stepped' | 'off'`, then re-render the cards
- so the three variants can be measured in one build. It is a measuring
instrument, not a setting, and goes away with the fix.

Find the renderer process for a tab by burning 8 s of CPU in it from the
console and diffing `ps -o pid,time` around it; the GPU process is the plain
`Google Chrome Helper`.

## Renders per entity change (gauge level)

The card's `shouldUpdate` already filtered on the entities it draws from, but
below it every `sc-gauge` on the card re-rendered whenever the card did. On a
card with sixteen gauges bound to sixteen different entities, one state change
cost sixteen renders and fifteen of them had nothing to redraw.

`hassInputsChanged(oldHass, newHass, ids)` now lives in core and both levels
use it; `sc-gauge._inputIds()` caches the ids it watches against the identity
of `config`/`globalEntities`.

Measured on a mirror of the stress page - 5 cards, 80 gauges, entities spread
round robin over 28 sensors, 20 s windows, same card update rate:

| | card updates / 20 s | gauge updates / 20 s |
|---|---|---|
| before | 55 | 880 |
| after  | 52 | 119 |

A first attempt measured nothing at all, because every gauge on that page was
bound to the *same* sensor - there the sixteen renders were all genuinely
needed. Spreading the entities is what made the difference visible; a page
where one entity drives everything cannot show this defect.

## DOM nodes: one path per colour, not per subdivision

94 % of the nodes on the stress page were `<path>` elements inside `.g-ring`.
The ring is drawn by subdividing the arc - `auto` resolution gives 306 steps
for a full circle - and each step was emitted as its own path even when it
carried the same stroke as its neighbour. Runs of equal colour are now one arc
(split into half circles, since a single 360 degree arc starts and ends on the
same point and draws nothing).

Verified identical, not eyeballed: 336 gauges covering every gauge type,
gradient preset, gradient mode and resolution, each ring sampled at 1440 angles
for stroke colour, radius and width. All 312 rings hash identically before and
after; ring paths 95,172 -> 48,642.

On the stress page: 26,025 -> 19,145 nodes, and a forced re-render of all 80
gauges 11.6 ms -> 10.2 ms.

What is left is not waste: a smooth gradient really does carry ~220 distinct
colours over its 306 steps, so run merging cannot go below that. Getting a ring
down to a single node needs a different mechanism - a CSS `conic-gradient` in a
`foreignObject`, masked to the ring - which is a rewrite of ring rendering, not
a tweak.

### One node per ring

Merging runs still leaves one path per colour, and a smooth gradient has
hundreds. SVG has no angular gradient, so the ring is now a CSS
`conic-gradient` painted into a `foreignObject` and masked by a single stroked
arc - the same arc the paths described, at the same radius, width and sweep.
Every band the paths drew flat stays flat, as a pair of gradient stops sharing
an angle, so a coarse resolution keeps its banding and a fine one keeps its
ramp. A ring of one colour is still one stroked arc: there is nothing to
interpolate and a gradient would only cost a mask.

The comparison: 364 gauges over both gauge types, six start angles, four
gradient presets, both gradient modes, all seven resolutions, and varying
stroke widths and scales. Every one of the 109,346 bands the old build drew was
sampled at its midpoint and compared against the colour the gradient puts
there, alongside the mask's radius, stroke width, start angle and sweep.

    nodes            113,972 -> 6,446
    bands differing  0 of 109,346
    max channel delta 0

On the stress page, against the build before this work started:

    nodes                        26,025 -> 1,942
    re-render of all 80 gauges   11.6 ms -> 5.5 ms
    long tasks                   10.6 ms/s -> 4.6 ms/s
    renderer cpu                 ~19 % -> ~14 %

The GPU process refused to give a usable number - repeated 20 s samples of the
same build ranged from 6 % to 28 % - so nothing is claimed about it.

The gradient is non-interactive (`pointer-events: none`): a foreignObject
covers the whole box even where the mask hides it, and taps belong to the card.

## Where the renderer time actually goes

Measured on a real dashboard - 24 cards, 73 gauges, 9 bars, 24,776 nodes - by
hiding one thing at a time (`content-visibility: hidden`, or a stylesheet
injected into the shadow root) and sampling the tab's renderer process and the
GPU process for 20 s each, with a control sample between every probe. Controls
drifted between 88 % and 97 %, so only differences against an adjacent control
mean anything.

| what was switched off | renderer | gpu |
|---|---|---|
| nothing (control) | 88-97 % | 61-65 % |
| the needle's transform transition | **20 %** | 64 % |
| the gauges entirely | 20 % | 57 % |
| the bars entirely | 76 % | **35 %** |
| backdrop-filter inside the bars | 86 % | 54 % |
| every filter inside the bars | 92 % | 53 % |

Two separate stories.

**The gauges own the renderer, and it is entirely the needle.** Switching off
the transform transition costs exactly as much as deleting all 73 gauges - 20 %
either way. The card's own JavaScript is not involved: an instrumented
requestAnimationFrame accounted for 1.4 ms per second across the whole page.
An SVG transform is not composited, so each of the ~26 needles in flight at any
moment repaints its gauge on the main thread, every frame, at 120 Hz.

Two fixes that do not work, both measured: `will-change: transform` on the
needle group made it worse (89 % -> 94 %), and driving the rotation through the
Web Animations API instead of a CSS transition did not get it composited either
- 73 needles animating that way cost 150 %.

What does work is taking the needle out of the SVG. 73 HTML elements, absolutely
positioned over the gauges and rotated by a CSS animation, run continuously for
**21 %** - against 150 % for the same 73 inside the SVG, and 89 % for the 26
that animate naturally there. An HTML transform is composited; an SVG one is
not.

**The bars own the GPU.** Hiding the nine of them takes the GPU from 61 % to
35 %, and leaves the renderer where it was. Roughly a third of that is
`backdrop-filter` (three panes, ~3 points each, in line with the earlier
measurement of ~2.5 % per pane) and roughly a third is the SVG filters. The
remainder, and the bars' share of the renderer, still needs its own pass.

### What the needle rebuild actually bought

Measured on the same dashboard, alternating between the installed v1.12.0 and a
build with the needle in its own HTML layers, 30 s per sample:

| | renderer | gpu |
|---|---|---|
| v1.12.0 | 75.3 %, 79.0 % | 61.9 %, 62.2 % |
| needle in HTML layers | 52.0 %, 49.5 % | 34.6 %, 32.7 % |

Nodes on that page fall from 24,776 to 8,983.

It is a real and repeatable win, and it is **half** of what the ablation
predicted. Freezing the needle in the new build still drops the renderer from
49.5 % to 15.7 %, so the moving needle still costs some 34 points even out in
the HTML flow - against the one point the bare-div probe cost. Four guesses at
why, all measured and all wrong:

| probe | renderer |
|---|---|
| new build, needles moving | 49.5 % |
| pointer shadows hidden | 50.7 % |
| one rotating layer per gauge instead of two | 53.6 % |
| overflow: hidden on the layers | 62.9 % |
| will-change: transform on the layers | 84.0 % |

So it is neither the shadow's SVG filter, nor the number of rotating layers,
nor the unbounded paint area, and asking for promotion outright makes it far
worse. The difference from the probe that cost nothing is that these layers are
SVG elements the size of the whole gauge, stacked over the gauge's own SVG,
where the probe was a small opaque div. That is where the next pass starts.

### The rotation has to be on a div, not on the svg

Moving the needle out of the gauge's SVG was only half the win because the
rotation was still applied to an outer `<svg>` element. Wrapping each layer in
a plain `<div>` and rotating that instead - the svg inside unchanged - is what
the bare-div probe was really measuring.

On a page built for this - 72 gauges on four sensors that change every second,
with a 3 s needle animation, so the needles are in flight essentially all the
time:

| build | renderer, needles moving | needles frozen | the needle's share |
|---|---|---|---|
| rotation on the svg | 25.9 %, 29.6 % | 5.0 % | ~23 |
| rotation on a div | 11.0 %, 15.0 % | 4.8 % | ~8 |

Same picture either way: 144 gauges across both gauge types, both pointer
shapes, the 3d effect, all three shadow modes, offset pivots and two scales,
3,696 geometry points, square box and one forced to 118x57 - **zero**
difference, not a fraction of a per mille.

### On the dashboard that started this

Alternating against the installed v1.12.0, 30 s a sample, the browser window
kept in front:

| | renderer | gpu |
|---|---|---|
| v1.12.0 | 74.6 %, 86.1 % | 60.7 %, 64.6 % |
| rotation on a div | 22.6 %, 27.4 % | 36.8 %, 36.8 % |

Nodes 24,767 -> 9,252.

Hiding every card on that page leaves the renderer at 25.2 % and the GPU
at 6.8 %. The renderer figure is now the dashboard's own - the card's share of
the main thread has gone from about fifty points to nothing measurable. What is
left is GPU, about 30 points of it, and it splits roughly evenly:

| | gpu |
|---|---|
| everything (new build) | 36.8 % |
| bars hidden | 25.4 % |
| gauges hidden | 25.8 % |
| every card hidden | 6.8 % |
| needles frozen, everything else as is | 35.8 % |

The needle's motion costs one GPU point, so moving it to the compositor did not
just relocate the bill. The bars' eleven points are no longer the backdrop
filter either - switching that off now changes nothing (36.4 %), and switching
off every filter in them buys three points. Both halves are static painting,
which is where the next pass goes.
## The bars: it is the frame rate, not the property

Measured on a page of 36 bars built to match a real one - vertical, gradient as
solid, eleven ticks, a glass indicator pill, a 3 s animation - on a 120 Hz
display. The bars alone: renderer 17 %, GPU 63-71 %.

| what was switched off | gpu |
|---|---|
| nothing | 63.3 %, 70.6 % |
| the liquid layer | 65.1 % |
| every transition and animation in the bars | 16.1 % |
| every transition (animations kept) | 15.5 % |
| all transitions except clip-path | 69.0 % |
| the bars entirely | 9.0 % |

So the bars' whole GPU cost is the fill's `clip-path` transition. The obvious
conclusion - clip-path is not a composited property, use transform - is wrong,
and the probes say so:

| 36 fills animated continuously with | gpu |
|---|---|
| transform (clip-path still applied) | 54.1 % |
| transform, clip-path removed | 54.7 % |
| opacity | 50.7 % |
| opacity, on 9 of the 36 bars | 43.8 % |

A composited property is barely cheaper, and a quarter of the bars costs nearly
as much as all of them. What actually decides it is how often the page
composites. Driving the same clip-path from JavaScript, changing only the rate:

| | gpu |
|---|---|
| 120 fps | 61.8 % |
| 30 fps | 34.3 % |
| not animating | 15.5 % |

Against a floor of 15.5, that is 46 points at 120 fps and 19 at 30. A bar
crawling to a new value over three seconds does not need a fresh frame every
8 ms, and nobody can see the difference - but a CSS transition always runs at
display rate, so the cap the rAF path already has (`SC_ANIM_FPS_CAP`) never
applies to it. Everything that moves in a bar moves by CSS transition:
`clip-path` for the fill and the overlay, `left`/`bottom` for the indicator
line, the pill and the floating value, `stroke-dasharray` for the circle.

Moving those onto the capped rAF path is the fix the numbers point at. It also
means reproducing `--pb-bounce-ease` in JavaScript, which is why it is a
separate piece of work rather than a tweak.

### Everything a bar moves now moves on the capped loop

The bar already had a frame loop with a 30 fps cap (`_animatePct`), but it only
drove the colour sampling - the fill, the indicator line, the pill, the
floating value and the circle's dash all moved by CSS transition, which runs at
the display's rate no matter what. They now read the same frame value the loop
produces, and carry no transition of their own. Keeping them on separate clocks
was not an option: a pill at 120 fps beside a fill at 30 would visibly lead it.

The loop's easing had to grow up for that. It was a fixed cubic bezier while
CSS got the user's bounce curve, so the two disagreed; both now come from the
same function, and `getBounceEase`, `--pb-anim-dur` and `--pb-bounce-ease` are
gone with their last reader.

On the 36-bar page, alternating builds:

    before   GPU 63.3 %, 70.6 %, 66.6 %
    after    GPU 23.4 %, 33.9 %, 42.8 %
    floor     GPU 9.0 %

Roughly halved, with the spread the GPU process always has here.

The motion survives at the granularity a screen can show it: a 10 % move on a
46 px bar draws 13 distinct states, about one per third of a pixel. Smaller
moves draw fewer - a 1 % change on that bar is six tenths of a pixel and draws
two - which is the step filter doing its job, not the animation failing.

## The whole stack, on the dashboard that started this

The 24-card dashboard (73 gauges, 9 bars) had never run anything newer than the
released build, so this round compares that build against the branch with all
four changes in it - gauge `shouldUpdate`, the merged colour runs, the conic
ring, the needle on HTML layers, and the bars on the capped frame loop.
Alternating the Lovelace resource between the two, 30 s samples:

    v1.12.0      renderer 83.3 %   GPU 58.1 %   24 776 nodes
    branch       renderer 22.2 %   GPU 18.4 %    9 243 nodes
    v1.12.0      renderer 78.0 %   GPU 57.7 %   24 776 nodes

The GPU figure is the one the bar change was aimed at, and it is the first time
it has come down on this dashboard: the earlier rounds moved the renderer and
left the GPU at 37 %. Both processes now sit near the floor this page has with
every card hidden.

## What a glass pointer would cost

Backlog 34 asks for glass FX on the pointer and the centre point. The card
already knows that a lens is nearly free on a pane (see CLAUDE.md), but a pane
holds still and a needle does not, so the answer had to be measured rather
than carried over.

Measured 2026-09-20 on `.claude/bench/pointer-glass.html` - a grid of dials
with a real backdrop (conic ring, ticks, numbers, value) and the needle on its
own layer, turned by a compositor transform, exactly as `sc-gauge` does it.
Chrome, 120 Hz, so the budget is 8.3 ms. `lens` is the `dome` profile at the
editor's maximum refraction, `blur` is `blur(3px)`, `both` is the two
stacked, and the figures are fps and p99 over a 5 s sample after an 800 ms
warm-up, with the needles turning continuously.

| gauges | plain | lens | blur | both |
|---|---|---|---|---|
| 16 | 120.0 / 9.1 | 120.0 / 9.3 | 120.0 / 9.3 | 120.0 / 9.3 |
| 24 | - | 120.0 / 9.1 | - | - |
| 32 | - | 119.2 / 9.3 | 95.4 / 17.5 | 70.9 / 24.9 |
| 64 | 120.0 / 9.1 | 91.8 / 17.3 | 70.5 / 17.5 | 64.7 / 25.1 |

### The cost is the movement, not the glass

The same page with the needles parked, 64 gauges:

| | plain | lens | both |
|---|---|---|---|
| still | 120.0 / 9.3 | 120.0 / 9.4 | 119.8 / 9.4 |

A glassed needle that does not move costs nothing at any count measured; the
same needle turning costs a third of the frame rate at 64. That is the whole
finding, and it follows from what the layers are for: a needle is on its own
layer so that its rotation is a compositor transform and the dial beneath it
never repaints. A `backdrop-filter` takes that away - the layer has to re-read
and re-filter the dial under it at every angle it passes through.

The centre point is the same element without the movement, and it measures
that way: glass on the hub alone, with the needle plain and turning, is
120.0 / 9.3 at 64 gauges. **The hub can have glass for nothing.**

### Which half to spend

The blur is the expensive half and breaks first - 32 gauges already cost a
quarter of the frame rate. The lens alone holds to 24 and is still within
budget at 32. Stacked they are worse than either, which is the rule the pane
already follows: **never blur and bend the same moving part.**

So a glass pointer is affordable on the dashboards people actually build - a
card of 16 gauges is free, and a needle only turns while a value change
animates, not continuously as this page turns it. It stops being affordable on
a wall panel showing dozens of instruments at once, which is where this card
is often pointed.

### What it buys, which is less than it costs

The refraction is a share of the pane's shorter side, capped at 12 %. A needle
is thin by nature: at 5 cqmin on a 190 px gauge it is 9.5 px wide, so the rim
bends the backdrop by about one pixel. What reads as glass on the needle in
the bench is the translucency and the rim highlight, not the bend - and those
two are free, being nothing but a background and a `box-shadow`.

That is the shape of the answer: **the cheap parts are the ones that carry the
look**. A translucent needle with a lit rim, glass on the hub where it costs
nothing, and the lens as a second effect that has to be asked for.

The one pixel in the paragraph above is not the needle's fault, and the rule
it produced has since been withdrawn. The lens used to be offered only above
four units of width, because 12 % of a thin needle is half a pixel. That
share came from the pill, which is a slab: a wide pane, flat in the middle,
bevelled in a narrow band at the edge. A needle is a rod, curved across its
whole width, and a rod displaces a far larger share of itself. At
`POINTER_LENS_FRACTION` a needle of two units - the default, a fine one -
shifts its backdrop by 3.2 px on a 280 px gauge, measured. So the gate is
gone and the share is right, which costs no more per frame than the wrong
share did: one displacement pass either way.

## What the refractive index costs

The index (`ior`, *Refractive index (n)* under Optics) does two things to the
lens: the whole body of the pane bends, not only its rim, and the three
colours are displaced by slightly different amounts so the edge splits into a
warm and a cold fringe. The first is free - it changes the numbers in the
64x64 map and nothing else. The second is not: one `feDisplacementMap`
becomes three, each followed by an `feColorMatrix`, with two `feComposite`s
to add them back together. Eight primitives over the oversized filter region
instead of one.

Measured 2026-09-21 on `.claude/bench/ior-bench.html` - a grid of panes with
`backdrop-filter` over a moving high-contrast backdrop, at the editor's
maximum refraction. Chrome, 120 Hz, 1024x768 at dpr 2, fps and p99 over a 5 s
sample after a 900 ms warm-up. `edge` is n = 1, one pass; `ior` is n = 2,
three passes; `both` is n = 2 with `blur(4px)` stacked on it.

| panes | off | edge (1 pass) | ior 2 (3 passes) | blur | both |
|---|---|---|---|---|---|
| 16 | 120.0 / 10.2 | 120.0 / 10.1 | 120.0 / 9.9 | - | - |
| 64 | - | 120.0 / 10.0 | 120.0 / 9.7 | 120.0 / 10.3 | - |
| 128 | - | - | 120.0 / 10.0 | - | 120.0 / 9.8 |
| 256 | - | 119.8 / 9.8 | 60.0 / 17.8 | - | - |

**Up to 128 panes the index is free, and past that it is the whole cost.** At
256 the single pass is still at the refresh rate and the three passes have
halved to a hard vsync-locked 60 - the frame no longer fits in 8.3 ms, so
every frame waits for the next one. That is three times the filter work
arriving all at once, which is what eight primitives instead of one buys.

Two things follow. A dashboard of a dozen or two glass panes pays nothing for
the index, which is every dashboard anybody builds - the break is at a pane
count nothing real reaches. And the cliff, when it comes, is a cliff and not
a slope, because the frame rate is locked to the refresh: 128 panes cost
nothing and 256 cost half the frame rate. So the index is offered as a
setting rather than spent by default, and at n = 1, which is the default, the
filter is the single-primitive one this module always wrote, byte for byte.

Stacking the index on a blur is the exception to the pane's usual rule -
`both` at 128 measures the same as the index alone. The blur is gated on an
opaque pane and the lens with it, so the two never run where neither shows;
where they do both run, at the counts people build, neither is the
bottleneck.

### The same index on the smaller glass

The index is offered on every part that already carries a displacement map,
which is four: the glass pane, the needle, the centre point and the
indicator pill. Each defaults to n = 1, the single pass, so nothing a saved
card draws changes until somebody asks.

What differs between them is not the filter - it is the same three passes -
but what the part does per frame:

- **The centre point** stands still. Three passes over a backdrop that does
  not move are paid once, which is the same reason its blur is offered with
  no gate and no warning.
- **The needle** turns, so the passes are paid every frame it moves. Its
  control says so; the guidance is to leave it at 1 on a card with many
  gauges.
- **The pill** is the expensive one, and it was measured before this existed:
  64 pills animating at once held 119 fps on one pass and fell to 53 on
  three, with 51 dropped frames. That measurement is why the pill's colour
  fringe is *painted* by default - see `pill-glass.js` - and the index is the
  way to ask for the real one anyway, on the few large pills where it reads.

The pane's own numbers above do not carry over to the pill, and the
difference is not a contradiction: a pane is sampled once per change, a pill
is sampled every frame it moves.

**And only while it moves.** The bar has no endless animation and no CSS
transition on its position - the fill follows a capped frame loop that ends
when the value is reached, at which point the pill stands still over a
backdrop that stands still, and a `backdrop-filter` over an unchanged
backdrop is not re-evaluated. So the 53 fps is a dip of about a second per
reading, not a standing load.

What does make it standing is a backdrop that never settles, and there are
two ways to build one, both of them ordinary choices rather than mistakes:
an animated colour pattern on the fill underneath the pill, and a
translucent bar over an animated card background, where what shows through
the pill is the card and the card is moving. In both the pill re-samples
every frame for as long as the dashboard is open, whether the value changes
or not. The pill's own control says so; there is nothing to gate here,
because the card cannot tell a backdrop that is worth bending from one that
is not.
