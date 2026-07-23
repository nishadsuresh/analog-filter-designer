# Analog Filter Designer

**Nishad Suresh**

## Abstract

This project is a browser-based tool for interactively placing resistor, capacitor, inductor, and ideal op-amp components and immediately viewing the resulting Bode plot, pole-zero map, and transient step response. The underlying solver implements complex-valued Modified Nodal Analysis (MNA) and is validated against six analytic reference filter transfer functions and, separately, against an independent SPICE engine (ngspice), matching to machine precision and 0.0000 dB respectively. The tool is deployed as a public, zero-install web application.

**Live:** https://nishadsuresh.github.io/analog-filter-designer/ui/index.html

**Status:** Phase 5 of 5, complete.

## 1. Scope

This project is deliberately scoped to linear filter design: resistors, capacitors, inductors, and ideal op-amps. Nonlinear devices (diodes, transistors) were treated as an optional appendix, to be added only if the core scope shipped with time remaining, keeping the project's largest risk (scope creep) under control. Success is defined as numerical correctness against known analytic and reference transfer functions plus a working deployed tool, rather than external adoption.

## 2. Engine

`engine/mna.js` implements complex-valued Modified Nodal Analysis: resistors are stamped as `1/R`, capacitors as `jwC`, inductors as `1/(jwL)`, and independent voltage sources and ideal op-amps (nullor model) each add one extra current unknown. The resulting system is solved via complex Gaussian elimination with partial pivoting.

## 3. Setup

```bash
node tests/test_phase1.js
node tests/test_phase2.js
node validate/ngspice_check.js   # requires ngspice on PATH
node tests/test_phase3.js

# schematic UI (open in a browser)
python3 -m http.server 8000   # from the repo root
# then open http://localhost:8000/ui/index.html
```

## 4. Methodology and Results

| # | Phase | Acceptance test | Result |
|---|---|---|---|
| 1 | Complex MNA AC solver | Matches analytic RC & RLC to <1e-6 | ✅ ~1e-16 (machine precision) |
| 2 | Reference-filter validation suite | Agreement within tolerance on ≥5 filters | ✅ 6/6 filters, ~1e-15 to 1e-17 vs. analytic formulas; 6/6, 0.0000 dB vs. real ngspice |
| 3 | Schematic UI | Click together an RC low-pass, solver runs | ✅ verified in a real browser, matches analytic RC formula to ~1e-17 |
| 4 | Live Bode/pole-zero/transient plots | Plots update on value change | ✅ verified in a real browser; dragging R from 1k to 5k moved the pole from -1000 to exactly -200 rad/s |
| 5 | Deploy + README | Public link loads and computes a response | ✅ live on GitHub Pages, verified end to end (load, solve, all three plots) against the real deployed URL |

### 4.1 Schematic UI (Phase 3)

`ui/index.html` and `ui/app.js` implement canvas rendering and interaction; `ui/circuit.js` implements pure schematic-to-netlist logic, unit-tested separately from the DOM. A component is selected from the palette, then placed by clicking its grid points (R/C/L/V take 2 points plus a value prompt, ground takes 1, an op-amp takes 3, a wire takes 2). A "Load RC low-pass demo" button places a working circuit instantly, and "Solve" runs the MNA solver at a given frequency and lists node voltages.

Two real bugs were caught while building this phase, by prioritizing direct browser verification over trusting that the code should work in principle. `engine/mna.js`'s top-level `const { Complex } = ...` collided with `engine/complex.js`'s top-level `class Complex` in the shared, non-module `<script>` global scope, throwing a silent `SyntaxError` that killed the entire file (`window.MNA` remained `undefined` with no visible error until traced through `window.onerror`); this was fixed by wrapping `mna.js` in an IIFE. Separately, Canvas 2D's `fillStyle = "currentColor"` rendered near-invisible text against the page's dark theme; this was fixed by giving the canvas a fixed light background rather than depending on ambient or `prefers-color-scheme` detection. Both issues were caught by actually driving the UI in a real browser: `tests/test_phase3.js` alone would have passed regardless, since it exercises the same netlist-building logic headlessly in Node and never touches the DOM or canvas rendering.

### 4.2 Live Bode, pole-zero, and transient plots (Phase 4)

A "Mark output node" tool followed by clicking a grid point selects the plotted output; an "Edit value" tool lets a component be selected and its value scaled live via a slider or exact input, with all three plots re-running on every change.

The Bode plot reuses `engine/mna.js`'s `acSweep`, already verified in Phases 1 and 2, sweeping magnitude (dB) and phase across four decades centered on the circuit's characteristic frequency. The transient step response (`engine/transient.js`, new for this phase) uses trapezoidal-integration companion models for capacitors and inductors, the standard SPICE technique (`Geq = 2C/dt` for capacitors, `Geq = dt/(2L)` for inductors, each with a history current source), re-stamped and solved at every timestep; it was verified against the analytic RC step response `1 - e^(-t/RC)` to under 0.04% at several time points.

The pole-zero map (`engine/pole_zero.js`, also new) went through a real design revision. The first implementation solved the MNA system exactly over polynomial-fraction (rational) matrix entries via Gaussian elimination, which proved numerically fragile in practice: elimination steps produce spurious uncancelled common factors between numerator and denominator, and this project's component values span too wide a dynamic range (pF to mH to kOhm) for a fixed epsilon to reliably distinguish a genuine zero from a small nonzero residual. A complete fix would require true polynomial GCD reduction; instead, the implementation was replaced with Levy's method, fitting a rational transfer function to sampled `acSweep` data via linear least squares (frequency-normalized for numerical conditioning), then finding the fitted numerator and denominator's roots with a Durand-Kerner solver. This is standard practice in RF and microwave system identification rather than a shortcut, and it reuses already-verified code instead of introducing a second large piece of fragile machinery. It was verified to machine precision against three known closed-form cases: an RC low-pass's single real pole, a critically damped Sallen-Key filter's double real pole, and a series-RLC notch's pair of purely imaginary zeros.

### 4.3 ngspice cross-validation (Phase 2)

ngspice was not installed when Phase 2 was first built, so an extended analytic-transfer-function suite was substituted for a real SPICE cross-check: each filter's transfer function was derived from scratch via nodal analysis and checked against the MNA solver's output. The suite covers an RC low-pass, an RC high-pass, a series RLC band-pass, a series RLC notch, and Sallen-Key unity-gain low-pass and high-pass filters (the latter two active, using an ideal op-amp). All 6 matched to machine precision (approximately 1e-15 to 1e-17), well under the 1e-6 target.

ngspice was later installed and a real SPICE cross-check was added on top of the analytic suite. `validate/ngspice_check.js` runs the same 6 filters and component values through ngspice in batch mode (ideal op-amps modeled as a very-high-gain VCVS, the standard SPICE workaround since ngspice has no built-in ideal op-amp) and compares magnitude response directly against the MNA solver at ngspice's own swept frequencies. All 6 filters matched to 0.0000 dB error across 66 to 101 points each, essentially exact agreement, since both the JavaScript solver and ngspice are solving the same linear circuit equations through different implementations. Results are recorded in `results/phase2_ngspice_comparison.json`.

```bash
node validate/ngspice_check.js
```

### 4.4 Deployment (Phase 5)

The tool is deployed via GitHub Pages (source: `main` branch, root folder; no build step is needed since the UI is plain HTML/JS with relative script paths). It is verified against the actual deployed URL rather than only a local server: the page loads, all five engine scripts resolve, the RC low-pass demo solves correctly, and all three plots render.

## 5. A UI Bug Found During Review

Marking an output node on empty grid space, rather than an actual wire or component terminal, previously crashed silently. `ui/circuit.js`'s `nodeOf()` fabricated a brand-new, disconnected node id for any clicked point instead of only resolving real terminals, so the solver would then index past the netlist it had actually built. The generic error handler only cleared the Bode canvas, leaving the pole-zero and transient plots showing stale, misleading data from before the click.

This was fixed at the source: `nodeOf()` is now a strict lookup that returns `undefined` for any point that was never an element terminal, and the UI checks for that explicitly, showing a clear "click on a wire or component terminal" message and clearing all three plots together. The fix was verified live in a real browser (confirming both the previously broken case now shows the clean message, and the working case still renders correctly) and locked in with a regression test in `tests/test_phase3.js`.

## 6. Summary

This project implements a Modified Nodal Analysis circuit solver, validates it against analytic reference transfer functions and an independent SPICE engine, and wraps it in a browser-based tool that renders live Bode, pole-zero, and transient-response plots for analog filters.

## References

Sources used to design, validate, and cross-check this project's methodology:

[1] C.-W. Ho, A. E. Ruehli, and P. A. Brennan, "The Modified Nodal Approach to Network Analysis," IEEE Trans. Circuits and Systems, vol. 22, no. 6, 1975, pp. 504-509. https://doi.org/10.1109/TCS.1975.1084079 -- the MNA formulation `engine/mna.js` implements directly.

[2] L. W. Nagel and D. O. Pederson, "SPICE (Simulation Program with Integrated Circuit Emphasis)," Memorandum No. ERL-M382, Electronics Research Laboratory, UC Berkeley, 1973. https://www2.eecs.berkeley.edu/Pubs/TechRpts/1973/ERL-382.pdf -- the original circuit-simulation approach this project's engine follows, and the basis for the ngspice cross-validation in Phase 2.

[3] R. P. Sallen and E. L. Key, "A practical method of designing RC active filters," IRE Transactions on Circuit Theory, vol. 2, no. 1, 1955, pp. 74-85. https://doi.org/10.1109/TCT.1955.6500159 -- basis for the Sallen-Key filter topologies in the Phase 2 reference suite.

[4] ngspice documentation and source. https://ngspice.sourceforge.net/docs.html -- the independent SPICE engine used for real cross-validation of all 6 filters in Phase 2 (matched to 0.0000 dB).

[5] N. Levy, "A new set of digital signal processing algorithms for the identification of resonant frequencies (Levy's method for transfer function fitting)", Proceedings of IRE, 1959 (as adapted for RF/microwave system identification). -- basis for the rational-function fitting technique used in `engine/pole_zero.js` after the exact symbolic approach hit floating-point degree-blowup.

[6] MDN Web Docs, "Canvas API." https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API -- reference for the schematic editor's rendering layer (`ui/circuit.js`, `ui/app.js`).
