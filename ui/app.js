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
    if (el) elements = elements.filter((e) => e !== el);
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
});

document.getElementById("clearBtn").addEventListener("click", () => {
  elements = [];
  pendingPoints = [];
  statusEl.textContent = "Place components, then Solve.";
  render();
});

document.getElementById("demoBtn").addEventListener("click", () => {
  elements = [
    { type: "V", points: [{ x: 2, y: 1 }, { x: 2, y: 0 }], value: 1 },
    { type: "GND", points: [{ x: 2, y: 0 }] },
    { type: "R", points: [{ x: 2, y: 1 }, { x: 2, y: 2 }], value: 1000 },
    { type: "C", points: [{ x: 2, y: 2 }, { x: 2, y: 3 }], value: 1e-6 },
    { type: "GND", points: [{ x: 2, y: 3 }] },
  ];
  render();
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

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = FG;
  for (const el of elements) drawElement(el);
  for (const p of pendingPoints) drawGridPoint(p, true);
}

render();
