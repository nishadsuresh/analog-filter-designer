// Phase 4 acceptance test: Bode (reuses the already-verified AC sweep),
// pole-zero map (new symbolic solver), and transient step response (new
// trapezoidal companion-model solver), each checked against closed-form
// analytic results -- not just "the plot rendered."

const { acSweep } = require("../engine/mna");
const { poleZeroMap } = require("../engine/pole_zero");
const { simulateTransient } = require("../engine/transient");

function assertClose(actual, expected, tol, label) {
  const err = Math.abs(actual - expected) / (Math.abs(expected) || 1);
  const status = err < tol ? "PASS" : "FAIL";
  console.log(`  ${status} ${label}: actual=${actual.toFixed(8)} expected=${expected.toFixed(8)} rel_err=${err.toExponential(3)}`);
  return err < tol;
}

const R = 1000, C = 1e-6;
const rcNetlist = {
  numNodes: 2,
  components: [
    { type: "V", nodes: [1, 0], value: 1 },
    { type: "R", nodes: [1, 2], value: R },
    { type: "C", nodes: [2, 0], value: C },
  ],
};

function testBode() {
  console.log("Bode (reuse of verified AC sweep, sanity spot-check):");
  const sweep = acSweep(rcNetlist, [1 / (2 * Math.PI * R * C)]); // corner freq -> -3dB, -45deg
  const H = sweep[0].voltages[2];
  const magDb = 20 * Math.log10(H.abs());
  const phaseDeg = H.phaseDeg();
  const passMag = assertClose(magDb, -3.0103, 1e-3, "corner freq magnitude (dB)");
  const passPhase = assertClose(phaseDeg, -45, 1e-6, "corner freq phase (deg)");
  return passMag && passPhase;
}

function testPoleZero() {
  console.log("\nPole-zero map (Levy's-method transfer-function fit + Durand-Kerner root finder):");
  const { poles, zeros } = poleZeroMap(rcNetlist, 2);
  // RC low-pass: H(s) = 1/(1+sRC) -> single real pole at s = -1/(RC), no finite zeros.
  const expectedPole = -1 / (R * C);
  console.log(`  RC low-pass poles: ${poles.map((p) => `${p.re.toFixed(4)}${p.im >= 0 ? "+" : ""}${p.im.toFixed(4)}i`).join(", ")}`);
  console.log(`  RC low-pass zeros: ${zeros.length === 0 ? "(none)" : zeros.map((z) => `${z.re.toFixed(4)}${z.im >= 0 ? "+" : ""}${z.im.toFixed(4)}i`).join(", ")}`);
  let pass = poles.length === 1 && assertClose(poles[0].re, expectedPole, 1e-3, "RC pole real part") && Math.abs(poles[0].im) < 1e-3;

  // Sallen-Key unity-gain LPF (critically damped, R1=R2=10k, C1=C2=10nF):
  // H(s)=1/(1+s(R1+R2)C2+s^2 R1R2C1C2) -> double real pole at s=-1/sqrt(R1R2C1C2).
  const R1 = 10000, R2 = 10000, C1 = 10e-9, C2 = 10e-9;
  const sk = {
    numNodes: 4,
    components: [
      { type: "V", nodes: [1, 0], value: 1 },
      { type: "R", nodes: [1, 2], value: R1 },
      { type: "R", nodes: [2, 3], value: R2 },
      { type: "C", nodes: [2, 4], value: C1 },
      { type: "C", nodes: [3, 0], value: C2 },
      { type: "OPAMP", nodes: [3, 4, 4] },
    ],
  };
  const skPZ = poleZeroMap(sk, 4);
  const skExpectedPole = -1 / Math.sqrt(R1 * R2 * C1 * C2);
  console.log(`  Sallen-Key LPF poles: ${skPZ.poles.map((p) => `${p.re.toFixed(4)}${p.im >= 0 ? "+" : ""}${p.im.toFixed(4)}i`).join(", ")}`);
  pass = pass && skPZ.poles.length === 2 && skPZ.poles.every((p) => assertClose(p.re, skExpectedPole, 1e-3, "Sallen-Key double pole") && Math.abs(p.im) < 1e-3);

  // Series RLC notch: zeros sit exactly on the jw axis at the resonant frequency.
  const Rn = 50, Ln = 4.7e-3, Cn = 470e-9;
  const notch = {
    numNodes: 3,
    components: [
      { type: "V", nodes: [1, 0], value: 1 },
      { type: "R", nodes: [1, 2], value: Rn },
      { type: "L", nodes: [2, 3], value: Ln },
      { type: "C", nodes: [3, 0], value: Cn },
    ],
  };
  const notchPZ = poleZeroMap(notch, 2);
  const w0 = 1 / Math.sqrt(Ln * Cn);
  console.log(`  Notch zeros: ${notchPZ.zeros.map((z) => `${z.re.toFixed(4)}${z.im >= 0 ? "+" : ""}${z.im.toFixed(4)}i`).join(", ")}`);
  pass = pass && notchPZ.zeros.length === 2 && notchPZ.zeros.every((z) => Math.abs(z.re) < 1e-3 * w0 && assertClose(Math.abs(z.im), w0, 1e-3, "notch zero on jw axis"));

  return pass;
}

function testTransientStep() {
  console.log("\nTransient step response (new trapezoidal companion-model solver):");
  const dt = (R * C) / 2000;
  const trace = simulateTransient(rcNetlist, { dt, tStop: 5 * R * C, inputValue: () => 1 });
  const checkTimes = [0.5 * R * C, 1 * R * C, 2 * R * C, 3 * R * C];
  let allPass = true;
  for (const tCheck of checkTimes) {
    const idx = Math.round(tCheck / dt);
    const actual = trace[idx].voltages[2];
    const expected = 1 - Math.exp(-trace[idx].t / (R * C));
    allPass = assertClose(actual, expected, 1e-3, `t=${(tCheck / (R * C)).toFixed(1)}*RC`) && allPass;
  }
  return allPass;
}

const results = [testBode(), testPoleZero(), testTransientStep()];
const allPass = results.every(Boolean);
console.log(`\nPhase 4 acceptance: ${allPass ? "PASS" : "FAIL"} (Bode + pole-zero + transient all match analytic RC low-pass)`);
process.exit(allPass ? 0 : 1);
