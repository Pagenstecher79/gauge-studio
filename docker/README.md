# A real Home Assistant to develop against

```bash
npm run ha          # build, register the card, start Home Assistant
```

Then open <http://localhost:8123> and finish the onboarding once (any account
— it lives only in `docker/config`, which is gitignored). The **Gauge Studio
Demo** dashboard appears in the sidebar.

Requires Docker. There is no other automated way to run the card in a real
Home Assistant.

## Why this exists

A page that instantiates `sc-gauge` and friends directly proves that the
markup and the committed config are what you expect. It cannot prove:

- that the card's **editor works inside Home Assistant's config dialog** — the
  editors receive `commitFn` as a Lit property binding through a nested
  render, which is not the same as setting the property from a script;
- that a commit **survives the round trip** through HA's storage and comes
  back as the editor expects;
- that **drag and drop** in the editors does what it looks like it does;
- what happens when an entity goes `unavailable`, or holds a state that is not
  a number at all;
- whether an animation is actually **smooth** with many elements reacting at
  once.

All of those show up here and only here.

## The loop

`npm run watch` in one terminal rebuilds `dist/` on every save. The container
serves `dist/` read-only at `/local/gauge-studio.js`, so a rebuilt file is live
immediately — but the browser has already cached the URL, so **hard-refresh**
(⌘⇧R / Ctrl-Shift-R) to pick it up.

`npm run ha` registers the resource under a URL carrying a hash of the bundle,
so a restart always serves the build you just made. Home Assistant caches
`/local/` for a month; at a fixed URL you would be testing last week's code
without any sign of it.

`npm run build` takes care of that itself: `postbuild.mjs` runs afterwards,
re-registers the URL and restarts the container, so a plain reload gets the
build you just made. It does nothing at all where there is nothing to do - no
`.storage` here (a fresh clone, and CI), the container not running, the bundle
byte for byte the one already registered, or `SKIP_HA_SYNC=1` - and it never
fails a build, because a build is also how the release workflow ships.

`npm run watch` does not get that: `vite build --watch` never exits, so npm's
`postbuild` never runs. That loop keeps the hard refresh above, and where the
service worker is stubborn, one `node docker/prepare.mjs` and a restart.

## What is in the instance

`config/configuration.yaml` defines numbers that **move**, because a still
instance shows no pointer physics, no bar easing and no threshold crossing:

| entity | behaviour | what it is for |
|---|---|---|
| `sensor.living_temperature`, `sensor.living_humidity`, `sensor.battery_level` | drift in small steps every 5 s | ordinary rendering, the case that must look smooth |
| `sensor.power_draw` | jumps to a random value every 3 s | easing and overshoot; a threshold crossed in one update |
| `sensor.energy_total` | only ever increases | the gauge's auto-range scaling (k / M / G) relabelling itself |
| `sensor.flaky_reading` | `unavailable` on demand | toggle `input_boolean.flaky_sensor_online` |
| `sensor.washer_status` | never numeric | proves the `safeFloat` fallbacks |

The **Controls** view has the switches: turn `input_boolean.value_generator`
off to freeze everything for a screenshot, or run *Dev: park every value at a
known figure* for a fixed starting point.

The **Stress** view holds eight gooey progress bars bound to the spiking
sensor. Run *Dev: stress the renderer* with the browser performance panel open
— many elements reacting in one frame is the case the card is slowest in, and
it is hard to reach by waiting. The frame budget is 1000/refresh-rate ms:
8.3 ms on a 120 Hz display, not 16.6.

## Commands

| | |
|---|---|
| `npm run ha` | build, register, start (foreground) |
| `npm run ha:logs` | follow the container log |
| `npm run ha:down` | stop the container, keep the instance |
| `npm run ha:reseed` | rewrite the demo dashboard from `config/gauge-studio-demo.yaml`, discarding UI edits |
| `npm run ha:reset` | wipe the instance — account, dashboards, recorder database. The next `npm run ha` starts at onboarding |

Your UI edits to the demo dashboard survive restarts; only `ha:reseed` and
`ha:reset` discard them.

## Notes

Port 8123 is published on **127.0.0.1 only**, on purpose: a plain `8123:8123`
would put an instance carrying whatever password you typed at onboarding onto
the LAN.

Everything Home Assistant writes lands in `docker/config` on the host, which
is gitignored except for the handful of yaml files this repo owns. So the
instance is inspectable from outside, and an HA upgrade that starts writing
some new directory cannot quietly land in a commit.

## Provenance

`docker-compose.yml`, `prepare.mjs` and `reset.mjs` are adapted from
[easy-floorplan](https://github.com/nicosandller/easy-floorplan) (MIT).
See [LICENSE](LICENSE). The configuration under `config/` is written for
Gauge Studio.
