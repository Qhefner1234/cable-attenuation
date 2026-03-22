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
   State
   ---------------------------------------------------------- */
let activeCable = 'RG-59';

/* ----------------------------------------------------------
   Calculation
   ---------------------------------------------------------- */
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

  /* Initial render */
  setActiveCable('RG-59');
  updateResults();
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
