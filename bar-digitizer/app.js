/* app.js — UI wiring for the standalone Usage Reader. Uses BarDetector.
 *
 * Flow goal: on a phone, the user does as little as possible —
 *   1. add the graph (photo/upload)
 *   2. (optional) tap a bar if it's a faint color
 *   3. press "Detect Usage"
 * ...and the app auto-finds the chart area, auto-reads the Y-axis max number
 * and the first month (via AI), and measures every bar's height by pixels.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const state = {
    img: null, W: 0, H: 0, imageData: null, base64: null, mimeType: null,
    calib: { p1x: null, p1y: null, p2x: null, p2y: null, v1: 0, v2: null },
    mode: 'contrast',       // 'contrast' | 'color'
    target: null,           // [r,g,b] for color mode
    bg: [255, 255, 255],    // background color for contrast mode
    region: null,           // {x0,y0,x1,y1} chart area in natural pixels
    interaction: 'none',    // 'p1' | 'p2' | 'color' | 'region' | 'none'
    dragRect: null,
    bars: [],
    monthOverrides: {},
  };

  const canvas = $('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  function setStatus(el, msg, kind) {
    const node = $(el);
    if (!msg) { node.className = 'status'; node.textContent = ''; return; }
    node.className = 'status show ' + (kind || 'info');
    node.textContent = msg;
  }
  const getKey = () => ($('apiKey').value || '').trim();

  // ---------- Image loading ----------
  function loadImageFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      state.base64 = String(reader.result).split(',')[1];
      state.mimeType = file.type || 'image/png';
      const img = new Image();
      img.onload = () => onImageReady(img);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function onImageReady(img) {
    state.img = img;
    state.W = img.naturalWidth;
    state.H = img.naturalHeight;
    canvas.width = state.W;
    canvas.height = state.H;
    ctx.drawImage(img, 0, 0);
    state.imageData = ctx.getImageData(0, 0, state.W, state.H);

    state.calib = { p1x: null, p1y: null, p2x: null, p2y: null, v1: 0, v2: null };
    state.target = null;
    state.bg = [255, 255, 255];
    state.region = null;
    state.bars = [];
    state.monthOverrides = {};
    $('vmaxInput').value = '';
    $('firstMonth').value = '';
    $('swatch').style.background = 'transparent';
    setColorMode('contrast');
    renderResults();

    $('emptyState').style.display = 'none';
    $('canvasScroll').style.display = 'block';
    const dim = $('dimTag');
    dim.style.display = 'inline';
    dim.textContent = state.W + ' × ' + state.H + ' px';

    ['colorAuto', 'colorPick', 'detectBtn', 'cropBtn', 'p1Btn', 'p2Btn', 'aiBtn'].forEach((b) => ($(b).disabled = false));
    setStatus('detectStatus', 'Ready. Press "Detect Usage".', 'info');
    render();
    if (AUTORUN) applyAutorun();
  }

  function getRegion() {
    return state.region || { x0: 0, y0: 0, x1: state.W - 1, y1: state.H - 1 };
  }

  // ---------- Rendering ----------
  function render() {
    if (!state.img) return;
    ctx.drawImage(state.img, 0, 0);
    const c = state.calib;

    const rect = state.dragRect || state.region;
    if (rect) {
      ctx.save();
      ctx.fillStyle = 'rgba(2,6,23,0.4)';
      ctx.beginPath();
      ctx.rect(0, 0, state.W, state.H);
      ctx.rect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = Math.max(1.5, state.W / 700);
      ctx.strokeRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
      ctx.restore();
    }

    if (c.p1y !== null) drawHLine(c.p1y, '#22c55e');
    if (c.p2y !== null) drawHLine(c.p2y, '#f59e0b', true);
    if (c.p1x !== null) drawVLine(c.p1x, 'rgba(148,163,184,0.5)');

    ctx.lineWidth = Math.max(1, state.W / 600);
    const labels = state.bars.length ? barMonthLabels() : [];
    state.bars.forEach((bar, idx) => {
      const counted = labels[idx] !== null && labels[idx] !== undefined;
      ctx.strokeStyle = counted ? 'rgba(0,168,249,0.95)' : 'rgba(148,163,184,0.6)';
      ctx.beginPath();
      ctx.moveTo(bar.xCenter, c.p1y);
      ctx.lineTo(bar.xCenter, bar.topY);
      ctx.stroke();
      dot(bar.xCenter, bar.topY, counted ? '#38bdf8' : '#64748b');
      const label = c.v2 !== null ? Math.round(bar.value).toString() : '?';
      drawText(label, bar.xCenter, bar.topY - 6, counted ? '#e2e8f0' : '#64748b');
      if (labels[idx]) drawText(labels[idx], bar.xCenter, c.p1y + 16, '#94a3b8');
    });

    if (c.p1x !== null) marker(c.p1x, c.p1y, '#22c55e', 'P1');
    if (c.p2x !== null) marker(c.p2x, c.p2y, '#f59e0b', 'P2');
  }

  function drawHLine(y, color, dashed) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, state.W / 900);
    if (dashed) ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(state.W, y); ctx.stroke(); ctx.restore();
  }
  function drawVLine(x, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, state.W / 900);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, state.H); ctx.stroke(); ctx.restore();
  }
  function dot(x, y, color) {
    ctx.save(); ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, Math.max(2, state.W / 300), 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function marker(x, y, color, text) { dot(x, y, color); drawText(text, x + 8, y - 8, color); }
  function drawText(text, x, y, color) {
    ctx.save();
    const size = Math.max(11, Math.round(state.W / 70));
    ctx.font = '700 ' + size + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = Math.max(2, size / 5);
    ctx.strokeStyle = 'rgba(2,6,23,0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.restore();
  }

  // ---------- Interaction ----------
  function canvasToPixel(e) {
    const rect = canvas.getBoundingClientRect();
    const src = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
    const x = Math.round((src.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.round((src.clientY - rect.top) * (canvas.height / rect.height));
    return { x: Math.max(0, Math.min(canvas.width - 1, x)), y: Math.max(0, Math.min(canvas.height - 1, y)) };
  }

  canvas.addEventListener('mousedown', (e) => {
    if (state.interaction !== 'region' || !state.img) return;
    const p = canvasToPixel(e);
    state.dragRect = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, sx: p.x, sy: p.y };
    e.preventDefault();
  });
  canvas.addEventListener('mousemove', (e) => {
    if (state.interaction !== 'region' || !state.dragRect) return;
    const p = canvasToPixel(e);
    const d = state.dragRect;
    d.x0 = Math.min(d.sx, p.x); d.y0 = Math.min(d.sy, p.y);
    d.x1 = Math.max(d.sx, p.x); d.y1 = Math.max(d.sy, p.y);
    render();
  });
  canvas.addEventListener('mouseup', () => {
    if (state.interaction !== 'region' || !state.dragRect) return;
    const d = state.dragRect;
    if (d.x1 - d.x0 > 10 && d.y1 - d.y0 > 10) {
      state.region = { x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1 };
      setStatus('detectStatus', 'Chart area set. Press "Detect Usage".', 'info');
    }
    state.dragRect = null;
    setInteraction('none');
    render();
  });

  canvas.addEventListener('click', (e) => {
    if (!state.img || state.interaction === 'none' || state.interaction === 'region') return;
    const { x, y } = canvasToPixel(e);
    if (state.interaction === 'p1') { state.calib.p1x = x; state.calib.p1y = y; setInteraction('none'); }
    else if (state.interaction === 'p2') { state.calib.p2x = x; state.calib.p2y = y; setInteraction('none'); }
    else if (state.interaction === 'color') {
      const p = BarDetector.getPixel(state.imageData.data, state.W, x, y);
      state.target = [p[0], p[1], p[2]];
      state.mode = 'color';
      $('swatch').style.background = 'rgb(' + state.target.join(',') + ')';
      setColorButtons();
      setInteraction('none');
      setStatus('detectStatus', 'Bar color picked. Press "Detect Usage".', 'info');
    }
    render();
    maybeAutoDetect();
  });

  function setInteraction(mode) {
    state.interaction = mode;
    ['p1Btn', 'p2Btn', 'cropBtn'].forEach((b) => $(b).classList.remove('active'));
    $('colorPick').classList.toggle('active', mode === 'color' || state.mode === 'color');
    if (mode === 'p1') $('p1Btn').classList.add('active');
    if (mode === 'p2') $('p2Btn').classList.add('active');
    if (mode === 'region') $('cropBtn').classList.add('active');
    canvas.style.cursor = mode === 'none' ? 'default' : 'crosshair';
  }

  // ---------- Bar color mode ----------
  function setColorButtons() {
    $('colorAuto').classList.toggle('active', state.mode === 'contrast');
    $('colorPick').classList.toggle('active', state.mode === 'color');
  }
  // Selecting "Tap the bar" is a SINGLE action: it switches to color mode AND
  // immediately arms the eyedropper so the next tap on the image picks the color.
  function setColorMode(mode) {
    state.mode = mode;
    setColorButtons();
    if (mode === 'color') {
      $('colorHint').textContent = 'Now tap one of the bars in the image.';
      setInteraction('color');
    } else {
      state.target = null;
      $('colorHint').textContent = 'Auto works for orange, blue, or black bars. If a bar is a faint color, tap "Tap the bar" then tap a bar.';
      $('swatch').style.background = 'transparent';
      setInteraction('none');
    }
  }

  // ---------- Detection ----------
  function currentParams() {
    return {
      tol: parseInt($('tol').value, 10),
      minHeightFrac: parseInt($('minh').value, 10) / 1000,
      minWidthPx: parseInt($('minw').value, 10),
      allowedGap: parseInt($('gap').value, 10),
    };
  }

  function canDetect() {
    const c = state.calib;
    if (!(state.imageData && c.p1y !== null && c.p2y !== null)) return false;
    return state.mode === 'contrast' ? true : !!state.target;
  }

  function runDetection() {
    if (!canDetect()) return false;
    const p = currentParams();
    const reg = getRegion();
    if (state.mode === 'contrast') {
      state.bg = BarDetector.estimateBackgroundColor(state.imageData.data, state.W, reg);
    }
    const v2 = parseFloat($('vmaxInput').value);
    state.calib.v2 = isNaN(v2) ? null : v2;
    const calibForCalc = { ...state.calib, v2: state.calib.v2 === null ? 1 : state.calib.v2 };

    const res = BarDetector.detectBarValues({
      data: state.imageData.data, width: state.W,
      calib: calibForCalc,
      mode: state.mode, target: state.target, bg: state.bg,
      tol: p.tol,
      plot: { x0: reg.x0, x1: reg.x1 },
      allowedGap: p.allowedGap, minHeightFrac: p.minHeightFrac, minWidthPx: p.minWidthPx, gapMergePx: 3,
    });

    state.bars = res.bars;
    render();
    renderResults();
    return true;
  }

  function maybeAutoDetect() { if (canDetect() && state.bars.length) runDetection(); }

  // The one button: find chart area → read scale & months (AI) → measure bars.
  async function detectUsage() {
    if (!state.imageData) return;
    setStatus('detectStatus', 'Reading the chart…', 'info');

    // 1) AI reads the Y-axis max number, the first month, plot bounds & baseline.
    const key = getKey();
    let aiOk = false;
    if (key) { try { aiOk = await aiCalibrate(key); } catch (e) { aiOk = false; } }

    // 2) Auto chart-area if AI didn't set one.
    if (!state.region) {
      const r = BarDetector.autoRegion(state.imageData.data, state.W, state.H);
      if (r) state.region = r;
    }
    // 3) Auto baseline/top if not calibrated by AI.
    if (state.calib.p1y === null || state.calib.p2y === null) {
      const reg = getRegion();
      const cal = BarDetector.autoCalibrate(state.imageData.data, state.W, state.H, reg);
      if (cal) {
        state.bg = cal.bg;
        state.calib.p1x = cal.p1x; state.calib.p1y = cal.p1y;
        state.calib.p2x = cal.p2x; state.calib.p2y = cal.p2y;
        if (state.mode === 'color' && !state.target) {
          state.target = cal.target;
          $('swatch').style.background = 'rgb(' + cal.target.join(',') + ')';
        }
      }
    }

    if (state.calib.p1y === null || state.calib.p2y === null) {
      setStatus('detectStatus', 'Could not find the chart automatically. Open "Advanced" → Manual calibration.', 'bad');
      render();
      return;
    }
    if (state.mode === 'color' && !state.target) {
      setStatus('detectStatus', 'Tap a bar first: press "Tap the bar", then tap a bar.', 'warn');
      render();
      return;
    }

    runDetection();

    // 4) Guidance on anything still missing.
    const need = [];
    if (state.calib.v2 === null) need.push('enter the Y-axis max');
    if (!$('firstMonth').value) need.push('pick the first month');
    if (!state.bars.length) {
      setStatus('detectStatus', 'No bars found. Try "Tap the bar" on a bar, or open Advanced to crop tighter.', 'bad');
    } else if (need.length) {
      setStatus('detectStatus', state.bars.length + ' bars found — ' + need.join(' and ') + ' above to finish.', 'warn');
    } else {
      setStatus('detectStatus', state.bars.length + ' bars read successfully.', 'good');
    }
    render();
  }

  // ---------- Months & calendar mapping ----------
  // Bars run left→right as consecutive months starting at the FIRST (leftmost)
  // month. We keep the last 12 bars and drop any older ones (a 13th month), then
  // place each into its calendar slot Jan..Dec.
  function firstMonthIdx() { return MONTHS.indexOf($('firstMonth').value); }

  function computeCalendar() {
    const hasVal = state.calib.v2 !== null && !isNaN(state.calib.v2);
    const fi = firstMonthIdx();
    const map = new Array(12).fill(null);
    if (fi < 0) return map;
    const n = state.bars.length;
    const start = Math.max(0, n - 12);
    for (let i = start; i < n; i++) {
      const m = (fi + i) % 12;
      map[m] = hasVal ? state.bars[i].value : null;
    }
    return map;
  }

  function barMonthLabels() {
    const n = state.bars.length;
    const fi = firstMonthIdx();
    const labels = new Array(n).fill(null);
    if (fi < 0) return labels;
    const start = Math.max(0, n - 12);
    for (let i = start; i < n; i++) labels[i] = MONTHS[(fi + i) % 12];
    return labels;
  }

  // ---------- Results (Jan..Dec, last 12 months) ----------
  function renderResults() {
    const body = $('resultsBody');
    body.innerHTML = '';
    const cal = computeCalendar();
    let total = 0, count = 0;
    for (let m = 0; m < 12; m++) {
      const tr = document.createElement('tr');
      const monthTd = document.createElement('td');
      monthTd.textContent = MONTHS[m];

      const valTd = document.createElement('td');
      const override = state.monthOverrides[m];
      const base = cal[m] !== null ? Math.round(cal[m]) : null;
      const shown = override !== undefined ? override : base;

      const input = document.createElement('input');
      input.type = 'number';
      input.style.width = '100%';
      input.value = shown !== null && shown !== undefined ? shown : '';
      input.placeholder = '—';
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        if (isNaN(v)) delete state.monthOverrides[m];
        else state.monthOverrides[m] = Math.round(v);
        updateTotal();
      });
      valTd.appendChild(input);

      if (shown !== null && shown !== undefined) { total += shown; count++; }
      tr.appendChild(monthTd); tr.appendChild(valTd);
      body.appendChild(tr);
    }
    $('totalVal').textContent = count ? total.toLocaleString() : '—';
    const n = state.bars.length;
    $('barCountNote').textContent = n
      ? `${n} bar${n === 1 ? '' : 's'} detected; using last ${Math.min(12, n)} → Jan–Dec.`
      : '';
    const enable = n > 0;
    $('copyBtn').disabled = !enable;
    $('csvBtn').disabled = !enable;
  }

  function updateTotal() {
    const cal = computeCalendar();
    let total = 0, count = 0;
    for (let m = 0; m < 12; m++) {
      const override = state.monthOverrides[m];
      const base = cal[m] !== null ? Math.round(cal[m]) : null;
      const shown = override !== undefined ? override : base;
      if (shown !== null && shown !== undefined) { total += shown; count++; }
    }
    $('totalVal').textContent = count ? total.toLocaleString() : '—';
  }

  // ---------- AI: read Y-axis max number + first month + plot geometry ----------
  // The AI ONLY reads text/positions (numbers CV can't read). Bar HEIGHTS are
  // always measured by pixels afterwards. Returns true on success.
  async function aiCalibrate(key) {
    if (!state.base64) return false;
    localStorage.setItem('bd_api_key', key);
    const model = ($('model').value || '').trim() || 'gemini-2.5-flash';
    setStatus('detectStatus', 'Reading the Y-axis number and months…', 'info');
    const prompt =
      'This image contains an electric-usage BAR CHART. Look ONLY at that chart. ' +
      'All positions are fractions from 0.0 (top/left) to 1.0 (bottom/right) of the WHOLE image. ' +
      'Return ONLY JSON: {' +
      '"yAxisMax": <largest number printed on the vertical Y axis, as a number>, ' +
      '"yAxisMaxCenterY": <vertical center of that largest Y-axis number>, ' +
      '"baselineY": <vertical position of the chart baseline / x-axis where the bars start (the 0 line)>, ' +
      '"plotLeftX": <x of the Y axis (left edge of the plotting area)>, ' +
      '"plotRightX": <x of the right edge of the last bar>, ' +
      '"firstMonth": <three-letter abbreviation (Jan..Dec) of the LEFTMOST bar\'s month>, ' +
      '"months": [<three-letter month abbreviations for each bar, left to right>]}. ' +
      'Ignore any A/E/C letters on the bars. Do NOT estimate bar heights.';
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key);
    const resp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: state.mimeType, data: state.base64 } }, { text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    if (!resp.ok) { setStatus('detectStatus', 'AI read failed (HTTP ' + resp.status + '). Using pixel fallback…', 'warn'); return false; }
    const json = await resp.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let p; try { p = JSON.parse(text); } catch (e) { return false; }

    if (p.yAxisMax != null) { $('vmaxInput').value = p.yAxisMax; state.calib.v2 = parseFloat(p.yAxisMax); }
    if (p.yAxisMaxCenterY != null) state.calib.p2y = Math.round(p.yAxisMaxCenterY * state.H);
    if (p.baselineY != null) state.calib.p1y = Math.round(p.baselineY * state.H);
    if (p.plotLeftX != null) { state.calib.p1x = Math.round(p.plotLeftX * state.W); state.calib.p2x = state.calib.p1x; }
    if (p.plotLeftX != null && p.plotRightX != null) {
      state.region = {
        x0: Math.round(p.plotLeftX * state.W),
        y0: Math.max(0, (state.calib.p2y || 0) - 4),
        x1: Math.round(p.plotRightX * state.W),
        y1: state.calib.p1y || state.H - 1,
      };
    }
    const first = p.firstMonth || (Array.isArray(p.months) && p.months.length ? p.months[0] : null);
    if (first) {
      const mm = MONTHS.find((m) => String(first).toLowerCase().startsWith(m.toLowerCase()));
      if (mm) $('firstMonth').value = mm;
    }
    return true;
  }

  // ---------- Export ----------
  function toCSV() {
    const cal = computeCalendar();
    const rows = [['Month', 'Value']];
    for (let m = 0; m < 12; m++) {
      const override = state.monthOverrides[m];
      const base = cal[m] !== null ? Math.round(cal[m]) : null;
      const shown = override !== undefined ? override : base;
      rows.push([MONTHS[m], shown !== null && shown !== undefined ? shown : '']);
    }
    return rows.map((r) => r.join(',')).join('\n');
  }

  // ---------- Wire up ----------
  $('fileDrop').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => { if (e.target.files[0]) loadImageFromFile(e.target.files[0]); });
  ['dragover', 'dragenter'].forEach((ev) => $('fileDrop').addEventListener(ev, (e) => { e.preventDefault(); $('fileDrop').classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => $('fileDrop').addEventListener(ev, (e) => { e.preventDefault(); $('fileDrop').classList.remove('drag'); }));
  $('fileDrop').addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadImageFromFile(f); });

  $('colorAuto').addEventListener('click', () => { setColorMode('contrast'); maybeAutoDetect(); });
  $('colorPick').addEventListener('click', () => setColorMode('color'));
  $('detectBtn').addEventListener('click', detectUsage);

  $('cropBtn').addEventListener('click', () => setInteraction(state.interaction === 'region' ? 'none' : 'region'));
  $('p1Btn').addEventListener('click', () => setInteraction(state.interaction === 'p1' ? 'none' : 'p1'));
  $('p2Btn').addEventListener('click', () => setInteraction(state.interaction === 'p2' ? 'none' : 'p2'));
  $('aiBtn').addEventListener('click', async () => {
    const key = getKey();
    if (!key) { setStatus('detectStatus', 'Enter a Gemini API key in Advanced → AI first.', 'warn'); return; }
    try { const ok = await aiCalibrate(key); if (ok) { render(); maybeAutoDetect(); renderResults(); setStatus('detectStatus', 'AI calibration refreshed.', 'info'); } }
    catch (e) { setStatus('detectStatus', 'AI failed: ' + e.message, 'bad'); }
  });

  $('firstMonth').addEventListener('change', () => { renderResults(); render(); });
  $('vmaxInput').addEventListener('input', () => {
    const v = parseFloat($('vmaxInput').value);
    state.calib.v2 = isNaN(v) ? null : v;
    state.bars.forEach((b) => { b.value = BarDetector.pixelYToValue(b.topY, { ...state.calib, v2: state.calib.v2 == null ? 1 : state.calib.v2 }); });
    render(); renderResults();
  });

  function bindSlider(id, valId, fmt) {
    const el = $(id), out = $(valId);
    el.addEventListener('input', () => { out.textContent = fmt(parseInt(el.value, 10)); maybeAutoDetect(); });
    out.textContent = fmt(parseInt(el.value, 10));
  }
  bindSlider('tol', 'tolVal', (v) => v);
  bindSlider('minh', 'minhVal', (v) => (v / 10).toFixed(1));
  bindSlider('minw', 'minwVal', (v) => v);
  bindSlider('gap', 'gapVal', (v) => v);

  $('copyBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(toCSV()).then(() => setStatus('detectStatus', 'Copied to clipboard.', 'good'));
  });
  $('csvBtn').addEventListener('click', () => {
    const blob = new Blob([toCSV()], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'usage-values.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const savedKey = localStorage.getItem('bd_api_key');
  if (savedKey) $('apiKey').value = savedKey;
  setColorButtons();

  // Dev/test convenience: ?sample=samples/ace.png&vmax=1500&first=Aug
  const AUTORUN = (() => {
    const p = new URLSearchParams(location.search);
    if (!p.get('sample')) return null;
    return { sample: p.get('sample'), vmax: p.get('vmax'), first: p.get('first') };
  })();

  function applyAutorun() {
    if (AUTORUN.vmax) { $('vmaxInput').value = AUTORUN.vmax; state.calib.v2 = parseFloat(AUTORUN.vmax); }
    if (AUTORUN.first) $('firstMonth').value = AUTORUN.first;
    detectUsage();
  }

  if (AUTORUN) {
    fetch(AUTORUN.sample)
      .then((r) => r.blob())
      .then((b) => loadImageFromFile(new File([b], 'sample', { type: b.type || 'image/png' })))
      .catch((e) => setStatus('detectStatus', 'Sample load failed: ' + e.message, 'bad'));
  }
})();
