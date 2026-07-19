// Phase 2 acceptance test: extended reference-filter validation suite.
// No ngspice available in this environment (no passwordless sudo for
// `apt-get install ngspice`) -- substituted with an extended analytic
// transfer-function suite across more topologies, per the vault's
// ee-project-d-filter-designer.md fallback plan. ACCEPTANCE: agreement
// within 1e-6 relative error across >=5 filters spanning passive RC,
// passive RLC, and active (op-amp) topologies.

const { solveAC } = require("../engine/mna");
const { Complex } = require("../engine/complex");

function assertClose(actual, expected, tol, label) {
  // At an exact notch null both actual and expected are ~0, so a plain
  // relative error blows up on floating-point noise -- floor the
  // denominator so we fall back to an absolute-error check there.
  const absErr = actual.sub(expected).abs();
  const denom = Math.max(expected.abs(), 1e-9);
  const err = absErr / denom;
  const status = err < tol ? "PASS" : "FAIL";
  console.log(`  ${status} ${label}: actual=(${actual.re.toFixed(8)},${actual.im.toFixed(8)}i) expected=(${expected.re.toFixed(8)},${expected.im.toFixed(8)}i) rel_err=${err.toExponential(3)}`);
  return err < tol;
}

function runSweep(name, netlist, freqsHz, getActual, getExpected, tol) {
  console.log(`\n${name}:`);
  let allPass = true;
  for (const f of freqsHz) {
    const omega = 2 * Math.PI * f;
    const voltages = solveAC(netlist, omega);
    const actual = getActual(voltages, omega);
    const expected = getExpected(omega);
    allPass = assertClose(actual, expected, tol, `f=${f.toFixed(2)}Hz`) && allPass;
  }
  return allPass;
}

// 1. RC low-pass, output across C. H(jw) = 1/(1+jwRC)
function testRCLowPass() {
  const R = 2200, C = 100e-9;
  const netlist = {
    numNodes: 2,
    components: [
      { type: "V", nodes: [1, 0], value: 1 },
      { type: "R", nodes: [1, 2], value: R },
      { type: "C", nodes: [2, 0], value: C },
    ],
  };
  const f0 = 1 / (2 * Math.PI * R * C);
  const freqs = [f0 / 100, f0 / 10, f0, f0 * 10, f0 * 100];
  return runSweep(
    "RC low-pass (R=2.2k, C=100nF)",
    netlist,
    freqs,
    (v) => v[2],
    (w) => new Complex(1, 0).div(new Complex(1, w * R * C)),
    1e-6
  );
}

// 2. RC high-pass, output across R. H(jw) = jwRC/(1+jwRC)
function testRCHighPass() {
  const R = 4700, C = 47e-9;
  const netlist = {
    numNodes: 2,
    components: [
      { type: "V", nodes: [1, 0], value: 1 },
      { type: "C", nodes: [1, 2], value: C },
      { type: "R", nodes: [2, 0], value: R },
    ],
  };
  const f0 = 1 / (2 * Math.PI * R * C);
  const freqs = [f0 / 100, f0 / 10, f0, f0 * 10, f0 * 100];
  return runSweep(
    "RC high-pass (R=4.7k, C=47nF)",
    netlist,
    freqs,
    (v) => v[2],
    (w) => new Complex(0, w * R * C).div(new Complex(1, w * R * C)),
    1e-6
  );
}

// 3. Series RLC band-pass, output across R. H(jw) = R/(R+jwL+1/(jwC))
function testRLCBandPass() {
  const R = 22, L = 10e-3, C = 220e-9;
  const netlist = {
    numNodes: 3,
    components: [
      { type: "V", nodes: [1, 0], value: 1 },
      { type: "R", nodes: [1, 2], value: R },
      { type: "L", nodes: [2, 3], value: L },
      { type: "C", nodes: [3, 0], value: C },
    ],
  };
  const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
  const freqs = [f0 / 20, f0 / 4, f0, f0 * 4, f0 * 20];
  return runSweep(
    "Series RLC band-pass (R=22, L=10mH, C=220nF), output across R",
    netlist,
    freqs,
    (v) => v[1].sub(v[2]),
    (w) => {
      const Zr = new Complex(R, 0);
      const Zl = new Complex(0, w * L);
      const Zc = new Complex(0, -1 / (w * C));
      return Zr.div(Zr.add(Zl).add(Zc));
    },
    1e-6
  );
}

// 4. Series RLC notch (band-stop), output across the L+C combo (= node
// between R and L, since ground closes the loop after C).
// H(jw) = (jwL + 1/(jwC)) / (R+jwL+1/(jwC))
function testRLCNotch() {
  const R = 50, L = 4.7e-3, C = 470e-9;
  const netlist = {
    numNodes: 3,
    components: [
      { type: "V", nodes: [1, 0], value: 1 },
      { type: "R", nodes: [1, 2], value: R },
      { type: "L", nodes: [2, 3], value: L },
      { type: "C", nodes: [3, 0], value: C },
    ],
  };
  const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
  const freqs = [f0 / 20, f0 / 4, f0, f0 * 4, f0 * 20];
  return runSweep(
    "Series RLC notch (R=50, L=4.7mH, C=470nF), output across L+C",
    netlist,
    freqs,
    (v) => v[2],
    (w) => {
      const Zr = new Complex(R, 0);
      const Zlc = new Complex(0, w * L - 1 / (w * C));
      return Zlc.div(Zr.add(Zlc));
    },
    1e-6
  );
}

// 5. Sallen-Key unity-gain low-pass (ideal op-amp voltage follower).
// Derived from scratch via nodal analysis (see ee-project-d vault page):
// H(s) = 1 / (1 + s(R1+R2)C2 + s^2 R1 R2 C1 C2)
// Netlist: Vin -R1- Va -R2- Vb(=opamp +in) ; C1 feedback Va->Vout ; C2 Vb->ground ;
// Vout is a distinct node from Vb, tied to it only via the op-amp's ideal buffer
// constraint (vplus=Vb, vminus=vout, since the feedback wire makes vminus and vout
// the same physical node).
function testSallenKeyLowPass() {
  const R1 = 10000, R2 = 10000, C1 = 10e-9, C2 = 10e-9;
  const netlist = {
    numNodes: 4, // 1=in, 2=Va, 3=Vb, 4=Vout(=vminus)
    components: [
      { type: "V", nodes: [1, 0], value: 1 },
      { type: "R", nodes: [1, 2], value: R1 },
      { type: "R", nodes: [2, 3], value: R2 },
      { type: "C", nodes: [2, 4], value: C1 }, // feedback cap Va -> Vout
      { type: "C", nodes: [3, 0], value: C2 },
      { type: "OPAMP", nodes: [3, 4, 4] }, // + = Vb(3), - = out = Vout(4)
    ],
  };
  const f0 = 1 / (2 * Math.PI * Math.sqrt(R1 * R2 * C1 * C2));
  const freqs = [f0 / 50, f0 / 5, f0, f0 * 5, f0 * 50];
  return runSweep(
    "Sallen-Key unity-gain low-pass (R1=R2=10k, C1=C2=10nF)",
    netlist,
    freqs,
    (v) => v[4],
    (w) => {
      const denom = new Complex(1, w * (R1 + R2) * C2).sub(new Complex(w * w * R1 * R2 * C1 * C2, 0));
      return new Complex(1, 0).div(denom);
    },
    1e-6
  );
}

// 6. Sallen-Key unity-gain high-pass (dual topology: C1,C2 first, R1,R2 to ground/output).
// H(s) = s^2 R1 R2 C1 C2 / (1 + s R1(C1+C2) + s^2 R1 R2 C1 C2)
// Netlist: Vin -C1- Va -C2- Vb(=opamp +in) ; R1 feedback Va->Vout ; R2 Vb->ground ;
// Vout distinct node from Vb, same op-amp-constraint pattern as the LPF above.
function testSallenKeyHighPass() {
  const R1 = 8200, R2 = 8200, C1 = 22e-9, C2 = 22e-9;
  const netlist = {
    numNodes: 4, // 1=in, 2=Va, 3=Vb, 4=Vout(=vminus)
    components: [
      { type: "V", nodes: [1, 0], value: 1 },
      { type: "C", nodes: [1, 2], value: C1 },
      { type: "C", nodes: [2, 3], value: C2 },
      { type: "R", nodes: [2, 4], value: R1 }, // feedback R: Va -> Vout
      { type: "R", nodes: [3, 0], value: R2 },
      { type: "OPAMP", nodes: [3, 4, 4] }, // + = Vb(3), - = out = Vout(4)
    ],
  };
  const f0 = 1 / (2 * Math.PI * Math.sqrt(R1 * R2 * C1 * C2));
  const freqs = [f0 / 50, f0 / 5, f0, f0 * 5, f0 * 50];
  return runSweep(
    "Sallen-Key unity-gain high-pass (R1=R2=8.2k, C1=C2=22nF)",
    netlist,
    freqs,
    (v) => v[4],
    (w) => {
      const num = new Complex(-(w * w) * R1 * R2 * C1 * C2, 0);
      const denom = new Complex(1, w * R1 * (C1 + C2)).sub(new Complex(w * w * R1 * R2 * C1 * C2, 0));
      return num.div(denom);
    },
    1e-6
  );
}

const results = [
  testRCLowPass(),
  testRCHighPass(),
  testRLCBandPass(),
  testRLCNotch(),
  testSallenKeyLowPass(),
  testSallenKeyHighPass(),
];
const allPass = results.every(Boolean);
console.log(`\nPhase 2 acceptance: ${allPass ? "PASS" : "FAIL"} (${results.filter(Boolean).length}/${results.length} filters, need max rel error < 1e-6 on each)`);
process.exit(allPass ? 0 : 1);
