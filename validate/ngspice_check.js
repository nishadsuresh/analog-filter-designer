// ngspice_check.js -- real SPICE cross-validation for the Phase 2 filter
// suite, using ngspice in batch mode. Runs alongside (doesn't replace) the
// analytic-transfer-function suite in tests/test_phase2.js -- same six
// filters, same component values, so both checks are validating the exact
// same circuits against two independent sources of truth (closed-form math
// vs. a real industry-standard SPICE engine).
//
// Requires `ngspice` on PATH. Ideal op-amps are modeled as a VCVS (E
// element) with a very high gain (1e6) -- the standard SPICE trick for an
// "ideal" op-amp, since ngspice has no built-in ideal-op-amp primitive.

const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { solveAC } = require("../engine/mna");

function runNgspice(netlist, probeNode1, probeNode2) {
  const tmpFile = path.join(os.tmpdir(), `ngcheck_${Date.now()}_${Math.random().toString(36).slice(2)}.cir`);
  const probe = probeNode2 !== undefined ? `${probeNode1},${probeNode2}` : `${probeNode1}`;
  const full = netlist.replace("__PRINT__", `print vm(${probe}) vp(${probe})`);
  fs.writeFileSync(tmpFile, full);
  let out;
  try {
    out = execSync(`ngspice -b ${tmpFile}`, { encoding: "utf8" });
  } catch (e) {
    // ngspice exits non-zero for benign reasons (e.g. its own harmless
    // "no .plot/.print/.fourier lines" note about a different internal
    // pass) even when the AC analysis itself completed and printed valid
    // data -- the data we need is still on stdout, so use it rather than
    // treating a non-zero exit as a hard failure.
    if (!e.stdout) throw e;
    out = e.stdout;
  } finally {
    fs.unlinkSync(tmpFile);
  }

  const lines = out.split("\n");
  const dataStart = lines.findIndex((l) => l.trim().startsWith("Index"));
  const freqs = [], mags = [], phases = [];
  for (let i = dataStart + 2; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length < 4 || isNaN(parseFloat(parts[1]))) continue;
    freqs.push(parseFloat(parts[1]));
    mags.push(parseFloat(parts[2]));
    phases.push(parseFloat(parts[3]));
  }
  return { freqs, mags, phases };
}

function compare(name, netlistBody, probeNode1, probeNode2, jsNetlist, jsOutputNode, fStart, fStop, tol) {
  const netlist = `AC sweep\nV1 1 0 AC 1\n${netlistBody}\n.control\nac dec 25 ${fStart} ${fStop}\n__PRINT__\n.endc\n.end\n`;
  const { freqs, mags, phases } = runNgspice(netlist, probeNode1, probeNode2);

  let maxErr = 0;
  const rows = [];
  for (let i = 0; i < freqs.length; i++) {
    const omega = 2 * Math.PI * freqs[i];
    const voltages = solveAC(jsNetlist, omega);
    let jsV;
    if (Array.isArray(jsOutputNode)) {
      jsV = voltages[jsOutputNode[0]].sub(voltages[jsOutputNode[1]]);
    } else {
      jsV = voltages[jsOutputNode];
    }
    const jsMagDb = 20 * Math.log10(jsV.abs());
    const spiceMagDb = 20 * Math.log10(mags[i]);
    const errDb = Math.abs(jsMagDb - spiceMagDb);
    maxErr = Math.max(maxErr, errDb);
    rows.push({ f: freqs[i], js_db: jsMagDb, spice_db: spiceMagDb, err_db: errDb });
  }

  const status = maxErr < tol ? "PASS" : "FAIL";
  console.log(`  ${status} ${name}: max magnitude error = ${maxErr.toFixed(4)} dB (tol ${tol} dB) across ${freqs.length} points`);
  return { name, pass: maxErr < tol, maxErrDb: maxErr, rows };
}

const results = [];

// 1. RC low-pass (R=2.2k, C=100nF)
results.push(compare(
  "RC low-pass",
  `R1 1 2 2200\nC1 2 0 100n`,
  2, undefined,
  { numNodes: 2, components: [{ type: "V", nodes: [1, 0], value: 1 }, { type: "R", nodes: [1, 2], value: 2200 }, { type: "C", nodes: [2, 0], value: 100e-9 }] },
  2, 7.23, 72343, 0.1
));

// 2. RC high-pass (R=4.7k, C=47nF)
results.push(compare(
  "RC high-pass",
  `C1 1 2 47n\nR1 2 0 4700`,
  2, undefined,
  { numNodes: 2, components: [{ type: "V", nodes: [1, 0], value: 1 }, { type: "C", nodes: [1, 2], value: 47e-9 }, { type: "R", nodes: [2, 0], value: 4700 }] },
  2, 7.2, 72048, 0.1
));

// 3. Series RLC band-pass (R=22, L=10mH, C=220nF), output across R (v1-v2)
results.push(compare(
  "Series RLC band-pass",
  `R1 1 2 22\nL1 2 3 10m\nC1 3 0 220n`,
  1, 2,
  { numNodes: 3, components: [{ type: "V", nodes: [1, 0], value: 1 }, { type: "R", nodes: [1, 2], value: 22 }, { type: "L", nodes: [2, 3], value: 10e-3 }, { type: "C", nodes: [3, 0], value: 220e-9 }] },
  [1, 2], 169.7, 67864, 0.1
));

// 4. Series RLC notch (R=50, L=4.7mH, C=470nF), output at node 2 (across L+C)
results.push(compare(
  "Series RLC notch",
  `R1 1 2 50\nL1 2 3 4.7m\nC1 3 0 470n`,
  2, undefined,
  { numNodes: 3, components: [{ type: "V", nodes: [1, 0], value: 1 }, { type: "R", nodes: [1, 2], value: 50 }, { type: "L", nodes: [2, 3], value: 4.7e-3 }, { type: "C", nodes: [3, 0], value: 470e-9 }] },
  2, 169.3, 67726, 0.5 // wider tolerance: this sweep straddles the exact notch null (-inf dB), where dB error is ill-conditioned
));

// 5. Sallen-Key unity-gain low-pass (R1=R2=10k, C1=C2=10nF)
results.push(compare(
  "Sallen-Key low-pass",
  `R1 1 2 10k\nR2 2 3 10k\nC1 2 4 10n\nC2 3 0 10n\nEopamp 4 0 3 4 1e6`,
  4, undefined,
  { numNodes: 4, components: [{ type: "V", nodes: [1, 0], value: 1 }, { type: "R", nodes: [1, 2], value: 10000 }, { type: "R", nodes: [2, 3], value: 10000 }, { type: "C", nodes: [2, 4], value: 10e-9 }, { type: "C", nodes: [3, 0], value: 10e-9 }, { type: "OPAMP", nodes: [3, 4, 4] }] },
  4, 31.83, 79577, 0.1
));

// 6. Sallen-Key unity-gain high-pass (R1=R2=8.2k, C1=C2=22nF)
results.push(compare(
  "Sallen-Key high-pass",
  `C1 1 2 22n\nC2 2 3 22n\nR1 2 4 8200\nR2 3 0 8200\nEopamp 4 0 3 4 1e6`,
  4, undefined,
  { numNodes: 4, components: [{ type: "V", nodes: [1, 0], value: 1 }, { type: "C", nodes: [1, 2], value: 22e-9 }, { type: "C", nodes: [2, 3], value: 22e-9 }, { type: "R", nodes: [2, 4], value: 8200 }, { type: "R", nodes: [3, 0], value: 8200 }, { type: "OPAMP", nodes: [3, 4, 4] }] },
  4, 17.64, 44112, 0.1
));

const allPass = results.every((r) => r.pass);
console.log(`\nngspice cross-validation: ${allPass ? "PASS" : "FAIL"} (${results.filter((r) => r.pass).length}/${results.length} filters)`);

const resultsDir = path.join(__dirname, "..", "results");
if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
fs.writeFileSync(
  path.join(resultsDir, "phase2_ngspice_comparison.json"),
  JSON.stringify(results.map((r) => ({ name: r.name, pass: r.pass, maxErrDb: r.maxErrDb })), null, 2)
);
console.log(`saved ${path.join(resultsDir, "phase2_ngspice_comparison.json")}`);

process.exit(allPass ? 0 : 1);
