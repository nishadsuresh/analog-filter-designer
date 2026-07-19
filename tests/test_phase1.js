// Phase 1 acceptance test: MNA solver vs. analytic transfer functions for
// an RC low-pass and a series RLC circuit. ACCEPTANCE: max relative error < 1e-6.

const { solveAC } = require("../engine/mna");
const { Complex } = require("../engine/complex");

function assertClose(actual, expected, tol, label) {
  const err = actual.sub(expected).abs() / (expected.abs() || 1);
  const status = err < tol ? "PASS" : "FAIL";
  console.log(`  ${status} ${label}: actual=(${actual.re.toFixed(8)},${actual.im.toFixed(8)}i) expected=(${expected.re.toFixed(8)},${expected.im.toFixed(8)}i) rel_err=${err.toExponential(3)}`);
  return err < tol;
}

function testRCLowPass() {
  console.log("RC low-pass (R=1k, C=1uF):");
  const R = 1000;
  const C = 1e-6;
  const netlist = {
    numNodes: 2,
    components: [
      { type: "V", nodes: [1, 0], value: 1 },
      { type: "R", nodes: [1, 2], value: R },
      { type: "C", nodes: [2, 0], value: C },
    ],
  };

  const testFreqsHz = [10, 100, 159.155, 1000, 10000]; // 159.155Hz = the -3dB corner (1/(2*pi*R*C))
  let allPass = true;
  for (const f of testFreqsHz) {
    const omega = 2 * Math.PI * f;
    const voltages = solveAC(netlist, omega);
    const H_actual = voltages[2]; // output across C, input is 1V so this IS the transfer function directly

    // analytic: H(jw) = 1 / (1 + jwRC)
    const jwRC = new Complex(0, omega * R * C);
    const H_expected = new Complex(1, 0).div(new Complex(1, 0).add(jwRC));

    allPass = assertClose(H_actual, H_expected, 1e-6, `f=${f}Hz`) && allPass;
  }
  return allPass;
}

function testSeriesRLC() {
  console.log("\nSeries RLC (R=10, L=1mH, C=1uF), output across C:");
  const R = 10;
  const L = 1e-3;
  const C = 1e-6;
  const netlist = {
    numNodes: 3,
    components: [
      { type: "V", nodes: [1, 0], value: 1 },
      { type: "R", nodes: [1, 2], value: R },
      { type: "L", nodes: [2, 3], value: L },
      { type: "C", nodes: [3, 0], value: C },
    ],
  };

  // resonant freq f0 = 1/(2*pi*sqrt(LC))
  const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
  const testFreqsHz = [f0 / 10, f0 / 2, f0, f0 * 2, f0 * 10];
  let allPass = true;
  for (const f of testFreqsHz) {
    const omega = 2 * Math.PI * f;
    const voltages = solveAC(netlist, omega);
    const H_actual = voltages[3];

    const Zr = new Complex(R, 0);
    const Zl = new Complex(0, omega * L);
    const Zc = new Complex(0, -1 / (omega * C));
    const H_expected = Zc.div(Zr.add(Zl).add(Zc));

    allPass = assertClose(H_actual, H_expected, 1e-6, `f=${f.toFixed(2)}Hz`) && allPass;
  }
  return allPass;
}

const rcPass = testRCLowPass();
const rlcPass = testSeriesRLC();
const allPass = rcPass && rlcPass;
console.log(`\nPhase 1 acceptance: ${allPass ? "PASS" : "FAIL"} (need max rel error < 1e-6)`);
process.exit(allPass ? 0 : 1);
