// app.js -- canvas schematic editor. Delegates all netlist-building logic to
// circuit.js (unit-tested separately in tests/test_phase3.js) and all
// circuit solving to engine/mna.js -- this file is UI/rendering only.

const GRID = 40;
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");

// The canvas has a fixed light background (see index.html) so schematic
// legibility doesn't depend on ambient dark-mode detection -- "currentColor"
// and matchMedia dark-mode heuristics both proved unreliable in practice
// (labels rendered near-invisible under some browser/theme combinations).
const FG = "#1a1a1a";

let elements = []; // { type, points: [{x,y}...], value }
let tool = null;
let pendingPoints = []; // points clicked so far for the in-progress element
let outputPoint = null; // {x,y} grid point marked as the plots' output node
let selectedElement = null; // element currently bound to the value-edit slider

function snap(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.round((clientX - rect.left) / GRID);
  const y = Math.round((clientY - rect.top) / GRID);
  return { x, y };
}

function px(p) {
  return { x: p.x * GRID, y: p.y * GRID };
}

function pointsNeeded(type) {
  if (type === "GND") return 1;
  if (type === "OPAMP") return 3;
  if (type === "DELETE") return 1;
  if (type === "OUTPUT") return 1;
  if (type === "EDIT") return 1;
  return 2; // R, C, L, V, WIRE
}

function defaultValueFor(type) {
  if (type === "R") return 1000;
  if (type === "C") return 1e-6;
  if (type === "L") return 1e-3;
  if (type === "V") return 1;
  return undefined;
}

function promptForValue(type) {
  const def = defaultValueFor(type);
  const units = { R: "ohms", C: "farads", L: "henries", V: "volts" }[type];
  const raw = window.prompt(`${type} value (${units}):`, String(def));
  const v = raw === null ? def : parseFloat(raw);
  return Number.isFinite(v) ? v : def;
}

function distToSegment(p, a, b) {
  const A = px(a), B = px(b), P = px(p);
  const dx = B.x - A.x, dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(P.x - A.x, P.y - A.y);
  let t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const projX = A.x + t * dx, projY = A.y + t * dy;
  return Math.hypot(P.x - projX, P.y - projY);
}

function findElementNear(p) {
  let best = null, bestDist = 20; // px
  for (const el of elements) {
    if (el.points.length === 1) {
      const d = Math.hypot(px(p).x - px(el.points[0]).x, px(p).y - px(el.points[0]).y);
      if (d < bestDist) { bestDist = d; best = el; }
    } else {
      for (let i = 0; i < el.points.length - 1; i++) {
        const d = distToSegment(p, el.points[i], el.points[i + 1]);
        if (d < bestDist) { bestDist = d; best = el; }
      }
    }
  }
  return best;
}

function setTool(t) {
  tool = t;
  pendingPoints = [];
  document.querySelectorAll("#palette button[data-tool]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === t);
  });
}

document.querySelectorAll("#palette button[data-tool]").forEach((b) => {
  b.addEventListener("click", () => setTool(b.dataset.tool));
});

canvas.addEventListener("click", (ev) => {
  if (!tool) return;
  const p = snap(ev.clientX, ev.clientY);

  if (tool === "DELETE") {
    const el = findElementNear(p);
    if (el) {
      elements = elements.filter((e) => e !== el);
      if (selectedElement === el) deselectElement();
    }
    render();
    updateAll();
    return;
  }

  if (tool === "OUTPUT") {
    outputPoint = p;
    render();
    updateAll();
    return;
  }

  if (tool === "EDIT") {
    const el = findElementNear(p);
    selectElement(["R", "C", "L", "V"].includes(el && el.type) ? el : null);
    render();
    return;
  }

  pendingPoints.push(p);
  if (pendingPoints.length === pointsNeeded(tool)) {
    const value = ["R", "C", "L", "V"].includes(tool) ? promptForValue(tool) : undefined;
    elements.push({ type: tool, points: pendingPoints.slice(), value });
    pendingPoints = [];
  }
  render();
  updateAll();
});

const editPanel = document.getElementById("editPanel");
const editLabel = document.getElementById("editLabel");
const editSlider = document.getElementById("editSlider");
const editValue = document.getElementById("editValue");

function selectElement(el) {
  selectedElement = el;
  if (!el) {
    editPanel.style.display = "none";
    return;
  }
  editPanel.style.display = "block";
  const units = { R: "ohms", C: "farads", L: "henries", V: "volts" }[el.type];
  editLabel.textContent = `${el.type} (${units})`;
  editSlider.value = 100;
  editValue.value = el.value;
}

function deselectElement() {
  selectElement(null);
}

// Slider is a percentage of the value at selection time (10%-500%) --
// simple, predictable "drag to scale" behavior regardless of the
// component's absolute magnitude (ohms vs kilohms, pF vs uF, ...).
let sliderBaseValue = null;
editSlider.addEventListener("input", () => {
  if (!selectedElement) return;
  if (sliderBaseValue === null) sliderBaseValue = selectedElement.value;
  const pct = parseFloat(editSlider.value);
  selectedElement.value = sliderBaseValue * (pct / 100);
  editValue.value = selectedElement.value;
  render();
  updateAll();
});
editSlider.addEventListener("mousedown", () => { sliderBaseValue = selectedElement ? selectedElement.value : null; });
editSlider.addEventListener("mouseup", () => { sliderBaseValue = null; });

editValue.addEventListener("input", () => {
  if (!selectedElement) return;
  const v = parseFloat(editValue.value);
  if (Number.isFinite(v)) {
    selectedElement.value = v;
    render();
    updateAll();
  }
});

document.getElementById("clearBtn").addEventListener("click", () => {
  elements = [];
  pendingPoints = [];
  outputPoint = null;
  deselectElement();
  statusEl.textContent = "Place components, then Solve.";
  render();
  updateAll();
});

document.getElementById("demoBtn").addEventListener("click", () => {
  elements = [
    { type: "V", points: [{ x: 2, y: 1 }, { x: 2, y: 0 }], value: 1 },
    { type: "GND", points: [{ x: 2, y: 0 }] },
    { type: "R", points: [{ x: 2, y: 1 }, { x: 2, y: 2 }], value: 1000 },
    { type: "C", points: [{ x: 2, y: 2 }, { x: 2, y: 3 }], value: 1e-6 },
    { type: "GND", points: [{ x: 2, y: 3 }] },
  ];
  outputPoint = { x: 2, y: 2 };
  render();
  updateAll();
});

document.getElementById("solveBtn").addEventListener("click", () => {
  const f = parseFloat(document.getElementById("freqInput").value);
  if (!Number.isFinite(f) || f <= 0) {
    statusEl.textContent = "Enter a positive frequency in Hz.";
    return;
  }
  try {
    const { netlist, nodeOf } = Circuit.buildNetlistFromElements(elements);
    if (netlist.numNodes === 0) {
      statusEl.textContent = "No circuit placed yet.";
      return;
    }
    const omega = 2 * Math.PI * f;
    const voltages = MNA.solveAC(netlist, omega);
    const lines = [`Solved at f=${f} Hz (${netlist.components.length} components, ${netlist.numNodes} nodes):`];
    for (let n = 1; n <= netlist.numNodes; n++) {
      const v = voltages[n];
      lines.push(`  node ${n}: ${v.abs().toFixed(6)} V, ${v.phaseDeg().toFixed(2)} deg  (${v.re.toFixed(6)} + j${v.im.toFixed(6)})`);
    }
    statusEl.textContent = lines.join("\n");
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
  }
});

function drawGridPoint(p, filled) {
  const q = px(p);
  ctx.beginPath();
  ctx.arc(q.x, q.y, filled ? 4 : 2, 0, 2 * Math.PI);
  ctx.fillStyle = filled ? "#4a9eff" : "#8888";
  ctx.fill();
}

function labelAt(p, text, dy = -8) {
  const q = px(p);
  ctx.fillStyle = FG;
  ctx.font = "11px ui-monospace, monospace";
  ctx.fillText(text, q.x + 6, q.y + dy);
}

function fmtValue(type, value) {
  if (value === undefined) return "";
  if (type === "R") return `${value} Ω`;
  if (type === "C") return `${value * 1e6} µF`;
  if (type === "L") return `${value * 1e3} mH`;
  if (type === "V") return `${value} V`;
  return String(value);
}

function drawElement(el) {
  ctx.strokeStyle = FG;
  ctx.lineWidth = el.type === "WIRE" ? 1.5 : 2;
  ctx.setLineDash(el.type === "WIRE" ? [] : []);

  if (el.type === "GND") {
    const q = px(el.points[0]);
    ctx.beginPath();
    ctx.moveTo(q.x, q.y);
    ctx.lineTo(q.x, q.y + 16);
    ctx.moveTo(q.x - 8, q.y + 16);
    ctx.lineTo(q.x + 8, q.y + 16);
    ctx.moveTo(q.x - 5, q.y + 20);
    ctx.lineTo(q.x + 5, q.y + 20);
    ctx.stroke();
    labelAt(el.points[0], "GND", 30);
    return;
  }

  if (el.type === "OPAMP") {
    const [vp, vm, vout] = el.points.map(px);
    ctx.beginPath();
    ctx.moveTo(vp.x, vp.y);
    ctx.lineTo(vm.x, vm.y);
    ctx.lineTo(vout.x, vout.y);
    ctx.stroke();
    labelAt(el.points[0], "+");
    labelAt(el.points[1], "-");
    labelAt(el.points[2], "OUT");
    return;
  }

  const [a, b] = el.points.map(px);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (el.type !== "WIRE") {
    ctx.fillStyle = FG;
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(`${el.type} ${fmtValue(el.type, el.value)}`, mid.x + 6, mid.y - 6);
  }
}

function drawOutputMarker() {
  if (!outputPoint) return;
  const q = px(outputPoint);
  ctx.beginPath();
  ctx.arc(q.x, q.y, 9, 0, 2 * Math.PI);
  ctx.strokeStyle = "#2eaa4a";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#2eaa4a";
  ctx.font = "11px ui-monospace, monospace";
  ctx.fillText("OUT", q.x + 12, q.y + 4);
}

function drawSelectionHighlight() {
  if (!selectedElement) return;
  ctx.strokeStyle = "#e0a52e";
  ctx.lineWidth = 4;
  const [a, b] = selectedElement.points.map(px);
  if (selectedElement.points.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = FG;
  drawSelectionHighlight();
  for (const el of elements) drawElement(el);
  for (const p of pendingPoints) drawGridPoint(p, true);
  drawOutputMarker();
}

// ---------------------------------------------------------------------
// Live plots: Bode, pole-zero map, transient step response. Re-run after
// any placement/edit/output-node change so dragging a value updates all
// three, per Phase 4's acceptance test.
// ---------------------------------------------------------------------

function clearPlot(canvasEl, message) {
  const c = canvasEl.getContext("2d");
  c.clearRect(0, 0, canvasEl.width, canvasEl.height);
  if (message) {
    c.fillStyle = "#888";
    c.font = "12px ui-monospace, monospace";
    c.fillText(message, 10, canvasEl.height / 2);
  }
}

function plotAxes(c, w, h, pad) {
  c.strokeStyle = "#ccc";
  c.lineWidth = 1;
  c.strokeRect(pad, pad, w - 2 * pad, h - 2 * pad);
}

function drawBode(netlist, outputNode) {
  const canvasEl = document.getElementById("bodeCanvas");
  const c = canvasEl.getContext("2d");
  const w = canvasEl.width, h = canvasEl.height, pad = 30;
  c.clearRect(0, 0, w, h);

  const w0 = PoleZero.characteristicOmega(netlist);
  const numPts = 200;
  const freqsHz = [];
  for (let i = 0; i < numPts; i++) {
    const decade = -2 + (4 * i) / (numPts - 1);
    freqsHz.push((w0 * Math.pow(10, decade)) / (2 * Math.PI));
  }
  const sweep = MNA.acSweep(netlist, freqsHz);
  const mags = sweep.map((s) => 20 * Math.log10(s.voltages[outputNode].abs()));
  const phases = sweep.map((s) => s.voltages[outputNode].phaseDeg());

  const magMin = Math.min(...mags, -1), magMax = Math.max(...mags, 1);
  const halfH = h / 2;

  // magnitude (top half)
  plotAxes(c, w, halfH, pad);
  c.strokeStyle = "#2b6cb0";
  c.lineWidth = 1.5;
  c.beginPath();
  mags.forEach((m, i) => {
    const x = pad + ((w - 2 * pad) * i) / (numPts - 1);
    const y = pad + (halfH - 2 * pad) * (1 - (m - magMin) / (magMax - magMin || 1));
    i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
  });
  c.stroke();
  c.fillStyle = "#2b6cb0";
  c.font = "10px ui-monospace, monospace";
  c.fillText(`mag (dB): ${magMin.toFixed(1)} to ${magMax.toFixed(1)}`, pad, 12);

  // phase (bottom half)
  c.save();
  c.translate(0, halfH);
  plotAxes(c, w, halfH, pad);
  c.strokeStyle = "#c0392b";
  c.beginPath();
  phases.forEach((ph, i) => {
    const x = pad + ((w - 2 * pad) * i) / (numPts - 1);
    const y = pad + (halfH - 2 * pad) * (1 - (ph + 180) / 360);
    i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
  });
  c.stroke();
  c.fillStyle = "#c0392b";
  c.fillText("phase (deg): -180 to 180", pad, 12);
  c.restore();
}

function drawPoleZero(netlist, outputNode) {
  const canvasEl = document.getElementById("pzCanvas");
  const c = canvasEl.getContext("2d");
  const w = canvasEl.width, h = canvasEl.height, pad = 30;
  c.clearRect(0, 0, w, h);

  let poles = [], zeros = [];
  try {
    ({ poles, zeros } = PoleZero.poleZeroMap(netlist, outputNode));
  } catch (e) {
    c.fillStyle = "#888";
    c.fillText(`pole-zero fit failed: ${e.message}`, 10, h / 2);
    return;
  }

  const allRe = [...poles, ...zeros].map((r) => r.re).concat([0]);
  const allIm = [...poles, ...zeros].map((r) => r.im).concat([0]);
  const reMax = Math.max(...allRe.map(Math.abs), 1) * 1.3;
  const imMax = Math.max(...allIm.map(Math.abs), 1) * 1.3;

  const toXY = (re, im) => ({
    x: pad + ((w - 2 * pad) * (re + reMax)) / (2 * reMax),
    y: pad + (h - 2 * pad) * (1 - (im + imMax) / (2 * imMax)),
  });

  plotAxes(c, w, h, pad);
  // axes through origin
  c.strokeStyle = "#ddd";
  const origin = toXY(0, 0);
  c.beginPath();
  c.moveTo(pad, origin.y); c.lineTo(w - pad, origin.y);
  c.moveTo(origin.x, pad); c.lineTo(origin.x, h - pad);
  c.stroke();

  c.strokeStyle = "#c0392b";
  c.lineWidth = 2;
  poles.forEach((p) => {
    const { x, y } = toXY(p.re, p.im);
    c.beginPath();
    c.moveTo(x - 5, y - 5); c.lineTo(x + 5, y + 5);
    c.moveTo(x - 5, y + 5); c.lineTo(x + 5, y - 5);
    c.stroke();
  });
  c.strokeStyle = "#2b6cb0";
  zeros.forEach((z) => {
    const { x, y } = toXY(z.re, z.im);
    c.beginPath();
    c.arc(x, y, 5, 0, 2 * Math.PI);
    c.stroke();
  });
  c.fillStyle = "#888";
  c.font = "10px ui-monospace, monospace";
  c.fillText(`x poles (${poles.length})  o zeros (${zeros.length})`, pad, 12);
}

function drawTransient(netlist, outputNode) {
  const canvasEl = document.getElementById("transientCanvas");
  const c = canvasEl.getContext("2d");
  const w = canvasEl.width, h = canvasEl.height, pad = 30;
  c.clearRect(0, 0, w, h);

  const w0 = PoleZero.characteristicOmega(netlist);
  const T = 1 / w0;
  const dt = T / 200;
  const tStop = 10 * T;
  let trace;
  try {
    trace = Transient.simulateTransient(netlist, { dt, tStop, inputValue: () => 1 });
  } catch (e) {
    c.fillStyle = "#888";
    c.fillText(`transient sim failed: ${e.message}`, 10, h / 2);
    return;
  }
  const ys = trace.map((pt) => pt.voltages[outputNode]);
  const yMin = Math.min(...ys, 0), yMax = Math.max(...ys, 0.001);

  plotAxes(c, w, h, pad);
  c.strokeStyle = "#2eaa4a";
  c.lineWidth = 1.5;
  c.beginPath();
  ys.forEach((y, i) => {
    const x = pad + ((w - 2 * pad) * i) / (ys.length - 1);
    const yy = pad + (h - 2 * pad) * (1 - (y - yMin) / (yMax - yMin || 1));
    i === 0 ? c.moveTo(x, yy) : c.lineTo(x, yy);
  });
  c.stroke();
  c.fillStyle = "#888";
  c.font = "10px ui-monospace, monospace";
  c.fillText(`step response, t=0..${tStop.toExponential(2)}s, v=${yMin.toFixed(3)}..${yMax.toFixed(3)}`, pad, 12);
}

function updateAll() {
  if (!outputPoint) {
    clearPlot(document.getElementById("bodeCanvas"), "Mark an output node to see plots.");
    clearPlot(document.getElementById("pzCanvas"), "");
    clearPlot(document.getElementById("transientCanvas"), "");
    return;
  }
  try {
    const { netlist, nodeOf } = Circuit.buildNetlistFromElements(elements);
    if (netlist.numNodes === 0) return;
    const outputNode = nodeOf(outputPoint);
    if (outputNode === undefined) {
      const msg = "Output point isn't part of the circuit -- click on a wire or component terminal.";
      clearPlot(document.getElementById("bodeCanvas"), msg);
      clearPlot(document.getElementById("pzCanvas"), "");
      clearPlot(document.getElementById("transientCanvas"), "");
      return;
    }
    drawBode(netlist, outputNode);
    drawPoleZero(netlist, outputNode);
    drawTransient(netlist, outputNode);
  } catch (e) {
    const msg = `Error: ${e.message}`;
    clearPlot(document.getElementById("bodeCanvas"), msg);
    clearPlot(document.getElementById("pzCanvas"), msg);
    clearPlot(document.getElementById("transientCanvas"), msg);
  }
}

render();
updateAll();
