/*
 * detector.js — Pixel-based bar-chart digitizer core (framework-agnostic).
 *
 * ZERO DOM/UI code so it ports into WattWalker (as TS) later. Loaded as a
 * CLASSIC script so the tool works by double-clicking index.html (file://).
 * To port to TS/React, replace the IIFE wrapper with named `export function`s.
 *
 * Coordinate convention: pixel (x, y) with y increasing DOWNWARD (canvas style).
 * Calibration:
 *   P1 = origin  -> value v1 (0), at the X/Y axis intersection (baseline row).
 *   P2 = Y-max   -> value v2, at the top of the Y scale (the top Y-axis number).
 * Only the Y component matters for turning a bar-top pixel into a value.
 *
 * Detection methods:
 *   'contrast' (recommended) — a pixel is part of a bar if it is FAR from the
 *      chart background (white/grey). Works for ANY bar color: orange (PSE&G),
 *      navy/blue (ACE), or black (JCP&L). `tol` = min distance from background.
 *   'color' — a pixel is part of a bar if it is CLOSE to a chosen bar color
 *      (eyedropper or provider preset). `tol` = max distance from that color.
 */
const BarDetector = (function () {
  'use strict';

  function colorDistance(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function getPixel(data, width, x, y) {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  }

  function pixelYToValue(pixelY, calib) {
    const { p1y, p2y, v1, v2 } = calib;
    if (Math.abs(p2y - p1y) < 1e-6) return 0;
    return v1 + ((pixelY - p1y) / (p2y - p1y)) * (v2 - v1);
  }

  function median(arr) {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /**
   * Build a per-pixel "is this a bar pixel?" predicate for the chosen method.
   *
   * 'contrast': the background is white-ish OR grey-ish (incl. gridlines and
   *   temperature lines). A BAR pixel is therefore one that is either strongly
   *   SATURATED (orange / navy / blue) or genuinely DARK (black). This rejects
   *   grey gridlines and the grey temperature overlay, which distance-from-white
   *   would wrongly include. `tol` = required saturation (max-min). `darkThresh`
   *   catches near-black bars regardless of saturation.
   * 'color': a pixel close to a chosen bar color (eyedropper / preset).
   */
  function makeMatcher(opts) {
    const { mode, target, tol, darkThresh = 90 } = opts;
    if (mode === 'contrast') {
      const satThresh = tol;
      return (r, g, b, a) => {
        if (a < 128) return false;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        return (max - min) >= satThresh || max <= darkThresh;
      };
    }
    const [tr, tg, tb] = target || [0, 0, 0];
    return (r, g, b, a) => a >= 128 && colorDistance(r, g, b, tr, tg, tb) <= tol;
  }

  /**
   * The background is (almost always) the single most common color in the chart
   * region. Quantize to 32 levels, histogram, return the dominant color.
   */
  function estimateBackgroundColor(data, width, region) {
    const { x0, x1, y0, y1 } = region;
    const buckets = new Map();
    const stepX = Math.max(1, Math.floor((x1 - x0) / 400));
    const stepY = Math.max(1, Math.floor((y1 - y0) / 400));
    for (let y = y0; y < y1; y += stepY) {
      for (let x = x0; x < x1; x += stepX) {
        const [r, g, b, a] = getPixel(data, width, x, y);
        if (a < 128) continue;
        const key = `${r >> 3}-${g >> 3}-${b >> 3}`;
        const cur = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        cur.count++; cur.r += r; cur.g += g; cur.b += b;
        buckets.set(key, cur);
      }
    }
    let best = null;
    for (const cur of buckets.values()) if (!best || cur.count > best.count) best = cur;
    if (!best) return [255, 255, 255];
    return [Math.round(best.r / best.count), Math.round(best.g / best.count), Math.round(best.b / best.count)];
  }

  /**
   * Estimate the dominant BAR color = the most common color that is far from the
   * background by at least `minDist`. Allows dark/black bars (unlike a naive
   * saturation filter). Returns [r,g,b] or null.
   */
  function estimateBarColor(data, width, region, satThresh) {
    const st = satThresh == null ? 45 : satThresh;
    const match = makeMatcher({ mode: 'contrast', tol: st });
    const { x0, x1, y0, y1 } = region;
    const buckets = new Map();
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const [r, g, b, a] = getPixel(data, width, x, y);
        if (!match(r, g, b, a)) continue; // only saturated/dark (bar-like) pixels
        const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
        const cur = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        cur.count++; cur.r += r; cur.g += g; cur.b += b;
        buckets.set(key, cur);
      }
    }
    let best = null;
    for (const cur of buckets.values()) if (!best || cur.count > best.count) best = cur;
    if (!best) return null;
    return [Math.round(best.r / best.count), Math.round(best.g / best.count), Math.round(best.b / best.count)];
  }

  /**
   * For each column in [xStart, xEnd], walk UP from baseline and find the highest
   * y that is part of a contiguous run of bar pixels (small gaps bridged, so
   * value labels / letters drawn inside bars don't cut them off).
   */
  function scanColumns(data, width, params) {
    const { xStart, xEnd, baselineY, topLimitY, match, allowedGap } = params;
    const cols = [];
    for (let x = xStart; x <= xEnd; x++) {
      let topY = null, gap = 0;
      for (let y = baselineY; y >= topLimitY; y--) {
        const [r, g, b, a] = getPixel(data, width, x, y);
        if (match(r, g, b, a)) { topY = y; gap = 0; }
        else { gap++; if (gap > allowedGap) break; }
      }
      cols.push({ topY, height: topY !== null ? baselineY - topY : 0 });
    }
    return cols;
  }

  function segmentBars(cols, params) {
    const { xStart, minHeightPx, minWidthPx, gapMergePx } = params;
    const isBar = cols.map((c) => c.topY !== null && c.height >= minHeightPx);
    const runs = [];
    let i = 0;
    while (i < isBar.length) {
      if (!isBar[i]) { i++; continue; }
      let j = i + 1;
      while (j < isBar.length) {
        if (isBar[j]) { j++; continue; }
        let k = j;
        while (k < isBar.length && !isBar[k]) k++;
        if (k < isBar.length && k - j <= gapMergePx) { j = k; } else { break; }
      }
      runs.push([i, j - 1]);
      i = j;
    }
    const bars = [];
    for (const [a, b] of runs) {
      const widthPx = b - a + 1;
      if (widthPx < minWidthPx) continue;
      const pad = Math.floor(widthPx * 0.2);
      const tops = [];
      const heights = [];
      for (let c = a + pad; c <= b - pad; c++) {
        if (cols[c].topY !== null) { tops.push(cols[c].topY); heights.push(cols[c].height); }
      }
      const usable = tops.length ? tops : cols.slice(a, b + 1).map((c) => c.topY).filter((v) => v !== null);
      const usableH = heights.length ? heights : cols.slice(a, b + 1).map((c) => c.height);
      if (usable.length === 0) continue;
      if (median(usableH) < minHeightPx) continue; // skip near-baseline slivers
      bars.push({
        xStart: xStart + a,
        xEnd: xStart + b,
        xCenter: xStart + Math.round((a + b) / 2),
        topY: Math.round(median(usable)),
        widthPx,
        columnsUsed: usable.length,
      });
    }

    // Width is NOT used to value bars (only height matters). We only drop
    // extremely thin slivers (e.g. a 1-2px axis line) that are clearly not bars;
    // any bar of reasonable width is always kept regardless of its width.
    if (bars.length >= 3) {
      const medW = median(bars.map((b) => b.widthPx));
      const cutoff = Math.max(minWidthPx, medW * 0.3);
      return bars.filter((b) => b.widthPx >= cutoff);
    }
    return bars;
  }

  /**
   * High-level detection.
   * config: {
   *   data, width, calib:{p1x,p1y,p2x,p2y,v1,v2},
   *   mode:'contrast'|'color', target:[r,g,b], bg:[r,g,b], tol,
   *   plot:{x0,x1}  (x-range to scan; excludes the Y axis / labels),
   *   allowedGap, minHeightFrac, minWidthPx, gapMergePx
   * }
   */
  function detectBarValues(config) {
    const {
      data, width, calib, mode = 'contrast', target, bg = [255, 255, 255],
      tol = 60, plot, allowedGap = 4, minHeightFrac = 0.01, minWidthPx = 3, gapMergePx = 3,
    } = config;

    const baselineY = Math.round(calib.p1y);
    const topLimitY = Math.max(0, Math.round(calib.p2y) - 2);
    const fullScalePx = Math.abs(calib.p1y - calib.p2y);
    const minHeightPx = Math.max(2, Math.round(fullScalePx * minHeightFrac));

    const region = plot || { x0: Math.min(calib.p1x, calib.p2x), x1: width - 1 };
    // Skip a couple px past the Y axis so the vertical axis line isn't a "bar".
    const xStart = Math.max(0, Math.round(region.x0) + 2);
    const xEnd = Math.min(width - 1, Math.round(region.x1));

    const match = makeMatcher({ mode, target, bg, tol });
    const cols = scanColumns(data, width, { xStart, xEnd, baselineY, topLimitY, match, allowedGap });
    const bars = segmentBars(cols, { xStart, minHeightPx, minWidthPx, gapMergePx });
    const results = bars.map((bar) => ({ ...bar, value: pixelYToValue(bar.topY, calib) }));
    return { bars: results, columns: cols, xStart, xEnd, baselineY, topLimitY, minHeightPx };
  }

  /**
   * Auto-detect the chart's bounding box on a full-bill / photo image, so the
   * user never has to drag a crop box (critical for phones). Strategy: find all
   * "bar-like" pixels (saturated OR dark, i.e. not white/grey background) via a
   * downsampled scan, build column/row occupancy histograms, then take the
   * bounding box of the DENSE region (columns/rows whose count clears a fraction
   * of the peak). A small pad is added and the top is extended upward so the
   * Y-axis max tick area is included. Returns {x0,y0,x1,y1} or null.
   */
  function autoRegion(data, width, height) {
    const tol = 45;
    const match = makeMatcher({ mode: 'contrast', tol });
    const stepX = Math.max(1, Math.floor(width / 800));
    const stepY = Math.max(1, Math.floor(height / 800));
    const colHas = new Array(width).fill(0);
    const rowHas = new Array(height).fill(0);
    let total = 0;
    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        const [r, g, b, a] = getPixel(data, width, x, y);
        if (match(r, g, b, a)) { colHas[x]++; rowHas[y]++; total++; }
      }
    }
    if (total < 30) return null;

    const peakCol = Math.max(...colHas);
    const peakRow = Math.max(...rowHas);
    // Keep columns/rows that carry a meaningful share of the peak occupancy.
    const colThresh = Math.max(1, peakCol * 0.12);
    const rowThresh = Math.max(1, peakRow * 0.08);

    let x0 = -1, x1 = -1, y0 = -1, y1 = -1;
    for (let x = 0; x < width; x++) if (colHas[x] >= colThresh) { if (x0 < 0) x0 = x; x1 = x; }
    for (let y = 0; y < height; y++) if (rowHas[y] >= rowThresh) { if (y0 < 0) y0 = y; y1 = y; }
    if (x0 < 0 || y0 < 0 || x1 - x0 < 10 || y1 - y0 < 10) return null;

    // Pad a bit; extend LEFT (Y-axis numbers) and UP (top tick + tallest bar).
    const padX = Math.round((x1 - x0) * 0.06) + 4;
    const padY = Math.round((y1 - y0) * 0.08) + 4;
    return {
      x0: Math.max(0, x0 - padX * 2),
      y0: Math.max(0, y0 - padY * 2),
      x1: Math.min(width - 1, x1 + padX),
      y1: Math.min(height - 1, y1 + padY),
    };
  }

  /**
   * Best-effort auto calibration inside a region (fully-automatic pass).
   * Uses contrast-from-background so it works for orange/navy/black bars.
   * Returns { p1x, p1y, p2x, p2y, target, bg } or null.
   * P2 (top of scale) is a text tick CV can't read, so it's approximated ~90%
   * above the tallest bar; the user confirms P2 position + the Y-max value.
   */
  function autoCalibrate(data, width, height, region) {
    const reg = region || { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
    const bg = estimateBackgroundColor(data, width, reg);
    const tol = 45;
    const match = makeMatcher({ mode: 'contrast', tol });

    const w = reg.x1 - reg.x0;
    const h = reg.y1 - reg.y0;
    const rowCount = new Array(h).fill(0);
    const colHas = new Array(w).fill(0);
    let found = 0, minX = reg.x1;
    for (let y = reg.y0; y < reg.y1; y++) {
      for (let x = reg.x0; x < reg.x1; x++) {
        const [r, g, b, a] = getPixel(data, width, x, y);
        if (match(r, g, b, a)) {
          rowCount[y - reg.y0]++;
          colHas[x - reg.x0]++;
          if (x < minX) minX = x;
          found++;
        }
      }
    }
    if (found < 20) return null;

    // Baseline = the row (in the lower 60% of the region) with the MOST bar
    // pixels — the shared bar bottoms + horizontal axis line all live there.
    // Bars of different heights share a flat bottom, so a whole BAND of rows
    // (from the shortest bar's top down to the baseline) ties for the max count.
    // We must pick the LOWEST (largest-y) row of that band — the true baseline —
    // otherwise short bars read as ~0 and get dropped. Using >= makes the lowest
    // tied row win. Month-label text below the axis has far fewer pixels, so it
    // never ties the max and can't pull the baseline down.
    let baselineY = reg.y1 - 1, bestCount = -1;
    const startY = Math.floor(h * 0.4);
    for (let i = startY; i < h; i++) {
      if (rowCount[i] >= bestCount) { bestCount = rowCount[i]; baselineY = reg.y0 + i; }
    }

    // Top of tallest bar = highest row with a "real" amount of bar pixels
    // (threshold filters stray temperature-line / antialias pixels).
    const rowThresh = Math.max(2, Math.round(bestCount * 0.05));
    let minBarY = baselineY;
    for (let i = 0; i < (baselineY - reg.y0); i++) {
      if (rowCount[i] >= rowThresh) { minBarY = reg.y0 + i; break; }
    }

    const p1x = minX;
    const p1y = baselineY;
    const tallestPx = Math.max(1, p1y - minBarY);
    const p2y = Math.max(reg.y0, Math.round(p1y - tallestPx / 0.9));
    const target = estimateBarColor(data, width, reg, tol) || [0, 0, 0];
    return { p1x, p1y, p2x: p1x, p2y, target, bg };
  }

  return {
    colorDistance, getPixel, pixelYToValue, makeMatcher,
    estimateBackgroundColor, estimateBarColor,
    scanColumns, segmentBars, detectBarValues, autoRegion, autoCalibrate,
  };
})();
