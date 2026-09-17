# Gauge, Progressbar, Custom Card Studio (`gauge-studio-core`)
**Gauges and progress bars for your Home Assistant dashboard — built in the card editor, not in YAML.**

Gauge Studio puts custom gauges and progress bars onto a single card and lets you arrange them yourself. The gauges are SVG dials with pointer physics, thresholds, sectors and auto-scaling ranges; the progress bars come in linear and circular shapes with glassmorphism indicator pills. Around them you get a grid editor for placing elements, dynamic labels, animated backgrounds and per-element tap, hold and double-tap actions.

Everything is configured visually — no YAML required — and the card scales its contents to whatever space it is given, so one configuration works in a wide desktop column and in a narrow phone view alike.

---

## 🎬 See it running

One Home Assistant instance with live sensors, recorded as it runs. No mockups.

**A dashboard built from it** — gauges, instrument grids, progress bars and rings side by side.

![A dashboard built with the card](docs/media/dashboard-overview.gif)

**One gauge up close** — SVG dial, sub-ticks, threshold gradient, and a pointer with spring physics rather than a value that teleports.

![One gauge up close](docs/media/gauge-detail.gif)

**Progress bars, vertical and horizontal** — the same four entities twice, with glassmorphism indicator pills that carry the value.

![Progress bars in both orientations](docs/media/progress-bars.gif)

**The editor** — a sixteen-gauge canvas card being reshaped. Every change lands in the live preview on the right immediately; nothing here was typed as YAML.

![The card editor](docs/media/card-editor.gif)

### Screenshots

<img width="557" height="864" alt="Bildschirmfoto 2026-08-23 um 19 07 21" src="https://github.com/user-attachments/assets/eb839ac4-0531-4212-8273-637358f25e4c" />
<img width="549" height="517" alt="Bildschirmfoto 2026-08-23 um 19 06 20" src="https://github.com/user-attachments/assets/150cd720-31be-4260-b20d-7d24623c81c7" />
<img width="540" height="462" alt="Bildschirmfoto 2026-08-23 um 19 07 17" src="https://github.com/user-attachments/assets/ca1ab253-2c5b-4c02-9f4c-0ab286f8912d" />
<img width="557" height="295" alt="Bildschirmfoto 2026-08-23 um 19 06 55" src="https://github.com/user-attachments/assets/529a5314-0e0f-4e87-a2a2-d4300b287846" />
<img width="605" height="235" alt="Bildschirmfoto 2026-09-07 um 22 20 37" src="https://github.com/user-attachments/assets/ff90fde0-9f9c-45af-80ab-837066c23d03" />


---

## 📦 Installation

### Via HACS (recommended)

Gauge Studio is not in the default HACS store yet, so add it as a custom repository:

1. In Home Assistant, open **HACS**.
2. Click the **⋮** menu (top right) → **Custom repositories**.
3. Enter the repository URL `https://github.com/Pagenstecher79/gauge-studio`, choose type **Dashboard** (called **Lovelace** in older HACS versions), and click **Add**.
4. Search for **Gauge, Progressbar, Custom Card Studio** in HACS, open it, and click **Download**.
5. Reload your browser (a hard refresh clears the cached old version).

HACS registers the dashboard resource for you. If your dashboards are in YAML mode, add it manually instead:

```yaml
lovelace:
  resources:
    - url: /hacsfiles/gauge-studio/gauge-studio.js
      type: module
```

### Manual installation

1. Download `gauge-studio.js` from the [latest release](https://github.com/Pagenstecher79/gauge-studio/releases/latest).
2. Copy it to `config/www/gauge-studio/gauge-studio.js` in your Home Assistant configuration.
3. Add the resource under **Settings → Dashboards → ⋮ → Resources**:
   * URL: `/local/gauge-studio/gauge-studio.js`
   * Type: **JavaScript Module**
4. Reload your browser.

### Adding the card

Once installed, add a card to any dashboard and pick **Gauge, Progressbar, Custom Card Studio** from the card picker, or switch to the YAML editor and start with `type: custom:gauge-studio-core` (see the [configuration example](#️-configuration-example-yaml) below).

---

## 🌟 Key Features

* **Layered Render Pipeline (`Z-Index Hierarchy`)**:
  Separates background layers, grid overlay slots, static elements (icons/buttons), and dynamic elements (gauges, labels) cleanly without DOM overlay bugs.
* **Responsive Scaling Engine**:
  Uses `ResizeObserver` to automatically measure available component width/height and dynamically compute the scale factor (`--sc-scale`).
* **Modular Architecture**:
  Extensible architecture using `SupercardModules`. Built-in modules include:
  * **Core Editor & Global Entities**: Easily register alias entities and attributes, and set the card's shape, sizing and responsiveness.
  * **Interactions**: Per-element tap, hold and double-tap actions (`more-info`, `toggle`, `call-service`, `navigate`) with press-scale and rotation effects.
  * **Colour & Animation Engine**: Solid, gradient, vector fluid (Aurora, Gooey, Smoke, Particles), wave, ripple, and drop pulse effects.
  * **Interactive Layout Engine**: Modular multi-cell layout manager with fine-tuning, flexible aspect-ratio canvas, and responsive sizing.
  * **Progressbars**: Linear and circular (donut, speedo, half-circle) progress bars with glassmorphism/gooey indicator pills.
  * **Gauges**: Custom SVG full 360° / semi 270° dials with spring acceleration physics, dynamic thresholds, multi-stops, custom ticks, and sectors.
  * **Labels & Dynamic Containers**: Advanced custom label indicators with custom icons, alignment, conditional visibility, and custom formatting.

---

## 🧩 Architecture Overview

The card is a LitElement component. Modules register themselves on `window.SupercardModules` and contribute rendering, editor fields and CSS variables; the core initializes a container with structural layered rules (`Z-Index` configuration):

| Layer Level | Variable Constant | Description |
| :--- | :--- | :--- |
| **0** | `BG_NATIVE` | Main native card container base |
| **100** | `BG_STATIC` | Background pseudo-element layers (`::before`) |
| **500** | `LAYOUT_GRID` | Primary card structure & flex layout |
| **700** | `ELM_BASE` | Overlay base elements & SVG render targets |
| **800** | `ELM_STATIC` | Standard button overlays, icons, ticks |
| **900** | `ELM_DYNAMIC` | High-priority interactive/animated overlay elements |

---

## 🔧 Module Ecosystem

The plugin includes the following modules:

### 1. `core` Module
* **Primary Entity Handling**: Select a main entity and optional attribute to monitor state changes.
* **Global Alias Entities**: Add and manage arbitrary global entities (`global_entities`) referenced across gauges, progress bars, and colour conditions.
* **Shape & Sizing**: Toggle between `rectangle` and `pill` layouts, fine-tune `border-radius`, and manage responsiveness or fixed pixel/percentage dimensions.

### 2. `color` Module
* Render dynamic background overlays and colour animations.
* **Supported Modes**: Solid, Linear, Radial, Solid Gradient (calculated dynamically based on entity numerical states), and Vector Fluid.
* **Fluid Engine**: Renders inline animated SVGs using filter effects (`gooey`, `smoke`, `aurora`, `particles`).
* **Effects & Animations**: `pulse`, `pump` (the background alone), `pump_all`
  (the card or element itself, content included), `ripple`, `waves`,
  `wobble_radial`, `wobble_linear`, and `fluid`.

### 3. `progressbar` Module
* Renders highly customizable progress indicators into card slots.
* **Orientations**: Linear (Horizontal / Vertical) and Circular (Donut, Speedo, Half-circle).
* **Feature Highlights**: Advanced tick/subtick generators, glassmorphism indicator pills (Liquid, Gooey, Clean Frost, Lens), bounce easing, custom colour stops, and text rotation.

### 4. `layout` Module
* A fully interactive grid editor providing flexible multi-row and multi-cell structural placement.
* **Visual Canvas Editor**: Includes an inline trackpad canvas with grid-snapping capabilities to drag and resize elements directly.
* **Debug Mode**: Visualizes layout boundaries and element positions with real-time indicators.

### 5. `gauge` Module
* Scalable SVG gauge dials with interactive physical pointer physics (`spring`, `overshoot`, `elastic`).
* Supports custom sector fills, multi-stop threshold gradients, dynamic auto-range scaling ($k, M, G$), sub-ticks, and alert threshold pulsing.

### 6. `labels` Module
* Insert dynamic text elements, unit badges, or custom status pills inside any grid cell.
* **Conditional Visibility**: Show or hide labels based on active state matching (e.g., `on`, `open`, `home`).

---

## ⚙️ Configuration Example (YAML)

Below is an example of standard card configuration syntax in Home Assistant Lovelace UI:

```yaml
type: custom:gauge-studio-core
entity: sensor.living_room_temperature
gauge_studio:
  layout_shape: pill
  border_radius: 16
  card_height_responsive: true
  
  # Global Alias Entities for usage across modules
  global_entities:
    - id: ge_humidity
      alias: Humidity
      entity: sensor.living_room_humidity
      attribute: ""

  # Active Modules Configuration
  progressbar_active: true
  progressbars:
    - global_id: ge_humidity
      orientation: horizontal
      height: "12px"
      fill_color: "#03a9f4"
      show_indicator: true
      indicator_value: true
      indicator_glass_effect: glass_gooey

  gauge_active: false
  layout_active: false
```

---

## 📄 License

Gauge Studio is released under the [MIT License](LICENSE).

The development harness under [`docker/`](docker/) is adapted from
[easy-floorplan](https://github.com/nicosandller/easy-floorplan) and carries
its own MIT notice in [`docker/LICENSE`](docker/LICENSE).

The icons in the editor are [Lucide](https://lucide.dev), inlined into the
bundle. Lucide is ISC licensed and part of it is MIT; both notices are in
[`LICENSES/lucide.txt`](LICENSES/lucide.txt).
