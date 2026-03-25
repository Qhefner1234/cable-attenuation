'use strict';

/* ----------------------------------------------------------
   Attenuation Data  (dB per 100 feet)
   ---------------------------------------------------------- */
// dB per 100 ft @ 68°F — source: Toner Cable typical attenuation chart
// 5 MHz and 1200 MHz taken directly from table; 645 MHz linearly interpolated between 600 and 750 MHz entries
const ATTENUATION = {
  'RG-59': { 5: 0.77, 645: 6.41, 1200: 8.91 },
  'RG-6':  { 5: 0.57, 645: 5.17, 1200: 7.18 },
  'RG-11': { 5: 0.36, 645: 3.29, 1200: 4.71 },
};

/* ----------------------------------------------------------
   Splitter Data
   ---------------------------------------------------------- */
const SPLITTERS = {
  '2way': {
    label: '2-Way',
    legs: [
      { label: '-3.5 dB Leg', loss42: 3.5, loss860: 3.5 },
      { label: '-3.5 dB Leg', loss42: 3.5, loss860: 3.5 },
    ],
  },
  '3way-unbal': {
    label: '3-Way Unbalanced',
    legs: [
      { label: '-3.5 dB Leg', loss42: 3.5, loss860: 3.5 },
      { label: '-7 dB Leg',   loss42: 7.0, loss860: 7.0 },
      { label: '-7 dB Leg',   loss42: 7.0, loss860: 7.0 },
    ],
  },
  '3way-bal': {
    label: '3-Way Balanced',
    legs: [
      { label: '-5.5 dB Leg', loss42: 5.5, loss860: 5.5 },
      { label: '-5.5 dB Leg', loss42: 5.5, loss860: 5.5 },
      { label: '-5.5 dB Leg', loss42: 5.5, loss860: 5.5 },
    ],
  },
  'dc6': {
    label: 'DC 6',
    legs: [
      { label: '-0.5 dB Leg', loss42: 0.5, loss860: 0.5 },
      { label: '-6.5 dB Leg', loss42: 6.5, loss860: 6.5 },
    ],
  },
};

/* ----------------------------------------------------------
   State
   ---------------------------------------------------------- */
let activeCable = 'RG-59';

// Splitter chain state
let splitterChain = [];   // [{ type, fromLeg, cableLen }]  cableLen = ft of cable before this splitter
let pendingFromLeg = null;

// Diagram drag state
let diagCanvas    = null;
let diagDrag      = null;   // { idx, startX, startY, startLen }  — splitter body drag
let diagLegDrag   = null;   // { i, j, startX, startLen } — terminal leg drag
let diagBodyRects = [];     // [{ x, topY, botY }]  one per splitter body
let diagLegRects  = [];     // [{ i, j, x, y, w, h }]  one per terminal leg val box
let diagVertical  = false;  // true when drawing in vertical (mobile) mode

// Diagram layout constants
const PX_PER_FT  = 2.5;   // pixels per foot of cable
const MAX_CABLE  = 200;    // max draggable cable length (ft)
const MIN_GAP_PX = 24;     // minimum visual gap even at 0 ft

/* ----------------------------------------------------------
   Calculation
   ---------------------------------------------------------- */
function interpolateAttenuation(cable, freqMHz) {
  const t = ATTENUATION[cable];
  let f1, f2, a1, a2;
  if (freqMHz <= 645) { f1 = 5;   f2 = 645;  a1 = t[5];   a2 = t[645]; }
  else                { f1 = 645; f2 = 1200; a1 = t[645]; a2 = t[1200]; }
  const frac = (Math.sqrt(freqMHz) - Math.sqrt(f1)) / (Math.sqrt(f2) - Math.sqrt(f1));
  return a1 + frac * (a2 - a1);
}

function updateSignalLevels() {
  const len   = parseFloat(document.getElementById('lengthInput').value);
  const in42  = parseFloat(document.getElementById('sigIn42').value);
  const in860 = parseFloat(document.getElementById('sigIn860').value);

  const valid  = !isNaN(len) && len > 0;
  const has42  = !isNaN(in42);
  const has860 = !isNaN(in860);

  const att42  = valid ? interpolateAttenuation(activeCable, 42)  * (len / 100) : null;
  const att860 = valid ? interpolateAttenuation(activeCable, 860) * (len / 100) : null;

  document.getElementById('sigOut42').textContent  = (valid && has42)  ? (in42  - att42).toFixed(1)  : '—';
  document.getElementById('sigOut860').textContent = (valid && has860) ? (in860 - att860).toFixed(1) : '—';
  document.getElementById('sigLoss42').textContent  = valid ? att42.toFixed(2)  : '—';
  document.getElementById('sigLoss860').textContent = valid ? att860.toFixed(2) : '—';
  renderSplitterChain();
  renderTreeDiagram();
}

function calculate(cable, lengthFt) {
  const table = ATTENUATION[cable];
  return {
    f5:    parseFloat(((lengthFt / 100) * table[5]).toFixed(2)),
    f645:  parseFloat(((lengthFt / 100) * table[645]).toFixed(2)),
    f1200: parseFloat(((lengthFt / 100) * table[1200]).toFixed(2)),
  };
}

/* ----------------------------------------------------------
   Results Update
   ---------------------------------------------------------- */
function updateResults() {
  const raw = document.getElementById('lengthInput').value.trim();
  const len = parseFloat(raw);
  const valid = raw !== '' && !isNaN(len) && len > 0;

  const val5    = document.getElementById('val5');
  const val645  = document.getElementById('val645');
  const val1200 = document.getElementById('val1200');
  const bar5    = document.getElementById('bar5');
  const bar645  = document.getElementById('bar645');
  const bar1200 = document.getElementById('bar1200');

  document.getElementById('summaryLength').textContent = valid ? len : '—';
  document.getElementById('summaryCable').textContent  = activeCable;

  if (!valid) {
    [val5, val645, val1200].forEach(el => { el.textContent = '—'; });
    [bar5, bar645, bar1200].forEach(el => { el.style.width = '0%'; });
    return;
  }

  const result = calculate(activeCable, len);

  val5.textContent    = result.f5;
  val645.textContent  = result.f645;
  val1200.textContent = result.f1200;

  // Normalise bars: cap at 100%
  bar5.style.width    = Math.min((result.f5    / (ATTENUATION[activeCable][5]    * 10)) * 100, 100) + '%';
  bar645.style.width  = Math.min((result.f645  / (ATTENUATION[activeCable][645]  * 10)) * 100, 100) + '%';
  bar1200.style.width = Math.min((result.f1200 / (ATTENUATION[activeCable][1200] * 10)) * 100, 100) + '%';

  if (window.cableDude) window.cableDude.setTarget(len);
  updateSignalLevels();
}

/* ----------------------------------------------------------
   Splitter Chain
   ---------------------------------------------------------- */
function computeChain() {
  const in42  = parseFloat(document.getElementById('sigIn42').value);
  const in860 = parseFloat(document.getElementById('sigIn860').value);
  if (isNaN(in42) || isNaN(in860)) return null;

  const results = [];
  for (let i = 0; i < splitterChain.length; i++) {
    const item      = splitterChain[i];
    const def       = SPLITTERS[item.type];
    const cableLen  = item.cableLen ?? 0;
    const cableType = item.cableType ?? activeCable;
    const att42     = interpolateAttenuation(cableType, 42);
    const att860    = interpolateAttenuation(cableType, 860);

    let src42, src860;
    if (i === 0) {
      src42 = in42; src860 = in860;
    } else {
      const prev = results[i - 1];
      const leg  = prev.legs[item.fromLeg];
      src42  = leg.out42;
      src860 = leg.out860;
    }
    // Apply input cable attenuation before this splitter
    src42  = +(src42  - att42  * cableLen / 100).toFixed(2);
    src860 = +(src860 - att860 * cableLen / 100).toFixed(2);

    results.push({
      in42: src42, in860: src860, cableLen, cableType,
      legs: def.legs.map((leg, j) => {
        const legLen       = item.legLens?.[j] ?? 0;
        const legCableType = item.legCableTypes?.[j] ?? activeCable;
        const latt42  = interpolateAttenuation(legCableType, 42);
        const latt860 = interpolateAttenuation(legCableType, 860);
        return {
          label:  leg.label,
          out42:  +(src42  - leg.loss42  - latt42  * legLen / 100).toFixed(1),
          out860: +(src860 - leg.loss860 - latt860 * legLen / 100).toFixed(1),
        };
      }),
    });
  }
  return results;
}

function _makeCableSelect(currentType, onChange) {
  const group = document.createElement('div');
  group.className = 'sp-cable-btn-group';
  Object.keys(ATTENUATION).forEach(k => {
    const btn = document.createElement('button');
    btn.className = 'sp-cable-btn' + (k === currentType ? ' active' : '');
    btn.textContent = k;
    btn.addEventListener('click', () => {
      group.querySelectorAll('.sp-cable-btn').forEach(b => b.classList.toggle('active', b === btn));
      onChange(k);
    });
    group.appendChild(btn);
  });
  return group;
}

function renderSplitterChain() {
  const container = document.getElementById('splitterChain');
  if (!container) return;

  const computed = computeChain();
  const hasInputs = computed !== null;
  container.innerHTML = '';

  // Render each splitter block
  splitterChain.forEach((item, idx) => {
    const res = hasInputs ? computed[idx] : null;
    const block = document.createElement('div');
    block.className = 'sp-block';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'sp-block-header';
    hdr.innerHTML = `<span class="sp-block-label">${SPLITTERS[item.type].label}</span>` +
      (res ? `<span class="sp-block-input">in: <b>${res.in42} / ${res.in860}</b> dBmV</span>` : '') +
      `<button class="sp-remove-btn" data-idx="${idx}" title="Remove this and subsequent splitters">✕</button>`;
    block.appendChild(hdr);

    // Input cable type row
    const inputCableRow = document.createElement('div');
    inputCableRow.className = 'sp-input-cable-row';
    const inputCableLabel = document.createElement('span');
    inputCableLabel.className = 'sp-input-cable-label';
    inputCableLabel.textContent = 'Input cable';
    inputCableRow.appendChild(inputCableLabel);
    inputCableRow.appendChild(_makeCableSelect(item.cableType ?? activeCable, val => {
      item.cableType = val;
      renderSplitterChain(); renderTreeDiagram();
    }));
    block.appendChild(inputCableRow);

    // Legs
    const legsEl = document.createElement('div');
    legsEl.className = 'sp-legs';
    SPLITTERS[item.type].legs.forEach((leg, li) => {
      const isChained = idx === splitterChain.length - 1 && pendingFromLeg === li;
      const legLen = item.legLens?.[li] ?? 0;
      const out42  = res ? res.legs[li].out42  : '—';
      const out860 = res ? res.legs[li].out860 : '—';

      const row = document.createElement('div');
      row.className = 'sp-leg' + (isChained ? ' sp-leg-selected' : '');

      const labelEl = document.createElement('span');
      labelEl.className = 'sp-leg-label';
      labelEl.textContent = leg.label;
      row.appendChild(labelEl);

      // Cable type for this leg
      const legCableType = item.legCableTypes?.[li] ?? activeCable;
      row.appendChild(_makeCableSelect(legCableType, val => {
        if (!item.legCableTypes) item.legCableTypes = new Array(SPLITTERS[item.type].legs.length).fill(activeCable);
        item.legCableTypes[li] = val;
        renderSplitterChain(); renderTreeDiagram();
      }));

      // Cable length input for this leg
      const cableWrap = document.createElement('span');
      cableWrap.className = 'sp-leg-cable';
      const cableInput = document.createElement('input');
      cableInput.type = 'number';
      cableInput.className = 'sp-leg-len';
      cableInput.min = '0'; cableInput.max = '500'; cableInput.value = legLen;
      cableInput.addEventListener('input', () => {
        if (!item.legLens) item.legLens = new Array(SPLITTERS[item.type].legs.length).fill(0);
        item.legLens[li] = Math.max(0, parseFloat(cableInput.value) || 0);
        renderTreeDiagram();
      });
      cableInput.addEventListener('change', () => {
        renderSplitterChain();
        renderTreeDiagram();
      });
      const ftSpan = document.createElement('span');
      ftSpan.className = 'sp-leg-unit'; ftSpan.textContent = 'ft';
      cableWrap.appendChild(cableInput);
      cableWrap.appendChild(ftSpan);
      row.appendChild(cableWrap);

      const valsEl = document.createElement('span');
      valsEl.className = 'sp-leg-vals';
      valsEl.innerHTML = `<span class="sp-leg-val">${out42}</span><span class="sp-leg-sep">/</span><span class="sp-leg-val">${out860}</span><span class="sp-leg-unit">dBmV</span>`;
      row.appendChild(valsEl);

      // Only the last splitter's legs get the "connect here" button
      if (idx === splitterChain.length - 1 && pendingFromLeg === null) {
        const btn = document.createElement('button');
        btn.className = 'sp-connect-btn';
        btn.textContent = '+';
        btn.title = 'Connect next splitter here';
        btn.dataset.leg = li;
        btn.addEventListener('click', () => { pendingFromLeg = li; renderSplitterChain(); renderTreeDiagram(); });
        row.appendChild(btn);
      }
      legsEl.appendChild(row);
    });
    block.appendChild(legsEl);
    container.appendChild(block);
  });

  // Type picker (first splitter or after leg selected)
  const showPicker = splitterChain.length === 0 || pendingFromLeg !== null;
  if (showPicker) {
    if (splitterChain.length > 0 && pendingFromLeg !== null) {
      const prompt = document.createElement('div');
      prompt.className = 'sp-prompt';
      prompt.textContent = `Select splitter type for this leg:`;
      container.appendChild(prompt);
    }
    const picker = document.createElement('div');
    picker.className = 'sp-type-picker';
    Object.entries(SPLITTERS).forEach(([key, def]) => {
      const btn = document.createElement('button');
      btn.className = 'sp-type-btn';
      btn.textContent = def.label;
      btn.addEventListener('click', () => {
        splitterChain.push({ type: key, fromLeg: pendingFromLeg, cableLen: 50, cableType: activeCable, legLens: new Array(SPLITTERS[key].legs.length).fill(0), legCableTypes: new Array(SPLITTERS[key].legs.length).fill(activeCable) });
        pendingFromLeg = null;
        renderSplitterChain();
        renderTreeDiagram();
      });
      picker.appendChild(btn);
    });
    container.appendChild(picker);
  } else if (splitterChain.length > 0) {
    // Show "connect to a leg" prompt
    const prompt = document.createElement('div');
    prompt.className = 'sp-prompt';
    prompt.textContent = 'Select a leg above to connect the next splitter, or:';
    container.appendChild(prompt);
    const resetBtn = document.createElement('button');
    resetBtn.className = 'sp-reset-btn';
    resetBtn.textContent = 'Clear chain';
    resetBtn.addEventListener('click', () => { splitterChain = []; pendingFromLeg = null; renderSplitterChain(); renderTreeDiagram(); });
    container.appendChild(resetBtn);
  }

  // Remove button handler
  container.querySelectorAll('.sp-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      splitterChain = splitterChain.slice(0, idx);
      pendingFromLeg = null;
      renderSplitterChain();
      renderTreeDiagram();
    });
  });
}

/* ----------------------------------------------------------
   Signal Path Tree Diagram (interactive canvas)
   ---------------------------------------------------------- */
function renderTreeDiagram() {
  const container = document.getElementById('treeDiagram');
  if (!container) return;

  if (!diagCanvas) {
    diagCanvas = document.createElement('canvas');
    diagCanvas.style.display = 'block';
    container.innerHTML = '';
    container.appendChild(diagCanvas);
    _setupDiagramDrag();
  }

  _drawDiagram();
}

function _drawDiagram() {
  const canvas = diagCanvas;
  if (!canvas) return;

  // Detect narrow containers — switch to vertical layout on mobile
  const container = canvas.parentElement;
  const containerW = container ? container.clientWidth : 600;
  diagVertical = containerW < 540;
  if (diagVertical) { _drawDiagramVertical(); return; }

  const in42  = parseFloat(document.getElementById('sigIn42').value);
  const in860 = parseFloat(document.getElementById('sigIn860').value);
  const in42Str  = isNaN(in42)  ? '—' : String(in42);
  const in860Str = isNaN(in860) ? '—' : String(in860);

  const cs      = getComputedStyle(document.documentElement);
  const accent  = cs.getPropertyValue('--accent').trim();
  const muted   = cs.getPropertyValue('--fg-muted').trim();
  const dim     = cs.getPropertyValue('--fg-dim').trim();
  const hiColor = cs.getPropertyValue('--bg-highlight').trim();
  const border  = cs.getPropertyValue('--border-subtle').trim();
  const cyan    = cs.getPropertyValue('--cyan').trim();

  const dpr = window.devicePixelRatio || 1;

  // ── No splitters yet — always draw source box + hint ───────
  if (splitterChain.length === 0) {
    const W = 340, H = 90;
    canvas.width  = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const sx = 12, sy = (H - 48) / 2;
    ctx.beginPath(); ctx.roundRect(sx, sy, 128, 48, 7);
    ctx.fillStyle = hiColor; ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '400 8px "JetBrains Mono", monospace';
    ctx.fillStyle = muted; ctx.fillText('SOURCE', sx + 64, sy + 14);
    ctx.font = '600 12px "JetBrains Mono", monospace';
    ctx.fillStyle = accent; ctx.fillText(`${in42Str} / ${in860Str}`, sx + 64, sy + 28);
    ctx.font = '400 8px "JetBrains Mono", monospace';
    ctx.fillStyle = muted; ctx.fillText('dBmV', sx + 64, sy + 40);
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.35;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(sx + 128, H / 2); ctx.lineTo(sx + 172, H / 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '400 10px "JetBrains Mono", monospace';
    ctx.fillStyle = muted; ctx.textAlign = 'left';
    ctx.fillText('add a splitter', sx + 136, H / 2);
    ctx.globalAlpha = 1;
    diagBodyRects = [];
    return;
  }

  const computed = computeChain();

  // Layout constants
  const ROW_H    = 48;   // base row height, stretched per-body as needed
  const PAD_X    = 12;
  const SRC_W    = 128;
  const SRC_H    = 48;
  const BODY_W   = 22;
  const BODY_PAD = 10;
  const VAL_W    = 90;
  const VAL_H    = 28;
  const VAL_XOFF = 4;

  const contLegs = splitterChain.map((_, i) =>
    i < splitterChain.length - 1 ? splitterChain[i + 1].fromLeg : -1
  );

  // X positions — free, only MIN_GAP_PX floor so bodies don't literally stack
  const srcRight = PAD_X + SRC_W;
  const barXs = [];
  let curX = srcRight;
  for (let i = 0; i < splitterChain.length; i++) {
    const cLen = splitterChain[i].cableLen ?? 0;
    curX += Math.max(MIN_GAP_PX, cLen * PX_PER_FT);
    barXs.push(curX);
    curX += BODY_W;
  }

  // Per-splitter row height — body stretches when the next body is close (right-to-left).
  // The val box stays at its natural position on its leg; the leg itself moves because
  // the body is taller.
  const rowHs = new Array(splitterChain.length).fill(ROW_H);
  for (let i = splitterChain.length - 2; i >= 0; i--) {
    const item = splitterChain[i];
    const n    = SPLITTERS[item.type].legs.length;
    const cl   = contLegs[i];
    const ref  = cl === -1 ? Math.floor((n - 1) / 2) : cl;

    const nextBodyL = barXs[i + 1];

    // Next body's vertical extent using its (already-computed) stretched rowH
    const nrh   = rowHs[i + 1];
    const nItem = splitterChain[i + 1];
    const nn    = SPLITTERS[nItem.type].legs.length;
    const ncl   = contLegs[i + 1];
    const nref  = ncl === -1 ? Math.floor((nn - 1) / 2) : ncl;
    const nTopRel = (0 - nref) * nrh - BODY_PAD - 32;
    const nBotRel = (nn - 1 - nref) * nrh + BODY_PAD + 4;

    // Check each terminal leg individually — only stretch if THAT leg's val box
    // (accounting for its own legLen) overlaps the next body horizontally
    let needed = ROW_H;
    for (let j = 0; j < n; j++) {
      if (j === cl) continue;
      const offset  = j - ref;
      if (offset === 0) continue;
      const legLen  = item.legLens?.[j] ?? 0;
      const valRight = barXs[i] + BODY_W + VAL_XOFF + 10 + legLen * PX_PER_FT + VAL_W;
      if (valRight <= nextBodyL) continue;   // this leg's val box clears next body
      if (offset > 0) {
        needed = Math.max(needed, (nBotRel + VAL_H / 2 + 6) / offset);
      } else {
        needed = Math.max(needed, (-nTopRel + VAL_H / 2 + 6) / (-offset));
      }
    }
    rowHs[i] = needed;
  }

  // Layouts using per-splitter (possibly stretched) row heights
  const layouts = splitterChain.map((item, i) => {
    const n   = SPLITTERS[item.type].legs.length;
    const cl  = contLegs[i];
    const ref = cl === -1 ? Math.floor((n - 1) / 2) : cl;
    const legYs = Array.from({ length: n }, (_, j) => (j - ref) * rowHs[i]);
    return { legYs, cl, n };
  });

  let minRelY = 0, maxRelY = 0;
  layouts.forEach(l => l.legYs.forEach(y => { minRelY = Math.min(minRelY, y); maxRelY = Math.max(maxRelY, y); }));

  const SPINE_TOP_CLEAR = -minRelY + BODY_PAD + 40;
  const spineAbsY = Math.max(60, SPINE_TOP_CLEAR + 8);

  const minAbsY = spineAbsY + minRelY - BODY_PAD - 40;
  const maxAbsY = spineAbsY + maxRelY + BODY_PAD + VAL_H / 2 + 8;

  const yShift  = Math.max(0, 8 - minAbsY);
  const spineY  = spineAbsY + yShift;
  const canvasH = maxAbsY + yShift + 20;
  let maxRight = curX + PAD_X + 8;
  for (let i = 0; i < splitterChain.length; i++) {
    const { cl, n } = layouts[i];
    for (let j = 0; j < n; j++) {
      if (j === cl && i < splitterChain.length - 1) continue;
      const legLen = splitterChain[i].legLens?.[j] ?? 0;
      maxRight = Math.max(maxRight, barXs[i] + BODY_W + VAL_XOFF + 10 + legLen * PX_PER_FT + VAL_W + PAD_X + 8);
    }
  }
  const canvasW = Math.max(maxRight, 420);

  // Resize canvas
  canvas.width  = canvasW * dpr;
  canvas.height = canvasH * dpr;
  canvas.style.width  = canvasW + 'px';
  canvas.style.height = canvasH + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, canvasW, canvasH);

  // Drawing helpers
  function rr(x, y, w, h, r) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  }
  function dtxt(x, y, str, size, color, align, bold) {
    ctx.font = `${bold ? 600 : 400} ${size}px "JetBrains Mono", monospace`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }
  function dline(x1, y1, x2, y2, color, w, alpha, dash) {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.globalAlpha = alpha;
    if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  // Source box
  const srcX = PAD_X, srcY = spineY - SRC_H / 2;
  rr(srcX, srcY, SRC_W, SRC_H, 7);
  ctx.fillStyle = hiColor; ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.globalAlpha = 1; ctx.stroke();
  dtxt(srcX + SRC_W / 2, srcY + 14, 'SOURCE', 8, muted, 'center', false);
  dtxt(srcX + SRC_W / 2, srcY + 28, `${in42Str} / ${in860Str}`, 12, accent, 'center', true);
  dtxt(srcX + SRC_W / 2, srcY + 40, 'dBmV', 8, muted, 'center', false);

  // Spine → first splitter (cable label goes ABOVE spine to avoid source box overlap)
  dline(srcRight, spineY, barXs[0], spineY, accent, 2.5, 0.9);
  _drawCableLabel(ctx, srcRight, barXs[0], spineY - 13, splitterChain[0].cableLen ?? 0, muted, accent, diagDrag?.idx === 0);

  // Splitters
  diagBodyRects = [];
  diagLegRects  = [];
  for (let i = 0; i < splitterChain.length; i++) {
    const def        = SPLITTERS[splitterChain[i].type];
    const res        = computed ? computed[i] : null;
    const { legYs, cl, n } = layouts[i];
    const barX       = barXs[i];
    const absLegYs   = legYs.map(y => spineY + y);
    const bodyTop    = absLegYs[0] - BODY_PAD;
    const bodyBot    = absLegYs[n - 1] + BODY_PAD;
    const bodyH      = bodyBot - bodyTop;
    const bodyCX     = barX + BODY_W / 2;
    const isDragging = diagDrag?.idx === i;

    diagBodyRects.push({ x: barX, topY: bodyTop, botY: bodyBot });

    // Labels stacked above body
    if (isDragging) dtxt(bodyCX, bodyTop - 40, '◀  ▶', 9, accent, 'center', false);
    dtxt(bodyCX, bodyTop - 27, def.label, 9, isDragging ? accent : muted, 'center', true);
    if (res) dtxt(bodyCX, bodyTop - 14, `in: ${res.in42}/${res.in860} dBmV`, 7.5, muted, 'center', false);

    // Body rect
    rr(barX, bodyTop, BODY_W, bodyH, 4);
    ctx.fillStyle = hiColor; ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = isDragging ? 2.5 : 1.5; ctx.globalAlpha = 0.95; ctx.stroke();
    ctx.globalAlpha = 1;

    // Vertical trunk on right edge of body
    dline(barX + BODY_W, absLegYs[0], barX + BODY_W, absLegYs[n - 1], accent, 2, 0.75);

    // Input stub (left side of body at spine level)
    dline(barX - 2, spineY, barX, spineY, accent, 2.5, 0.9);

    // Port dots
    absLegYs.forEach(ly => {
      ctx.beginPath(); ctx.arc(barX + BODY_W, ly, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = accent; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
    });

    // Legs
    for (let j = 0; j < n; j++) {
      const legDef  = def.legs[j];
      const legRes  = res ? res.legs[j] : null;
      const legAbsY = absLegYs[j];
      const portX   = barX + BODY_W;
      const isCont  = j === cl && i < splitterChain.length - 1;

      if (isCont) {
        // Continuing leg — thick solid line to next body.
        // Cable label goes BELOW the spine so it never clashes with body labels above.
        const nextBarX = barXs[i + 1];
        dline(portX, legAbsY, nextBarX, legAbsY, accent, 2.5, 0.9);
        _drawCableLabel(ctx, portX, nextBarX, spineY + 14, splitterChain[i + 1].cableLen ?? 0, muted, accent, diagDrag?.idx === i + 1);
      } else {
        // Terminal leg — stub then dashed line stretching to val box based on legLen.
        const legLen     = splitterChain[i].legLens?.[j] ?? 0;
        const isDragLeg  = diagLegDrag?.i === i && diagLegDrag?.j === j;
        const stubEnd    = portX + VAL_XOFF;
        const bx         = stubEnd + 10 + Math.max(0, legLen * PX_PER_FT);
        dline(portX, legAbsY, stubEnd, legAbsY, accent, 2, 0.75);
        dline(stubEnd, legAbsY, bx, legAbsY, dim, isDragLeg ? 2 : 1.8, isDragLeg ? 0.9 : 0.6, [4, 3]);
        if (legLen > 0 || isDragLeg) {
          _drawCableLabel(ctx, stubEnd, bx, legAbsY + 9, legLen, muted, accent, isDragLeg);
        }
        diagLegRects.push({ i, j, x: bx, y: legAbsY - VAL_H / 2, w: VAL_W, h: VAL_H });
        rr(bx, legAbsY - VAL_H / 2, VAL_W, VAL_H, 5);
        ctx.fillStyle = hiColor; ctx.fill();
        ctx.strokeStyle = isDragLeg ? accent : border;
        ctx.lineWidth = isDragLeg ? 2 : 1.2; ctx.stroke();
        if (isDragLeg) {
          dtxt(bx + VAL_W / 2, legAbsY, '◀  ▶', 9, accent, 'center', false);
        } else {
          dtxt(bx + VAL_W / 2, legAbsY - 7, legDef.label, 7, muted, 'center', false);
          dtxt(bx + VAL_W / 2, legAbsY + 7, legRes ? `${legRes.out42}/${legRes.out860} dBmV` : '—', 8.5, cyan, 'center', true);
        }
      }
    }
  }
}

function _drawDiagramVertical() {
  const canvas = diagCanvas;
  if (!canvas) return;

  const container = canvas.parentElement;
  const containerW = container ? Math.max(280, container.clientWidth) : 320;

  const in42     = parseFloat(document.getElementById('sigIn42').value);
  const in860    = parseFloat(document.getElementById('sigIn860').value);
  const in42Str  = isNaN(in42)  ? '—' : String(in42);
  const in860Str = isNaN(in860) ? '—' : String(in860);

  const cs      = getComputedStyle(document.documentElement);
  const accent  = cs.getPropertyValue('--accent').trim();
  const muted   = cs.getPropertyValue('--fg-muted').trim();
  const dim     = cs.getPropertyValue('--fg-dim').trim();
  const hiColor = cs.getPropertyValue('--bg-highlight').trim();
  const border  = cs.getPropertyValue('--border-subtle').trim();
  const cyan    = cs.getPropertyValue('--cyan').trim();
  const dpr     = window.devicePixelRatio || 1;

  const computed = computeChain();

  // Layout constants
  const PAD_Y    = 10;
  const PAD_X    = 8;
  const SRC_W    = Math.min(130, containerW - 24);
  const SRC_H    = 44;
  const SPINE_X  = 18;         // vertical spine x
  const BODY_W   = 14;         // body width (narrow vertical bar)
  const BODY_PAD = 8;
  const LEG_GAP  = 34;         // vertical spacing between legs
  const VAL_W    = Math.min(100, containerW - SPINE_X - 7 - 4 - 8 - PAD_X - 4);
  const VAL_H    = 26;
  const PORT_X   = SPINE_X + BODY_W / 2;   // port dot x
  const LEG_START_X = PORT_X + 4;          // where terminal legs begin
  const MAX_LEG_PX = containerW - LEG_START_X - 8 - VAL_W - PAD_X;

  diagBodyRects = [];
  diagLegRects  = [];

  // ── No splitters yet ───────────────────────────────────────────
  if (splitterChain.length === 0) {
    const W = containerW, H = 100;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    // Source box
    const sx = PAD_X, sy = PAD_Y;
    ctx.beginPath(); ctx.roundRect(sx, sy, SRC_W, SRC_H, 7);
    ctx.fillStyle = hiColor; ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '400 8px "JetBrains Mono", monospace';
    ctx.fillStyle = muted; ctx.fillText('SOURCE', sx + SRC_W / 2, sy + 12);
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.fillStyle = accent; ctx.fillText(`${in42Str} / ${in860Str}`, sx + SRC_W / 2, sy + 26);
    ctx.font = '400 8px "JetBrains Mono", monospace';
    ctx.fillStyle = muted; ctx.fillText('dBmV', sx + SRC_W / 2, sy + 38);
    // Dashed line downward + hint
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.35;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(SPINE_X, sy + SRC_H); ctx.lineTo(SPINE_X, sy + SRC_H + 36); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.font = '400 10px "JetBrains Mono", monospace';
    ctx.fillStyle = muted; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('add a splitter', SPINE_X + 8, sy + SRC_H + 18);
    return;
  }

  // ── Compute splitter positions ─────────────────────────────────
  const contLegs = splitterChain.map((_, i) =>
    i < splitterChain.length - 1 ? splitterChain[i + 1].fromLeg : -1
  );

  const splitterInfos = [];
  let curY = PAD_Y + SRC_H + 6;   // spine starts below source box

  for (let i = 0; i < splitterChain.length; i++) {
    const item = splitterChain[i];
    const def  = SPLITTERS[item.type];
    const n    = def.legs.length;
    const cl   = contLegs[i];
    const cLen = item.cableLen ?? 0;

    const bodyTop = curY + Math.max(MIN_GAP_PX, cLen * PX_PER_FT);
    const legYs   = Array.from({ length: n }, (_, j) => bodyTop + BODY_PAD + j * LEG_GAP);
    const bodyBot = legYs[n - 1] + BODY_PAD;

    splitterInfos.push({ bodyTop, bodyBot, legYs, cl, n });
    curY = bodyBot + 4;
  }

  const canvasH = curY + PAD_Y + 10;
  const canvasW = containerW;

  canvas.width  = canvasW * dpr;
  canvas.height = canvasH * dpr;
  canvas.style.width  = canvasW + 'px';
  canvas.style.height = canvasH + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, canvasW, canvasH);

  // Drawing helpers
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function dtxt(x, y, str, size, color, align, bold) {
    ctx.font = `${bold ? 600 : 400} ${size}px "JetBrains Mono", monospace`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }
  function dline(x1, y1, x2, y2, color, w, alpha, dash) {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.globalAlpha = alpha;
    if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  // Source box
  const srcX = PAD_X, srcY = PAD_Y;
  rr(srcX, srcY, SRC_W, SRC_H, 7);
  ctx.fillStyle = hiColor; ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.globalAlpha = 1; ctx.stroke();
  dtxt(srcX + SRC_W / 2, srcY + 12, 'SOURCE', 8, muted, 'center', false);
  dtxt(srcX + SRC_W / 2, srcY + 26, `${in42Str} / ${in860Str}`, 11, accent, 'center', true);
  dtxt(srcX + SRC_W / 2, srcY + 38, 'dBmV', 8, muted, 'center', false);

  // Spine from source → first body
  const firstBodyTop = splitterInfos[0].bodyTop;
  dline(SPINE_X, srcY + SRC_H, SPINE_X, firstBodyTop, accent, 2.5, 0.9);
  _drawCableLabelV(ctx, srcY + SRC_H, firstBodyTop, SPINE_X + 8,
    splitterChain[0].cableLen ?? 0, muted, accent, diagDrag?.idx === 0);

  // Draw each splitter
  for (let i = 0; i < splitterChain.length; i++) {
    const { bodyTop, bodyBot, legYs, cl, n } = splitterInfos[i];
    const item       = splitterChain[i];
    const def        = SPLITTERS[item.type];
    const res        = computed ? computed[i] : null;
    const isDragging = diagDrag?.idx === i;

    diagBodyRects.push({ x: SPINE_X, topY: bodyTop, botY: bodyBot });

    // Body (vertical bar on spine)
    rr(SPINE_X - BODY_W / 2, bodyTop, BODY_W, bodyBot - bodyTop, 4);
    ctx.fillStyle = hiColor; ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = isDragging ? 2.5 : 1.5; ctx.globalAlpha = 0.95; ctx.stroke();
    ctx.globalAlpha = 1;

    // Label right of body
    const lx = SPINE_X + BODY_W / 2 + 6;
    const ly = (bodyTop + bodyBot) / 2;
    if (isDragging) {
      dtxt(lx, ly - 12, '▲  ▼', 9, accent, 'left', false);
      dtxt(lx, ly + 2,  def.label, 8, accent, 'left', true);
    } else {
      dtxt(lx, ly - (res ? 5 : 0), def.label, 8, muted, 'left', true);
      if (res) dtxt(lx, ly + 8, `${res.in42}/${res.in860} dBmV`, 7, muted, 'left', false);
    }

    // Vertical trunk on right side of body connecting all port dots
    if (n > 1) dline(PORT_X, legYs[0], PORT_X, legYs[n - 1], accent, 2, 0.75);

    // Port dots
    legYs.forEach(ly => {
      ctx.beginPath(); ctx.arc(PORT_X, ly, 3, 0, Math.PI * 2);
      ctx.fillStyle = accent; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
    });

    // Legs
    for (let j = 0; j < n; j++) {
      const legAbsY   = legYs[j];
      const isCont    = j === cl && i < splitterChain.length - 1;
      const legDef    = def.legs[j];
      const legRes    = res ? res.legs[j] : null;
      const isDragLeg = diagLegDrag?.i === i && diagLegDrag?.j === j;

      if (isCont) {
        // Continuing leg: tiny right stub just to show port, spine continues below body
        dline(PORT_X, legAbsY, PORT_X + 6, legAbsY, accent, 2, 0.5);
      } else {
        // Terminal leg: stub right then dashed line to val box
        const legLen = item.legLens?.[j] ?? 0;
        const legPx  = Math.min(legLen * PX_PER_FT, MAX_LEG_PX);
        const stubEnd = LEG_START_X;
        const bx      = stubEnd + 6 + Math.max(0, legPx);

        dline(PORT_X, legAbsY, stubEnd, legAbsY, accent, 2, 0.75);
        dline(stubEnd, legAbsY, bx, legAbsY, dim, isDragLeg ? 2 : 1.8, isDragLeg ? 0.9 : 0.6, [4, 3]);

        if (legLen > 0 || isDragLeg) {
          ctx.font = `${isDragLeg ? 700 : 400} 7.5px "JetBrains Mono", monospace`;
          ctx.fillStyle = isDragLeg ? accent : muted;
          ctx.globalAlpha = isDragLeg ? 1 : 0.55;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(`${legLen} ft`, (stubEnd + bx) / 2, legAbsY - 8);
          ctx.globalAlpha = 1;
        }

        diagLegRects.push({ i, j, x: bx, y: legAbsY - VAL_H / 2, w: VAL_W, h: VAL_H });
        rr(bx, legAbsY - VAL_H / 2, VAL_W, VAL_H, 5);
        ctx.fillStyle = hiColor; ctx.fill();
        ctx.strokeStyle = isDragLeg ? accent : border;
        ctx.lineWidth = isDragLeg ? 2 : 1.2; ctx.stroke();

        if (isDragLeg) {
          dtxt(bx + VAL_W / 2, legAbsY, '◀  ▶', 9, accent, 'center', false);
        } else {
          dtxt(bx + VAL_W / 2, legAbsY - 7, legDef.label, 6.5, muted, 'center', false);
          dtxt(bx + VAL_W / 2, legAbsY + 7, legRes ? `${legRes.out42}/${legRes.out860} dBmV` : '—', 8, cyan, 'center', true);
        }
      }
    }

    // Spine continues from body bottom to next splitter
    if (i < splitterChain.length - 1) {
      const nextBodyTop = splitterInfos[i + 1].bodyTop;
      dline(SPINE_X, bodyBot, SPINE_X, nextBodyTop, accent, 2.5, 0.9);
      _drawCableLabelV(ctx, bodyBot, nextBodyTop, SPINE_X + 8,
        splitterChain[i + 1].cableLen ?? 0, muted, accent, diagDrag?.idx === i + 1);
    }
  }
}

function _drawCableLabelV(ctx, y1, y2, x, cableLen, muted, accent, isActive) {
  const midY = (y1 + y2) / 2;
  ctx.font = `${isActive ? 700 : 400} 8px "JetBrains Mono", monospace`;
  ctx.fillStyle = isActive ? accent : muted;
  ctx.globalAlpha = isActive ? 1 : 0.55;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(`${cableLen} ft`, x, midY);
  ctx.globalAlpha = 1;
}

function _drawCableLabel(ctx, x1, x2, y, cableLen, muted, accent, isActive) {
  const midX = (x1 + x2) / 2;
  ctx.font = `${isActive ? 700 : 400} 8px "JetBrains Mono", monospace`;
  ctx.fillStyle = isActive ? accent : muted;
  ctx.globalAlpha = isActive ? 1 : 0.55;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(`${cableLen} ft`, midX, y);
  ctx.globalAlpha = 1;
}

function _setupDiagramDrag() {
  const canvas = diagCanvas;
  if (!canvas) return;

  // On touch devices use a larger hit pad so small elements are easier to tap
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  const HIT_PAD = isTouch ? 12 : 4;

  function bodyHitTest(mx, my) {
    for (let i = 0; i < diagBodyRects.length; i++) {
      const r = diagBodyRects[i];
      if (diagVertical) {
        // In vertical mode body is at r.x ± 7 (BODY_W/2), spanning topY–botY
        if (mx >= r.x - 10 - HIT_PAD && mx <= r.x + 10 + HIT_PAD &&
            my >= r.topY - HIT_PAD   && my <= r.botY + HIT_PAD) return i;
      } else {
        if (mx >= r.x - HIT_PAD && mx <= r.x + 22 + HIT_PAD &&
            my >= r.topY - HIT_PAD && my <= r.botY + HIT_PAD) return i;
      }
    }
    return -1;
  }
  function legHitTest(mx, my) {
    for (const r of diagLegRects) {
      if (mx >= r.x - HIT_PAD && mx <= r.x + r.w + HIT_PAD &&
          my >= r.y - HIT_PAD && my <= r.y + r.h + HIT_PAD) return r;
    }
    return null;
  }
  function canvasXY(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const lw = canvas.width / (window.devicePixelRatio || 1);
    const lh = canvas.height / (window.devicePixelRatio || 1);
    return [(clientX - rect.left) / rect.width * lw,
            (clientY - rect.top)  / rect.height * lh];
  }
  function commitDrag() {
    diagDrag = null; diagLegDrag = null;
    renderSplitterChain();
    updateSignalLevels();
    _drawDiagram();
  }

  canvas.addEventListener('mousedown', e => {
    const [mx, my] = canvasXY(e.clientX, e.clientY);
    const bi = bodyHitTest(mx, my);
    if (bi >= 0) {
      diagDrag = { idx: bi, startX: mx, startY: my, startLen: splitterChain[bi].cableLen ?? 0 };
      canvas.style.cursor = diagVertical ? 'ns-resize' : 'ew-resize';
      e.preventDefault(); return;
    }
    const lr = legHitTest(mx, my);
    if (lr) {
      const startLen = splitterChain[lr.i].legLens?.[lr.j] ?? 0;
      diagLegDrag = { i: lr.i, j: lr.j, startX: mx, startLen };
      canvas.style.cursor = 'ew-resize';
      e.preventDefault();
    }
  });

  canvas.addEventListener('mousemove', e => {
    if (diagDrag || diagLegDrag) return;
    const [mx, my] = canvasXY(e.clientX, e.clientY);
    const hit = bodyHitTest(mx, my) >= 0 || legHitTest(mx, my);
    canvas.style.cursor = hit ? (diagVertical ? 'ns-resize' : 'ew-resize') : 'default';
  });

  window.addEventListener('mousemove', e => {
    if (diagDrag) {
      const [mx, my] = canvasXY(e.clientX, e.clientY);
      const delta = diagVertical ? (my - diagDrag.startY) : (mx - diagDrag.startX);
      const newLen = Math.round(Math.max(0, Math.min(MAX_CABLE, diagDrag.startLen + delta / PX_PER_FT)));
      splitterChain[diagDrag.idx].cableLen = newLen;
      _drawDiagram(); return;
    }
    if (diagLegDrag) {
      const [mx] = canvasXY(e.clientX, e.clientY);
      const newLen = Math.round(Math.max(0, Math.min(500, diagLegDrag.startLen + (mx - diagLegDrag.startX) / PX_PER_FT)));
      if (!splitterChain[diagLegDrag.i].legLens) splitterChain[diagLegDrag.i].legLens = [];
      splitterChain[diagLegDrag.i].legLens[diagLegDrag.j] = newLen;
      _drawDiagram();
    }
  });

  window.addEventListener('mouseup', () => {
    if (diagDrag || diagLegDrag) commitDrag();
  });

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const [mx, my] = canvasXY(e.touches[0].clientX, e.touches[0].clientY);
    const bi = bodyHitTest(mx, my);
    if (bi >= 0) {
      diagDrag = { idx: bi, startX: mx, startY: my, startLen: splitterChain[bi].cableLen ?? 0 };
      return;
    }
    const lr = legHitTest(mx, my);
    if (lr) diagLegDrag = { i: lr.i, j: lr.j, startX: mx, startLen: splitterChain[lr.i].legLens?.[lr.j] ?? 0 };
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    if (!diagDrag && !diagLegDrag) return;
    e.preventDefault();
    const [mx, my] = canvasXY(e.touches[0].clientX, e.touches[0].clientY);
    if (diagDrag) {
      const delta = diagVertical ? (my - diagDrag.startY) : (mx - diagDrag.startX);
      splitterChain[diagDrag.idx].cableLen = Math.round(Math.max(0, Math.min(MAX_CABLE, diagDrag.startLen + delta / PX_PER_FT)));
    } else {
      if (!splitterChain[diagLegDrag.i].legLens) splitterChain[diagLegDrag.i].legLens = [];
      splitterChain[diagLegDrag.i].legLens[diagLegDrag.j] = Math.round(Math.max(0, Math.min(500, diagLegDrag.startLen + (mx - diagLegDrag.startX) / PX_PER_FT)));
    }
    _drawDiagram();
  }, { passive: false });

  canvas.addEventListener('touchend', () => {
    if (diagDrag || diagLegDrag) commitDrag();
  });
}

/* ----------------------------------------------------------
   Theme Toggle
   ---------------------------------------------------------- */
function toggleTheme() {
  const html = document.documentElement;
  const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
  html.dataset.theme = next;
  localStorage.setItem('tokyoNightTheme', next);
}

function restoreTheme() {
  const saved = localStorage.getItem('tokyoNightTheme');
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.dataset.theme = saved;
  }
}

/* ----------------------------------------------------------
   Cable button active state
   ---------------------------------------------------------- */
function setActiveCable(cable) {
  activeCable = cable;
  document.querySelectorAll('.cable-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cable === cable);
  });
  updateResults();
}

/* ----------------------------------------------------------
   Init
   ---------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  restoreTheme();

  /* Tab navigation */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === target);
        b.setAttribute('aria-selected', b.dataset.tab === target);
      });
      document.querySelectorAll('.tab-page').forEach(page => {
        page.hidden = page.id !== `page-${target}`;
      });
      // Redraw diagram when switching to splitter tab so canvas sizes correctly
      if (target === 'splitter') renderTreeDiagram();
    });
  });

  /* Cable buttons */
  document.querySelectorAll('.cable-btn').forEach(btn => {
    btn.addEventListener('click', () => setActiveCable(btn.dataset.cable));
  });

  const lengthInput        = document.getElementById('lengthInput');
  const sketchLengthSlider = document.getElementById('sketchLength');
  const sketchLengthVal    = document.getElementById('sketchLengthVal');

  /* Length input — clamp to 600, sync to slider */
  lengthInput.addEventListener('input', () => {
    let ft = parseFloat(lengthInput.value);
    if (!isNaN(ft) && ft > 0) {
      if (ft > 600) {
        ft = 600;
        lengthInput.value = 600;
      }
      sketchLengthSlider.value = ft;
      sketchLengthVal.textContent = ft + ' ft';
    }
    updateResults();
  });

  /* Signal level inputs */
  function clampSigInput(el) {
    const v = parseFloat(el.value);
    if (!isNaN(v) && v > 30) el.value = 30;
    updateSignalLevels();
  }
  document.getElementById('sigIn42').addEventListener('input',  () => clampSigInput(document.getElementById('sigIn42')));
  document.getElementById('sigIn860').addEventListener('input', () => clampSigInput(document.getElementById('sigIn860')));

  /* Preset length buttons */
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      lengthInput.value = btn.dataset.length;
      lengthInput.dispatchEvent(new Event('input'));
    });
  });

  /* Custom spin buttons */
  function nudge(delta) {
    const val = Math.min(600, Math.max(1, (parseFloat(lengthInput.value) || 0) + delta));
    lengthInput.value = val;
    lengthInput.dispatchEvent(new Event('input'));
  }
  document.getElementById('decrementBtn').addEventListener('click', () => nudge(-1));
  document.getElementById('incrementBtn').addEventListener('click', () => nudge(1));

  /* Theme toggle */
  document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

  /* Length slider — drives cable length calculation */
  sketchLengthSlider.addEventListener('input', () => {
    const ft = parseInt(sketchLengthSlider.value, 10);
    lengthInput.value = ft;
    sketchLengthVal.textContent = ft + ' ft';
    updateResults();
  });

  /* Redraw diagram on resize so vertical/horizontal mode switches correctly */
  window.addEventListener('resize', () => {
    if (diagCanvas) _drawDiagram();
  });

  /* Initial render */
  setActiveCable('RG-59');
  updateResults();
  renderSplitterChain();
});

/* ----------------------------------------------------------
   Cable Dude Animation
   ---------------------------------------------------------- */
(function () {
  const canvas = document.getElementById('cableDudeCanvas');
  if (!canvas) return;

  const ctx   = canvas.getContext('2d');
  canvas.height = 110;

  const SPEEDS = { 'RG-59': 260, 'RG-6': 200, 'RG-11': 140 };
  const PAD_L = 28;   // left padding (wall plate anchor)
  const PAD_R = 14;   // right padding

  let currentFt  = 100;
  let targetFt   = 100;
  let currentX   = 0;
  let initialized = false;
  let dir        = 1;   // 1 = right, -1 = left
  let dist       = 0;   // accumulated travel for walk cycle
  let lastTs     = null;
  let easterEgg      = false;
  let dudeClickCount = 0;

  function trackW() {
    return Math.max(1, canvas.width - PAD_L - PAD_R);
  }

  function ftToX(ft) {
    return PAD_L + ((Math.max(1, Math.min(600, ft)) - 1) / 599) * trackW();
  }

  function setTarget(ft) {
    targetFt = Math.max(1, Math.min(600, +ft || 1));
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ---- Backgrounds ---- */
  function drawBg(W, H, gY) {
    const isDark = document.documentElement.dataset.theme === 'dark';
    if (isDark)         drawNightBg(W, H, gY);
    else if (easterEgg) drawUnderwaterBg(W, H, gY);
    else                drawDayBg(W, H, gY);
  }

  function drawDayBg(W, H, gY) {
    // Open sky gradient
    const skyG = ctx.createLinearGradient(0, 0, 0, gY);
    skyG.addColorStop(0, '#4a9ec9');
    skyG.addColorStop(1, '#8ecfea');
    ctx.fillStyle = skyG;
    ctx.fillRect(0, 0, W, gY);

    // Sun (top-right)
    ctx.fillStyle = 'rgba(255,224,0,0.20)';
    ctx.beginPath(); ctx.arc(W - 26, 16, 20, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe000';
    ctx.beginPath(); ctx.arc(W - 26, 16, 12, 0, Math.PI * 2); ctx.fill();

    // Clouds at stable fractional x positions
    drawCloud(W * 0.14, 18, 0.88);
    drawCloud(W * 0.46, 12, 0.72);
    drawCloud(W * 0.73, 20, 0.95);

    // Concrete sidewalk
    const conG = ctx.createLinearGradient(0, gY, 0, H);
    conG.addColorStop(0, '#c4c1bc');
    conG.addColorStop(1, '#b2afaa');
    ctx.fillStyle = conG;
    ctx.fillRect(0, gY, W, H - gY);

    // Slab seam lines
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let sx = 80; sx < W; sx += 100) {
      ctx.moveTo(sx, gY); ctx.lineTo(sx, H);
    }
    ctx.stroke();
  }

  function drawNightBg(W, H, gY) {
    // Night sky gradient
    const skyG = ctx.createLinearGradient(0, 0, 0, gY);
    skyG.addColorStop(0, '#07091a');
    skyG.addColorStop(1, '#141629');
    ctx.fillStyle = skyG;
    ctx.fillRect(0, 0, W, gY);

    // Stars (stable fractional positions)
    const STARS = [
      [0.04,0.10],[0.11,0.28],[0.18,0.08],[0.26,0.45],[0.33,0.15],
      [0.41,0.32],[0.50,0.07],[0.57,0.55],[0.63,0.20],[0.72,0.40],
      [0.79,0.10],[0.86,0.30],[0.92,0.15],[0.97,0.50],[0.08,0.60],
      [0.44,0.65],[0.68,0.60],[0.30,0.70],
    ];
    STARS.forEach(([fx, fy], i) => {
      const r = i % 3 === 0 ? 1.5 : 1;
      ctx.fillStyle = i % 5 === 0 ? 'rgba(200,210,255,0.9)' : 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.arc(fx * W, fy * gY, r, 0, Math.PI * 2); ctx.fill();
    });

    // Moon with glow and craters
    const mx = W - 32, my = 20, mr = 13;
    ctx.fillStyle = 'rgba(232,228,188,0.18)';
    ctx.beginPath(); ctx.arc(mx, my, mr + 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8e4bc';
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.beginPath(); ctx.arc(mx - 4, my + 3,  3,   0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + 4, my - 4,  2,   0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + 1, my + 5,  1.5, 0, Math.PI * 2); ctx.fill();

    // Warm ambient street-light glow on horizon
    const glowX = W * 0.78;
    const glow  = ctx.createRadialGradient(glowX, gY, 0, glowX, gY, W * 0.45);
    glow.addColorStop(0, 'rgba(255,185,75,0.15)');
    glow.addColorStop(1, 'rgba(255,185,75,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, gY);

    // Dark asphalt ground (gY → H)
    const ashG = ctx.createLinearGradient(0, gY, 0, H);
    ashG.addColorStop(0, '#1e1f2e');
    ashG.addColorStop(1, '#161720');
    ctx.fillStyle = ashG;
    ctx.fillRect(0, gY, W, H - gY);

    // Faint seam lines on asphalt
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let sx = 80; sx < W; sx += 100) {
      ctx.moveTo(sx, gY); ctx.lineTo(sx, H);
    }
    ctx.stroke();
  }

  /* ---- Cloud helper (day mode) ---- */
  function drawCloud(cx, cy, s) {
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    [[0,0,12],[-14,7,9],[14,7,9],[-6,11,10],[7,11,10],[0,14,8]].forEach(([dx, dy, r]) => {
      ctx.beginPath();
      ctx.arc(cx + dx * s, cy + dy * s, r * s, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /* ---- Utility poles ---- */
  function drawPoles(W, H, gY) {
    const isDark     = document.documentElement.dataset.theme === 'dark';
    const poleCol    = isDark ? '#1e2030' : '#7a6550';
    const armCol     = isDark ? '#252740' : '#6a5540';
    const insulCol   = isDark ? '#414868' : '#a08060';
    const wireCol    = isDark ? 'rgba(130,140,180,0.55)' : 'rgba(80,60,40,0.45)';
    const comWireCol = isDark ? 'rgba(100,120,160,0.40)' : 'rgba(100,80,50,0.35)';

    const POLE_FXS = [0.15, 0.38, 0.61, 0.84];
    const poleH    = Math.round(gY * 0.62); // how tall above ground
    const armHW    = 12;                    // half-width of crossarm

    // pre-compute pole tops
    const poles = POLE_FXS.map(fx => ({ x: Math.round(fx * W), topY: gY - poleH }));

    // --- power wire (top, at crossarm level) ---
    ctx.strokeStyle = wireCol;
    ctx.lineWidth   = 1;
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    for (let i = 0; i < poles.length - 1; i++) {
      const p1 = poles[i], p2 = poles[i + 1];
      const wY  = p1.topY + 5;
      const midX = (p1.x + p2.x) / 2;
      ctx.beginPath();
      ctx.moveTo(p1.x, wY);
      ctx.quadraticCurveTo(midX, wY + 7, p2.x, wY);
      ctx.stroke();
    }

    // --- communication line (lower, below crossarm) ---
    ctx.strokeStyle = comWireCol;
    ctx.lineWidth   = 0.8;
    for (let i = 0; i < poles.length - 1; i++) {
      const p1 = poles[i], p2 = poles[i + 1];
      const wY  = p1.topY + 18;
      const midX = (p1.x + p2.x) / 2;
      ctx.beginPath();
      ctx.moveTo(p1.x, wY);
      ctx.quadraticCurveTo(midX, wY + 9, p2.x, wY);
      ctx.stroke();
    }

    // --- draw each pole ---
    poles.forEach(({ x, topY }) => {
      // shaft
      ctx.strokeStyle = poleCol;
      ctx.lineWidth   = 3;
      ctx.lineCap     = 'butt';
      ctx.beginPath();
      ctx.moveTo(x, gY + 2);
      ctx.lineTo(x, topY);
      ctx.stroke();

      // crossarm
      ctx.strokeStyle = armCol;
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(x - armHW, topY + 4);
      ctx.lineTo(x + armHW, topY + 4);
      ctx.stroke();

      // vertical brace under crossarm
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, topY + 4);
      ctx.lineTo(x - armHW + 4, topY + 10);
      ctx.moveTo(x, topY + 4);
      ctx.lineTo(x + armHW - 4, topY + 10);
      ctx.stroke();

      // insulators on crossarm tips and centre
      ctx.fillStyle = insulCol;
      [-armHW, 0, armHW].forEach(ox => {
        ctx.beginPath();
        ctx.arc(x + ox, topY + 4, 2, 0, Math.PI * 2);
        ctx.fill();
      });

      // night: warm glow from lamp cap
      if (isDark) {
        const glow = ctx.createRadialGradient(x, topY - 2, 0, x, topY - 2, 18);
        glow.addColorStop(0, 'rgba(255,200,80,0.18)');
        glow.addColorStop(1, 'rgba(255,200,80,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, topY - 2, 18, 0, Math.PI * 2);
        ctx.fill();
        // small lamp cap
        ctx.fillStyle = '#e8c060';
        ctx.fillRect(x - 3, topY - 5, 6, 3);
      }
    });
  }

  /* ---- Sea flower helper (easter egg) ---- */
  function drawSeaFlower(cx, cy, petalColor, s) {
    ctx.fillStyle = petalColor;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * 7 * s, cy + Math.sin(a) * 7 * s, 5 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    // Centre
    ctx.fillStyle = '#ffe840';
    ctx.beginPath(); ctx.arc(cx, cy, 4 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(cx - s, cy - s, 1.5 * s, 0, Math.PI * 2); ctx.fill();
  }

  /* ---- Underwater background (easter egg) ---- */
  function drawUnderwaterBg(W, H, gY) {
    // Water gradient
    const waterG = ctx.createLinearGradient(0, 0, 0, gY);
    waterG.addColorStop(0, '#0b4f7a');
    waterG.addColorStop(1, '#0d8fc4');
    ctx.fillStyle = waterG;
    ctx.fillRect(0, 0, W, gY);

    // Caustic light shafts
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = '#ffffff';
    [[0.1, 0.3], [0.35, 0.5], [0.55, 0.2], [0.78, 0.4]].forEach(([fx, fw]) => {
      ctx.beginPath();
      ctx.moveTo(fx * W - fw * 20, 0);
      ctx.lineTo(fx * W + fw * 20, 0);
      ctx.lineTo(fx * W + fw * 40, gY);
      ctx.lineTo(fx * W - fw * 40, gY);
      ctx.fill();
    });
    ctx.restore();

    // Floating flower clouds
    const FLOWERS = [
      [0.10, 0.22, '#ff8fab', 1.0],
      [0.28, 0.48, '#ffa07a', 0.80],
      [0.44, 0.14, '#c77dff', 0.90],
      [0.60, 0.38, '#ff6b9d', 0.75],
      [0.76, 0.18, '#fdcb6e', 0.85],
      [0.88, 0.50, '#74b9ff', 0.70],
      [0.05, 0.60, '#55efc4', 0.65],
      [0.50, 0.62, '#ff9ff3', 0.60],
    ];
    FLOWERS.forEach(([fx, fy, col, s]) => {
      drawSeaFlower(fx * W, fy * gY, col, s);
    });

    // Bubbles
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth   = 1;
    [[0.18,0.32],[0.37,0.58],[0.53,0.42],[0.71,0.25],[0.85,0.65]].forEach(([fx,fy]) => {
      ctx.beginPath(); ctx.arc(fx * W, fy * gY, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(fx * W - 1, fy * gY - 1, 1, 0, Math.PI * 2); // shine
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
    });

    // Sandy seafloor
    const sandG = ctx.createLinearGradient(0, gY, 0, H);
    sandG.addColorStop(0, '#e8c87a');
    sandG.addColorStop(1, '#c8a050');
    ctx.fillStyle = sandG;
    ctx.fillRect(0, gY, W, H - gY);

    // Sand ripples
    ctx.strokeStyle = 'rgba(160,110,30,0.28)';
    ctx.lineWidth   = 1;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    for (let sx = 20; sx < W; sx += 55) {
      ctx.moveTo(sx, gY + 5); ctx.lineTo(sx + 28, gY + 5);
    }
    ctx.stroke();
  }

  /* ---- Main loop ---- */
  function tick(ts) {
    // Sync canvas pixel width to its CSS width
    const w = Math.max(200, (canvas.parentElement.clientWidth || 400) - 2);
    if (canvas.width !== w) {
      canvas.width = w;
      if (initialized) currentX = ftToX(currentFt);
    }

    if (!initialized) {
      currentX    = ftToX(currentFt);
      initialized = true;
    }

    if (!lastTs) lastTs = ts;
    const dt   = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;

    const tx   = ftToX(targetFt);
    const diff = tx - currentX;
    const isMoving = Math.abs(diff) > 0.3;

    if (isMoving) {
      dir = Math.sign(diff);
      const step = Math.min(SPEEDS[activeCable] * dt, Math.abs(diff));
      currentX  += dir * step;
      dist      += step;
      currentFt  = 1 + ((currentX - PAD_L) / trackW()) * 599;
    }

    drawScene(isMoving);
    requestAnimationFrame(tick);
  }

  /* ---- Scene ---- */
  function drawScene(isMoving) {
    const W  = canvas.width;
    const H  = canvas.height;
    const gY = H - 20;
    const frame = isMoving ? Math.floor(dist / 11) % 2 : 0;

    ctx.clearRect(0, 0, W, H);
    drawBg(W, H, gY);
    drawPoles(W, H, gY);

    /* dashed ground track */
    ctx.save();
    ctx.strokeStyle = cssVar('--border-subtle');
    ctx.lineWidth   = 1;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.moveTo(PAD_L, gY);
    ctx.lineTo(W - PAD_R, gY);
    ctx.stroke();
    ctx.restore();

    /* 1000 ft end marker */
    ctx.strokeStyle = cssVar('--border');
    ctx.lineWidth   = 1.5;
    ctx.lineCap     = 'butt';
    ctx.beginPath();
    ctx.moveTo(W - PAD_R, gY - 7);
    ctx.lineTo(W - PAD_R, gY + 5);
    ctx.stroke();

    /* wall plate (left anchor) */
    ctx.fillStyle   = cssVar('--bg-highlight');
    ctx.strokeStyle = cssVar('--border');
    ctx.lineWidth   = 1;
    ctx.fillRect(PAD_L - 11, gY - 18, 11, 22);
    ctx.strokeRect(PAD_L - 11, gY - 18, 11, 22);
    /* connector nub */
    ctx.fillStyle = cssVar('--fg-muted');
    ctx.fillRect(PAD_L - 3, gY - 6, 5, 8);

    /* cable on ground (wall anchor → character feet) */
    if (currentX > PAD_L + 3) {
      const cableSize = activeCable === 'RG-11' ? 'large' : activeCable === 'RG-6' ? 'medium' : 'small';
      const shadowW   = cableSize === 'large' ? 10 : cableSize === 'medium' ? 7 : 4;
      const jacketW   = cableSize === 'large' ?  9 : cableSize === 'medium' ? 6 : 3;
      const hlW       = cableSize === 'large' ?  2 : cableSize === 'medium' ? 1.5 : 1;
      /* shadow */
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth   = shadowW;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(PAD_L, gY + 1);
      ctx.lineTo(currentX - 3, gY + 1);
      ctx.stroke();
      /* outer jacket */
      ctx.strokeStyle = '#353a52';
      ctx.lineWidth   = jacketW;
      ctx.beginPath();
      ctx.moveTo(PAD_L, gY - 2);
      ctx.lineTo(currentX - 3, gY - 2);
      ctx.stroke();
      /* highlight stripe */
      ctx.strokeStyle = 'rgba(169,177,214,0.2)';
      ctx.lineWidth   = hlW;
      ctx.beginPath();
      ctx.moveTo(PAD_L, gY - 4);
      ctx.lineTo(currentX - 3, gY - 4);
      ctx.stroke();
    }

    if (document.documentElement.dataset.theme === 'dark') easterEgg = false;
    const struggling = activeCable === 'RG-11' && isMoving;
    if (easterEgg) drawSpongeDude(currentX, gY, dir, frame, isMoving);
    else           drawDude(currentX, gY, dir, frame, isMoving, struggling);
  }

  /* ---- Character ---- */
  function drawDude(x, gY, d, frame, moving, struggling) {
    const SKIN  = '#dbb889';
    const HAT   = '#e8e8e8';
    const BRIM  = '#c0c0c0';
    const SHIRT = '#0073D1';
    const PANTS = '#3b4261';
    const SPOOL = '#9d7cd8';

    // Struggling: heavy stomp, forward lean, arms dragging
    const legSwing = moving ? (struggling ? 13 : 9) : 0;
    const lean     = struggling ? 5 * d : 0;          // body leans forward
    const hunchY   = struggling ? 4 : 0;              // head/body droops down
    const bob      = struggling ? Math.sin(dist / 6) * 2 : 0; // heavy up-down bob

    const l1x = (frame === 0 ? -1 :  1) * legSwing * d;
    const l2x = (frame === 0 ?  1 : -1) * legSwing * d;
    // arms hang low and drag when struggling
    const a1x = struggling ? -d * 4 : -l1x * 0.55;
    const a2x = struggling ? -d * 4 : -l2x * 0.55;
    const aYOff = struggling ? 6 : 0;

    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    const yOff = bob;

    /* ground shadow */
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.ellipse(x, gY + 1, 12, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    /* legs */
    ctx.strokeStyle = PANTS;
    ctx.lineWidth   = 5;
    ctx.beginPath(); ctx.moveTo(x - 3 + lean, gY - 14 + yOff); ctx.lineTo(x - 3 + l1x, gY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 3 + lean, gY - 14 + yOff); ctx.lineTo(x + 3 + l2x, gY); ctx.stroke();

    /* body (shirt) */
    ctx.fillStyle = SHIRT;
    ctx.fillRect(x - 7 + lean, gY - 28 + hunchY + yOff, 14, 14);

    /* spool on back (opposite to direction of travel) */
    const sx = x - 11 * d + lean;
    const sy = gY - 23 + hunchY + yOff;
    ctx.strokeStyle = SPOOL;
    ctx.lineWidth   = 2.5;
    ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(sx - 5, sy - 2); ctx.lineTo(sx - 5, sy + 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx + 5, sy - 2); ctx.lineTo(sx + 5, sy + 2); ctx.stroke();
    ctx.strokeStyle = SPOOL;
    ctx.lineWidth   = 1.2;
    ctx.beginPath();
    ctx.moveTo(sx - 3, sy); ctx.lineTo(sx + 3, sy);
    ctx.moveTo(sx, sy - 3); ctx.lineTo(sx, sy + 3);
    ctx.stroke();

    /* arms */
    ctx.strokeStyle = SHIRT;
    ctx.lineWidth   = 4;
    ctx.beginPath(); ctx.moveTo(x - 7 * d + lean, gY - 23 + hunchY + yOff); ctx.lineTo(x - 7 * d + lean + a1x, gY - 13 + hunchY + aYOff + yOff); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 7 * d + lean, gY - 23 + hunchY + yOff); ctx.lineTo(x + 7 * d + lean + a2x, gY - 13 + hunchY + aYOff + yOff); ctx.stroke();

    /* head — droops forward when struggling */
    const hx = x + lean * 0.6;
    const hy = gY - 35 + hunchY + yOff;
    ctx.fillStyle = SKIN;
    ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.fill();

    /* hard hat */
    ctx.fillStyle = HAT;
    ctx.beginPath();
    ctx.arc(hx, hy - 4, 9, Math.PI, 0, false);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = BRIM;
    ctx.fillRect(hx - 12, hy - 5, 24, 3);

    /* eye */
    ctx.fillStyle = '#1a1b26';
    ctx.beginPath();
    ctx.arc(hx + 4 * d, hy + 1, 1.5, 0, Math.PI * 2);
    ctx.fill();

    /* effort squiggle lines when struggling */
    if (struggling) {
      ctx.strokeStyle = 'rgba(247,118,142,0.75)';
      ctx.lineWidth   = 1.2;
      ctx.lineCap     = 'round';
      const ex = hx - d * 10;
      const ey = hy - 10;
      ctx.beginPath(); ctx.moveTo(ex,     ey);      ctx.lineTo(ex + 4, ey - 3); ctx.lineTo(ex + 2, ey - 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex + 6, ey + 1);  ctx.lineTo(ex + 9, ey - 2); ctx.lineTo(ex + 7, ey - 5); ctx.stroke();
    }
  }

  /* ---- Sponge character (easter egg) ---- */
  function drawSpongeDude(x, gY, d, frame, moving) {
    const YELLOW = '#f7c520';
    const DARK_Y = '#c89a10';   // sponge holes
    const PANTS  = '#6b3a1f';
    const WHITE  = '#fffde8';
    const PUPIL  = '#1a1b26';
    const IRIS   = '#5ba0d0';
    const TIE    = '#cc1111';
    const SPOOL  = '#9d7cd8';

    const legSwing = moving ? 9 : 0;
    const l1x = (frame === 0 ? -1 :  1) * legSwing * d;
    const l2x = (frame === 0 ?  1 : -1) * legSwing * d;
    const a1x = -l1x * 0.55;
    const a2x = -l2x * 0.55;

    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    /* shadow */
    ctx.fillStyle = 'rgba(0,50,80,0.18)';
    ctx.beginPath();
    ctx.ellipse(x, gY + 1, 13, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    /* legs (brown) */
    ctx.strokeStyle = PANTS;
    ctx.lineWidth   = 5;
    ctx.beginPath(); ctx.moveTo(x - 3, gY - 14); ctx.lineTo(x - 3 + l1x, gY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 3, gY - 14); ctx.lineTo(x + 3 + l2x, gY); ctx.stroke();

    /* pants rectangle */
    ctx.fillStyle = PANTS;
    ctx.fillRect(x - 8, gY - 20, 16, 7);

    /* body — yellow sponge */
    ctx.fillStyle = YELLOW;
    ctx.fillRect(x - 8, gY - 34, 16, 15);
    /* sponge pores */
    ctx.fillStyle = DARK_Y;
    [[x-4, gY-32, 2.2],[x+3, gY-31, 1.8],[x-5, gY-26, 1.6],[x+4, gY-25, 2],[x-1, gY-22, 1.5],[x+1, gY-29, 1.4]].forEach(([hx,hy,hr]) => {
      ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
    });

    /* red tie */
    ctx.fillStyle = TIE;
    ctx.beginPath();
    ctx.moveTo(x - 2, gY - 33); ctx.lineTo(x + 2, gY - 33);
    ctx.lineTo(x + 1, gY - 20); ctx.lineTo(x - 1, gY - 20);
    ctx.closePath(); ctx.fill();

    /* spool on back */
    const sx = x - 11 * d, sy = gY - 26;
    ctx.strokeStyle = SPOOL; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(sx - 5, sy - 2); ctx.lineTo(sx - 5, sy + 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx + 5, sy - 2); ctx.lineTo(sx + 5, sy + 2); ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(sx-3,sy); ctx.lineTo(sx+3,sy); ctx.moveTo(sx,sy-3); ctx.lineTo(sx,sy+3); ctx.stroke();

    /* arms (yellow) */
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth   = 4;
    ctx.beginPath(); ctx.moveTo(x - 8 * d, gY - 29); ctx.lineTo(x - 8 * d + a1x, gY - 19); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 8 * d, gY - 29); ctx.lineTo(x + 8 * d + a2x, gY - 19); ctx.stroke();

    /* square-ish head */
    ctx.fillStyle = YELLOW;
    ctx.fillRect(x - 9, gY - 48, 18, 15);
    /* head pores */
    ctx.fillStyle = DARK_Y;
    [[x-3,gY-39,1.3],[x+5,gY-41,1.1]].forEach(([hx,hy,hr]) => {
      ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI*2); ctx.fill();
    });

    /* wide ellipse eyes */
    ctx.fillStyle = WHITE;
    ctx.beginPath(); ctx.ellipse(x - 4.5, gY - 42, 4.5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 4.5, gY - 42, 4.5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    /* pupils */
    ctx.fillStyle = PUPIL;
    ctx.beginPath(); ctx.arc(x - 4.5 + d * 0.6, gY - 42, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4.5 + d * 0.6, gY - 42, 2, 0, Math.PI * 2); ctx.fill();

    /* gentle smile */
    ctx.strokeStyle = PUPIL; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 4, gY - 39);
    ctx.quadraticCurveTo(x, gY - 36, x + 4, gY - 39);
    ctx.stroke();

    /* buck teeth */
    ctx.fillStyle = WHITE;
    ctx.fillRect(x - 2.5, gY - 39, 1.8, 2);
    ctx.fillRect(x + 0.5, gY - 39, 1.8, 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.4;
    ctx.strokeRect(x - 2.5, gY - 39, 1.8, 2);
    ctx.strokeRect(x + 0.5, gY - 39, 1.8, 2);

    /* hard hat — white with light grey brim */
    ctx.fillStyle = '#e8e8e8';
    ctx.beginPath(); ctx.arc(x, gY - 50, 9, Math.PI, 0, false); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(x - 12, gY - 51, 24, 3);
  }

  /* ---- Easter egg click detection ---- */
  canvas.addEventListener('click', e => {
    if (document.documentElement.dataset.theme === 'dark') return;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx     = (e.clientX - rect.left) * scaleX;
    const cy     = (e.clientY - rect.top)  * scaleY;
    const gY     = canvas.height - 20;
    if (Math.abs(cx - currentX) < 22 && cy > gY - 58 && cy < gY + 5) {
      dudeClickCount++;
      if (dudeClickCount >= 3) {
        easterEgg      = !easterEgg;
        dudeClickCount = 0;
      }
    }
  });

  window.cableDude = { setTarget };
  requestAnimationFrame(tick);
}());
