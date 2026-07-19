// transient.js -- time-domain simulation via trapezoidal integration,
// using the standard Norton companion models for C and L (see derivation
// in the vault's ee-project-d page / this project's README):
//   Capacitor: Geq = 2C/dt,  I_C(t) = Geq*V_C(t) - Ieq(t),  Ieq(t) = Geq*V_C(t-dt) + I_C(t-dt)
//   Inductor:  Geq = dt/(2L), I_L(t) = Geq*V_L(t) + Ieq(t),  Ieq(t) = I_L(t-dt) + Geq*V_L(t-dt)
// Solved with real-valued Gaussian elimination (no frequency, no Complex
// needed) at each timestep, re-stamping the companion source each time.

(function () {

function countExtraUnknowns(components) {
  return components.filter((c) => c.type === "V" || c.type === "OPAMP").length;
}

function stampG(G, a, b, g) {
  if (a !== 0) G[a][a] += g;
  if (b !== 0) G[b][b] += g;
  if (a !== 0 && b !== 0) { G[a][b] -= g; G[b][a] -= g; }
}

function solveReal(G, b, size) {
  const A = G.map((row) => row.slice());
  const rhs = b.slice();
  for (let col = 1; col <= size; col++) {
    let pivotRow = col, maxAbs = Math.abs(A[col][col]);
    for (let row = col + 1; row <= size; row++) {
      if (Math.abs(A[row][col]) > maxAbs) { maxAbs = Math.abs(A[row][col]); pivotRow = row; }
    }
    if (maxAbs < 1e-15) throw new Error(`singular matrix at column ${col}`);
    if (pivotRow !== col) { [A[col], A[pivotRow]] = [A[pivotRow], A[col]]; [rhs[col], rhs[pivotRow]] = [rhs[pivotRow], rhs[col]]; }
    for (let row = col + 1; row <= size; row++) {
      const factor = A[row][col] / A[col][col];
      for (let c = col; c <= size; c++) A[row][c] -= factor * A[col][c];
      rhs[row] -= factor * rhs[col];
    }
  }
  const x = new Array(size + 1).fill(0);
  for (let row = size; row >= 1; row--) {
    let sum = rhs[row];
    for (let c = row + 1; c <= size; c++) sum -= A[row][c] * x[c];
    x[row] = sum / A[row][row];
  }
  return x;
}

// inputValue(t) -> the independent voltage source's value at time t (V type
// components all share this waveform; multi-source netlists aren't supported
// here, matching this tool's single-input filter-analysis scope).
function simulateTransient(netlist, { dt, tStop, inputValue }) {
  const N = netlist.numNodes;
  const extra = countExtraUnknowns(netlist.components);
  const size = N + extra;

  // Per-component reactive state (Geq, Ieq), null for non-reactive types.
  const state = netlist.components.map((c) => {
    if (c.type === "C") return { Geq: (2 * c.value) / dt, Ieq: 0 };
    if (c.type === "L") return { Geq: dt / (2 * c.value), Ieq: 0 };
    return null;
  });

  const steps = Math.round(tStop / dt);
  const trace = [];

  for (let k = 0; k <= steps; k++) {
    const t = k * dt;
    const G = Array.from({ length: size + 1 }, () => new Array(size + 1).fill(0));
    const b = new Array(size + 1).fill(0);
    let extraIndex = N;

    netlist.components.forEach((comp, i) => {
      const [a, bNode] = comp.nodes;
      if (comp.type === "R") {
        stampG(G, a, bNode, 1 / comp.value);
      } else if (comp.type === "C") {
        stampG(G, a, bNode, state[i].Geq);
        if (a !== 0) b[a] += state[i].Ieq;
        if (bNode !== 0) b[bNode] -= state[i].Ieq;
      } else if (comp.type === "L") {
        stampG(G, a, bNode, state[i].Geq);
        if (a !== 0) b[a] -= state[i].Ieq;
        if (bNode !== 0) b[bNode] += state[i].Ieq;
      } else if (comp.type === "V") {
        extraIndex += 1;
        const kk = extraIndex;
        if (a !== 0) { G[a][kk] += 1; G[kk][a] += 1; }
        if (bNode !== 0) { G[bNode][kk] -= 1; G[kk][bNode] -= 1; }
        b[kk] = inputValue(t);
      } else if (comp.type === "OPAMP") {
        const [vplus, vminus, vout] = comp.nodes;
        extraIndex += 1;
        const kk = extraIndex;
        if (vout !== 0) G[vout][kk] += 1;
        if (vplus !== 0) G[kk][vplus] += 1;
        if (vminus !== 0) G[kk][vminus] -= 1;
      } else {
        throw new Error(`unknown component type: ${comp.type}`);
      }
    });

    const x = solveReal(G, b, size);
    trace.push({ t, voltages: x.slice(0, N + 1) });

    netlist.components.forEach((comp, i) => {
      const [a, bNode] = comp.nodes;
      const Va = a === 0 ? 0 : x[a];
      const Vb = bNode === 0 ? 0 : x[bNode];
      const V = Va - Vb;
      if (comp.type === "C") {
        const Ic = state[i].Geq * V - state[i].Ieq;
        state[i].Ieq = state[i].Geq * V + Ic;
      } else if (comp.type === "L") {
        const Il = state[i].Geq * V + state[i].Ieq;
        state[i].Ieq = Il + state[i].Geq * V;
      }
    });
  }

  return trace;
}

const api = { simulateTransient };
if (typeof module !== "undefined") module.exports = api;
if (typeof window !== "undefined") window.Transient = api;
})();
