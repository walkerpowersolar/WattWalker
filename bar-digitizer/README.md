# Usage Reader (standalone bar-chart digitizer)

A zero-dependency, pixel-based reader for electric-bill usage graphs. Add a photo
or screenshot of the bill's bar chart and it returns the value of each monthly
bar (kWh), totaled and laid out Jan–Dec.

This is the **accuracy sandbox**. Once detection is dialed in, the core logic in
`detector.js` ports straight into WattWalker's `PlotDigitizer` component.

## Design goal: works on a phone with almost no taps

Most people use this on their phone, so the flow is:

1. **Add the graph** — take a photo or choose an image.
2. **Bar color** — leave on **Auto** (works for orange, blue, or black bars). If a
   bar is a faint/pale color, tap **"Tap the bar"** and then tap a bar. (Selecting
   "Tap the bar" arms the eyedropper in one step — no separate "pick color" action.)
3. **Detect Usage** — one button. The app:
   - finds the **chart area** itself (no crop box to drag),
   - reads the **largest Y-axis number** and the **first month** on the X axis (AI),
   - locates the **baseline** (0) and top of scale,
   - measures **every bar's height** by pixels.
4. **Results** — last 12 months in calendar order (Jan–Dec), with a total. The
   auto-filled **Y-axis max** and **First month** are editable so you can confirm
   or correct them; every month value is editable too.

Manual calibration (crop / Set P1 / Set P2 / tuning sliders) still lives under
**Advanced**, but is rarely needed.

## The model

- **P1** = origin, value **0**, at the X/Y axis intersection (the bar baseline row).
- **P2** = the **largest number printed on the Y axis**, at the top of the scale.
- A bar's value = linear interpolation of its **top pixel height** between P1 (0)
  and P2 (Y-max). Only height matters — bar **width is irrelevant**.
- Raw bar values are reported as-is. There is **no per-provider math** here
  (e.g. no PSE&G average-daily × days-in-month) — that lives in WattWalker.
- Any **A / E / C** letters on bars (Actual / Estimate / Customer) are ignored.

## Results: last 12 months, always Jan–Dec

Charts often show 13 bars (the same month at both ends). The results use only the
**last 12 months** (rightmost 12 bars; the extra leftmost bar is dropped) and are
always presented in calendar order **starting with January**. The app anchors on
the **first month** (leftmost bar) — read by AI or picked in the dropdown — and
maps each bar to its calendar slot.

## Reading the Y-axis number & months (AI)

Reading printed text (the Y-axis max and the 3-letter month) needs OCR, so that
part uses Gemini:

- In the **real WattWalker app** the key is built in server-side, so phone users
  enter nothing.
- In this **standalone** tool, paste a Gemini API key once under **Advanced → AI**
  (stored only in your browser's localStorage). Without a key, detection still runs
  on pixels; just type the Y-axis max and pick the first month manually.

The AI never measures bar heights — those always come from the pixel scan.

## How to run

Open `index.html` in a browser. If your browser blocks local file scripts, serve
the folder: `python -m http.server 8123 --directory .` then visit
`http://localhost:8123`.

### Dev/testing shortcut

`index.html` accepts URL params to auto-load a local image and run a pass:

```
index.html?sample=samples/synth.png&vmax=1000&first=Feb
```

Put test images in a local `samples/` folder (git-ignored — real bills contain
customer PII, never commit them).

## Detection internals (tuning sliders, under Advanced)

- **Contrast (min saturation) / Color tolerance** — how "bar-like" a pixel must be.
  Contrast mode treats white *and grey* as background, so a bar pixel is one that is
  strongly **saturated** (orange/navy/blue) or genuinely **dark** (black); this
  rejects grey gridlines and temperature lines. Color mode matches a tapped color
  (use it for pale grey bars like some JCP&L charts).
- **Min bar height (% of scale)** — ignores tiny specks below this height.
- **Min bar width (px)** — ignores thin noise columns (plus an automatic filter
  drops bars much thinner than the median, e.g. the Y-axis line).
- **Gap bridge (px)** — how far to bridge non-matching pixels while scanning a bar
  upward; raise it for bars with a letter (A/E/C) drawn inside them.

## Files

- `index.html` — UI and layout.
- `detector.js` — **framework-agnostic detection core** (no DOM). This is what gets
  ported to WattWalker. To convert to TS/React, replace the
  `const BarDetector = (function(){ … return {…} })()` wrapper with named
  `export function` declarations — the function bodies are unchanged.
- `app.js` — UI wiring (canvas, one-button pipeline, sliders, table, export, AI).

## Porting into WattWalker later

`detector.detectBarValues({ data, width, calib, target, tol, ... })` takes a canvas
`ImageData.data` buffer plus a calibration and returns
`{ bars: [{ xCenter, topY, value, ... }] }`. `autoRegion(...)` and
`autoCalibrate(...)` provide the fully-automatic chart-area + P1/P2 estimate. In
WattWalker, feed it the uploaded bill image + the P1/P2/Y-max/first-month that
Gemini returns, and use the values in place of the manual click-per-bar step in
`components/PlotDigitizer.tsx`.
