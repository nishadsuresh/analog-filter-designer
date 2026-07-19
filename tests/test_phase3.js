// Phase 3 acceptance test: "I can click together an RC low-pass and it
// solves." Since there's no browser test runner in this environment, this
// drives the exact same schematic-to-netlist logic the UI uses
// (ui/circuit.js) with a click sequence that mirrors what a user would do
// on the canvas, then checks the solver's output against the known analytic
// RC low-pass transfer function -- numeric verification, not just "the UI
// loaded" (see numeric-verification-methodology in the vault).

const { buildNetlistFromElements } = require("../ui/circuit");
const { solveAC } = require("../engine/mna");
const { Complex } = require("../engine/complex");

function simulateClickingRCLowPass() {
  // Grid layout a user would click: V source from (0,0) to (0,1) [ground to
  // input], R from (0,1) to (0,2), C from (0,2) to (0,3), then a GND click
  // on (0,3) and a WIRE closing the loop back to the source's negative
  // terminal at (0,0).
  const R = 1000, C = 1e-6;
  return [
    { type: "V", points: [{ x: 0, y: 1 }, { x: 0, y: 0 }], value: 1 },
    { type: "GND", points: [{ x: 0, y: 0 }] },
    { type: "R", points: [{ x: 0, y: 1 }, { x: 0, y: 2 }], value: R },
    { type: "C", points: [{ x: 0, y: 2 }, { x: 0, y: 3 }], value: C },
    { type: "GND", points: [{ x: 0, y: 3 }] },
  ];
}

function main() {
  const R = 1000, C = 1e-6;
  const elements = simulateClickingRCLowPass();
  const { netlist, nodeOf } = buildNetlistFromElements(elements);

  console.log(`Built netlist from ${elements.length} clicked elements: numNodes=${netlist.numNodes}, components=${netlist.components.length}`);

  const outputNode = nodeOf({ x: 0, y: 2 }); // node between R and C = filter output
  const testFreqsHz = [10, 100, 159.155, 1000, 10000];
  let allPass = true;
  for (const f of testFreqsHz) {
    const omega = 2 * Math.PI * f;
    const voltages = solveAC(netlist, omega);
    const actual = voltages[outputNode];
    const expected = new Complex(1, 0).div(new Complex(1, omega * R * C));
    const err = actual.sub(expected).abs() / (expected.abs() || 1);
    const status = err < 1e-6 ? "PASS" : "FAIL";
    if (status === "FAIL") allPass = false;
    console.log(`  ${status} f=${f}Hz: actual=(${actual.re.toFixed(6)},${actual.im.toFixed(6)}i) expected=(${expected.re.toFixed(6)},${expected.im.toFixed(6)}i) rel_err=${err.toExponential(3)}`);
  }

  console.log(`\nPhase 3 acceptance: ${allPass ? "PASS" : "FAIL"} (clicked-together RC low-pass solves correctly, max rel error < 1e-6)`);
  process.exit(allPass ? 0 : 1);
}

main();
