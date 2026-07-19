// mna.js -- complex-valued Modified Nodal Analysis solver for linear AC
// circuit analysis. Components: R, C, L, V (independent voltage source),
// OPAMP (ideal, nullor model).
//
// Netlist format:
//   { numNodes: N,  // nodes numbered 1..N; node 0 is always ground
//     components: [
//       { type: 'R', nodes: [a, b], value: ohms },
//       { type: 'C', nodes: [a, b], value: farads },
//       { type: 'L', nodes: [a, b], value: henries },
//       { type: 'V', nodes: [a, b], value: volts },              // + at a, - at b
//       { type: 'OPAMP', nodes: [vplus, vminus, vout] },         // ideal, infinite gain
//     ] }
//
// solveAC(netlist, omega) returns an array of node voltages (Complex),
// indexed 1..N (index 0 unused, ground is implicitly 0V).

// Wrapped in an IIFE so the browser build's `const Complex` binding stays
// function-scoped -- as a plain (non-module) <script>, a top-level const/class
// here would collide with complex.js's top-level `class Complex` in the
// shared global lexical scope and throw a SyntaxError that silently kills
// the whole file (caught the hard way: window.MNA came out undefined with
// no visible error until traced through window.onerror).
(function () {
const { Complex } = typeof module !== "undefined" ? require("./complex") : window;

function countExtraUnknowns(components) {
  return components.filter((c) => c.type === "V" || c.type === "OPAMP").length;
}

function stampAdmittance(G, a, b, y) {
  // y: Complex admittance between nodes a and b (0 = ground, not stamped)
  if (a !== 0) G[a][a] = G[a][a].add(y);
  if (b !== 0) G[b][b] = G[b][b].add(y);
  if (a !== 0 && b !== 0) {
    G[a][b] = G[a][b].sub(y);
    G[b][a] = G[b][a].sub(y);
  }
}

function buildSystem(netlist, omega) {
  const N = netlist.numNodes;
  const extra = countExtraUnknowns(netlist.components);
  const size = N + extra;

  const G = Array.from({ length: size + 1 }, () => Array.from({ length: size + 1 }, () => Complex.zero()));
  const b = Array.from({ length: size + 1 }, () => Complex.zero());

  let extraIndex = N; // next free extra-unknown row/col, 1-indexed after the N node rows

  for (const comp of netlist.components) {
    const [a, bNode] = comp.nodes;
    if (comp.type === "R") {
      stampAdmittance(G, a, bNode, new Complex(1 / comp.value, 0));
    } else if (comp.type === "C") {
      stampAdmittance(G, a, bNode, new Complex(0, omega * comp.value)); // jwC
    } else if (comp.type === "L") {
      // 1/(jwL) = -j/(wL)  (for omega=0, DC, inductor is a short -- not handled here, AC sweep only)
      stampAdmittance(G, a, bNode, new Complex(0, -1 / (omega * comp.value)));
    } else if (comp.type === "V") {
      extraIndex += 1;
      const k = extraIndex;
      if (a !== 0) {
        G[a][k] = G[a][k].add(new Complex(1, 0));
        G[k][a] = G[k][a].add(new Complex(1, 0));
      }
      if (bNode !== 0) {
        G[bNode][k] = G[bNode][k].sub(new Complex(1, 0));
        G[k][bNode] = G[k][bNode].sub(new Complex(1, 0));
      }
      b[k] = new Complex(comp.value, 0);
    } else if (comp.type === "OPAMP") {
      const [vplus, vminus, vout] = comp.nodes;
      extraIndex += 1;
      const k = extraIndex;
      // output current unknown enters KCL at vout
      if (vout !== 0) {
        G[vout][k] = G[vout][k].add(new Complex(1, 0));
      }
      // constraint row: V(vplus) - V(vminus) = 0
      if (vplus !== 0) G[k][vplus] = G[k][vplus].add(new Complex(1, 0));
      if (vminus !== 0) G[k][vminus] = G[k][vminus].sub(new Complex(1, 0));
    } else {
      throw new Error(`unknown component type: ${comp.type}`);
    }
  }

  return { G, b, size };
}

function solveComplexLinearSystem(G, b, size) {
  // Gaussian elimination with partial pivoting, 1-indexed (index 0 unused).
  // Work on copies so callers can reuse the same netlist across a frequency sweep.
  const A = G.map((row) => row.slice());
  const rhs = b.slice();

  for (let col = 1; col <= size; col++) {
    let pivotRow = col;
    let maxAbs = A[col][col].abs();
    for (let row = col + 1; row <= size; row++) {
      const v = A[row][col].abs();
      if (v > maxAbs) {
        maxAbs = v;
        pivotRow = row;
      }
    }
    if (maxAbs < 1e-15) {
      throw new Error(`singular matrix (near-zero pivot at column ${col}) -- check the netlist is fully connected`);
    }
    if (pivotRow !== col) {
      [A[col], A[pivotRow]] = [A[pivotRow], A[col]];
      [rhs[col], rhs[pivotRow]] = [rhs[pivotRow], rhs[col]];
    }
    for (let row = col + 1; row <= size; row++) {
      const factor = A[row][col].div(A[col][col]);
      for (let c = col; c <= size; c++) {
        A[row][c] = A[row][c].sub(factor.mul(A[col][c]));
      }
      rhs[row] = rhs[row].sub(factor.mul(rhs[col]));
    }
  }

  const x = Array.from({ length: size + 1 }, () => Complex.zero());
  for (let row = size; row >= 1; row--) {
    let sum = rhs[row];
    for (let c = row + 1; c <= size; c++) {
      sum = sum.sub(A[row][c].mul(x[c]));
    }
    x[row] = sum.div(A[row][row]);
  }
  return x;
}

function solveAC(netlist, omega) {
  const { G, b, size } = buildSystem(netlist, omega);
  const x = solveComplexLinearSystem(G, b, size);
  return x.slice(0, netlist.numNodes + 1); // node voltages only, drop extra-unknown entries
}

function acSweep(netlist, freqsHz) {
  return freqsHz.map((f) => ({ freqHz: f, voltages: solveAC(netlist, 2 * Math.PI * f) }));
}

if (typeof module !== "undefined") module.exports = { solveAC, acSweep, buildSystem, solveComplexLinearSystem };
if (typeof window !== "undefined") window.MNA = { solveAC, acSweep, buildSystem, solveComplexLinearSystem };
})();
