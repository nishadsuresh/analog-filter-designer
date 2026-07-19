// pole_zero.js -- pole/zero estimation via rational transfer-function
// fitting (Levy's method) against the already-verified AC frequency sweep,
// rather than a fully symbolic MNA-over-rational-functions solve.
//
// An earlier version of this file built the transfer function exactly via
// Gaussian elimination over polynomial-fraction (Rational) matrix entries.
// That's the "textbook exact" approach, but it turned out to be numerically
// fragile in practice: intermediate elimination steps produce spurious
// uncancelled common factors between numerator and denominator (e.g. a
// zero-numerator term picking up a nontrivial leftover denominator from a
// prior division), and this project's component values span a huge dynamic
// range (pF to mH to kOhm), so a fixed epsilon can't safely distinguish
// "genuinely zero" from "tiny but real" coefficients. Getting that fully
// robust needs real polynomial GCD reduction, which is its own significant
// numerical-analysis project.
//
// Levy's method sidesteps all of that: sample H(jw) with the AC solver
// (verified to ~1e-16 in Phases 1-2), then fit B(s)/A(s) via linear least
// squares. This is standard practice in RF/microwave system identification,
// not a shortcut -- and it reuses already-correct code instead of adding a
// second large piece of fragile machinery.

(function () {
const { Complex } = typeof module !== "undefined" ? require("./complex") : window;
const { acSweep } = typeof module !== "undefined" ? require("./mna") : window.MNA;
const { trim, polyEval } = typeof module !== "undefined" ? require("./poly") : window.Poly;

function countReactiveOrder(netlist) {
  return netlist.components.filter((c) => c.type === "C" || c.type === "L").length;
}

// A characteristic angular frequency to normalize the fit around, so the
// least-squares problem stays well-conditioned regardless of the circuit's
// actual component-value scale (pF vs uF, ohms vs kOhms, ...).
function characteristicOmega(netlist) {
  const Rs = netlist.components.filter((c) => c.type === "R").map((c) => c.value);
  const Cs = netlist.components.filter((c) => c.type === "C").map((c) => c.value);
  const Ls = netlist.components.filter((c) => c.type === "L").map((c) => c.value);
  const geo = (arr, fallback) => (arr.length ? Math.exp(arr.reduce((s, v) => s + Math.log(v), 0) / arr.length) : fallback);
  const Rg = geo(Rs, 1000);
  const Cg = geo(Cs, 1e-9);
  const Lg = geo(Ls, 1e-3);
  if (Ls.length && Cs.length) return 1 / Math.sqrt(Lg * Cg);
  if (Cs.length) return 1 / (Rg * Cg);
  if (Ls.length) return Rg / Lg;
  return 1;
}

function solveReal(Msq, y, n) {
  const A = Msq.map((row) => row.slice());
  const rhs = y.slice();
  for (let col = 0; col < n; col++) {
    let pivot = col, maxAbs = Math.abs(A[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > maxAbs) { maxAbs = Math.abs(A[row][col]); pivot = row; }
    }
    if (maxAbs < 1e-300) throw new Error("singular normal-equations matrix in transfer-function fit");
    if (pivot !== col) { [A[col], A[pivot]] = [A[pivot], A[col]]; [rhs[col], rhs[pivot]] = [rhs[pivot], rhs[col]]; }
    for (let row = col + 1; row < n; row++) {
      const f = A[row][col] / A[col][col];
      for (let c = col; c < n; c++) A[row][c] -= f * A[col][c];
      rhs[row] -= f * rhs[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = rhs[row];
    for (let c = row + 1; c < n; c++) sum -= A[row][c] * x[c];
    x[row] = sum / A[row][row];
  }
  return x;
}

// Fits B(sigma)/A(sigma) ~ H(j*sigma*w0), with A monic (a_n = 1), sigma
// being frequency normalized by the circuit's characteristic omega so the
// least-squares system stays well-conditioned. Returns roots already scaled
// back to physical s = sigma * w0.
function fitTransferFunction(netlist, outputNode, order) {
  const w0 = characteristicOmega(netlist);
  const m = order, n = order; // numerator/denominator degree (denominator monic at degree n)
  const numFreqs = Math.max(40, 20 * order);
  const freqsHz = [];
  for (let i = 0; i < numFreqs; i++) {
    const decade = -3 + (6 * i) / (numFreqs - 1); // w0 * 10^decade, spanning 1e-3..1e3 * w0
    freqsHz.push((w0 * Math.pow(10, decade)) / (2 * Math.PI));
  }
  const sweep = acSweep(netlist, freqsHz);
  const H = sweep.map((s) => s.voltages[outputNode]);
  const sigmas = freqsHz.map((f) => new Complex(0, (2 * Math.PI * f) / w0));

  const unknowns = (m + 1) + n; // b_0..b_m, a_0..a_{n-1} (a_n fixed = 1)
  const rows = [];
  const rhsRows = [];
  for (let k = 0; k < sigmas.length; k++) {
    const sigma = sigmas[k];
    const powers = [new Complex(1, 0)];
    for (let i = 1; i <= Math.max(m, n); i++) powers.push(powers[i - 1].mul(sigma));
    const Hk = H[k];
    const row = new Array(unknowns).fill(0);
    // complex row, split into real/imag afterward
    const rowRe = new Array(unknowns).fill(0);
    const rowIm = new Array(unknowns).fill(0);
    for (let i = 0; i <= m; i++) { rowRe[i] = powers[i].re; rowIm[i] = powers[i].im; }
    for (let i = 0; i < n; i++) {
      const term = Hk.mul(powers[i]).neg();
      rowRe[m + 1 + i] = term.re;
      rowIm[m + 1 + i] = term.im;
    }
    const rhsComplex = Hk.mul(powers[n]);
    rows.push(rowRe); rhsRows.push(rhsComplex.re);
    rows.push(rowIm); rhsRows.push(rhsComplex.im);
  }

  // Normal equations: (X^T X) c = X^T y
  const XtX = Array.from({ length: unknowns }, () => new Array(unknowns).fill(0));
  const Xty = new Array(unknowns).fill(0);
  for (let r = 0; r < rows.length; r++) {
    for (let i = 0; i < unknowns; i++) {
      Xty[i] += rows[r][i] * rhsRows[r];
      for (let j = 0; j < unknowns; j++) XtX[i][j] += rows[r][i] * rows[r][j];
    }
  }
  const c = solveReal(XtX, Xty, unknowns);
  const bCoeffs = c.slice(0, m + 1);
  const aCoeffs = c.slice(m + 1, m + 1 + n).concat([1]);
  return { bCoeffs, aCoeffs, w0 };
}

// Durand-Kerner: finds all complex roots of a real-coefficient polynomial
// (ascending coeffs).
function polyRoots(coeffsAscending) {
  const c = trim(coeffsAscending);
  const n = c.length - 1;
  if (n <= 0) return [];
  const lead = c[n];
  const norm = c.map((v) => v / lead);

  const bound = 1 + Math.max(...norm.slice(0, n).map((v) => Math.abs(v)));
  let roots = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n + 0.4;
    roots.push(new Complex(bound * Math.cos(angle) * 0.5 + 0.001, bound * Math.sin(angle) * 0.5 + 0.001));
  }

  function evalMonic(s) {
    let result = new Complex(0, 0);
    for (let i = n; i >= 0; i--) result = result.mul(s).add(new Complex(norm[i], 0));
    return result;
  }

  for (let iter = 0; iter < 500; iter++) {
    let maxDelta = 0;
    const next = roots.slice();
    for (let i = 0; i < n; i++) {
      let denom = new Complex(1, 0);
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        denom = denom.mul(roots[i].sub(roots[j]));
      }
      const delta = evalMonic(roots[i]).div(denom);
      next[i] = roots[i].sub(delta);
      maxDelta = Math.max(maxDelta, delta.abs());
    }
    roots = next;
    if (maxDelta < 1e-12) break;
  }
  return roots;
}

function poleZeroMap(netlist, outputNode) {
  const order = Math.max(1, countReactiveOrder(netlist));
  const { bCoeffs, aCoeffs, w0 } = fitTransferFunction(netlist, outputNode, order);
  const zerosSigma = polyRoots(bCoeffs);
  const polesSigma = polyRoots(aCoeffs);
  const scale = (r) => new Complex(r.re * w0, r.im * w0);
  return { zeros: zerosSigma.map(scale), poles: polesSigma.map(scale), bCoeffs, aCoeffs, w0 };
}

const api = { poleZeroMap, polyRoots, fitTransferFunction, characteristicOmega };
if (typeof module !== "undefined") module.exports = api;
if (typeof window !== "undefined") window.PoleZero = api;
})();
