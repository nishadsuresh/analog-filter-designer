# analog-filter-designer

A browser-based tool for placing R/L/C/op-amp components and instantly seeing the Bode plot, pole-zero map, and transient response — a free, zero-install analog-filter teaching tool.

**Live: https://nishadsuresh.github.io/analog-filter-designer/ui/index.html**

**Status: Phase 5 of 5 — complete.**

## Scope (deliberate)

Locked to **linear** filter design: resistors, capacitors, inductors, ideal op-amps. Nonlinear devices (diodes, transistors) are an optional appendix only if everything else ships — this keeps the project's biggest risk (scope creep) under control. Success is defined as correctness vs. known analytic/reference transfer functions plus a working deployed tool, not "adoption" (outside anyone's control on a deadline).

## Engine

`engine/mna.js` implements complex-valued Modified Nodal Analysis: R stamped as `1/R`, C as `jwC`, L as `1/(jwL)`, independent voltage sources and ideal op-amps (nullor model) each add one extra current unknown. Solved via complex Gaussian elimination with partial pivoting.

## Setup

```bash
node tests/test_phase1.js
node tests/test_phase2.js
node validate/ngspice_check.js   # requires ngspice on PATH
node tests/test_phase3.js

# schematic UI (open in a browser)
python3 -m http.server 8000   # from the repo root
# then open http://localhost:8000/ui/index.html
```

## Phases

| # | Phase | Acceptance test | Result |
|---|---|---|---|
| 1 | Complex MNA AC solver | Matches analytic RC & RLC to <1e-6 | ✅ **~1e-16** (machine precision) |
| 2 | Reference-filter validation suite | Agreement within tolerance on ≥5 filters | ✅ **6/6 filters, ~1e-15 to 1e-17** vs analytic formulas; **6/6, 0.0000 dB** vs real ngspice |
| 3 | Schematic UI | Click together an RC low-pass, solver runs | ✅ verified in a real browser, matches analytic RC formula to ~1e-17 |
| 4 | Live Bode/pole-zero/transient plots | Plots update on value change | ✅ verified in a real browser — dragging R from 1k to 5k moved the pole from -1000 to exactly -200 rad/s |
| 5 | Deploy + README | Public link loads and computes a response | ✅ live on GitHub Pages, verified end-to-end (load → solve → all three plots) against the real deployed URL, not just a local server |

### Phase 3: schematic UI

`ui/index.html` + `ui/app.js` (canvas rendering/interaction) + `ui/circuit.js` (pure schematic-to-netlist logic, unit-tested separately from the DOM). Click a component in the palette, then click its grid points to place it (R/C/L/V take 2 points + a value prompt, GND takes 1, op-amp takes 3, wire takes 2). A "Load RC low-pass demo" button places a working circuit instantly; "Solve" runs the MNA solver at a given frequency and lists node voltages.

Two real bugs I caught building this, by prioritizing numeric verification over trusting the code "should" work:
- `engine/mna.js`'s top-level `const { Complex } = ...` collided with `engine/complex.js`'s top-level `class Complex` in the shared non-module `<script>` global scope, throwing a silent `SyntaxError` that killed the whole file (`window.MNA` stayed `undefined` with no visible error until I traced it through `window.onerror`). Fixed by wrapping `mna.js` in an IIFE.
- Canvas 2D's `fillStyle = "currentColor"` rendered near-invisible text against the dark-themed page background. Fixed by giving the canvas its own fixed light background instead of depending on ambient/`prefers-color-scheme` detection.

I caught both by actually driving the UI in a real browser rather than trusting that the code "should" work — the automated `tests/test_phase3.js` alone would have passed either way, since it exercises the same netlist-building logic headlessly in Node and never touches the DOM or canvas rendering.

### Phase 4: live Bode / pole-zero / transient plots

Click "Mark output node" then a grid point to choose the plotted output; "Edit value" lets you click a component and drag a slider (or type an exact value) to scale it live — all three plots re-run on every change.

- **Bode plot** (`engine/mna.js`'s `acSweep`, already verified in Phases 1-2) — magnitude (dB) and phase, swept across 4 decades centered on the circuit's characteristic frequency.
- **Transient step response** (`engine/transient.js`, new) — trapezoidal-integration companion models for C and L (the standard SPICE technique: `Geq=2C/dt` for capacitors, `Geq=dt/(2L)` for inductors, each with a history current source), re-stamped and solved at every timestep. Verified against the analytic RC step response `1-e^(-t/RC)` to <0.04% at several time points.
- **Pole-zero map** (`engine/pole_zero.js`, new) — my first attempt at this solved the MNA system exactly over polynomial-fraction (Rational) matrix entries via Gaussian elimination. That turned out to be numerically fragile in practice: elimination steps produce spurious uncancelled common factors between numerator and denominator, and this project's component values span too wide a dynamic range (pF to mH to kOhm) for a fixed epsilon to safely tell "genuinely zero" from "tiny but real." Fully fixing that needs real polynomial GCD reduction, so I replaced it with **Levy's method** instead: fit a rational transfer function to sampled `acSweep` data via linear least squares (frequency-normalized for conditioning), then find the fitted numerator/denominator's roots with a Durand-Kerner solver. This is standard practice in RF/microwave system identification, not a shortcut — and it reuses already-verified code instead of adding a second large piece of fragile machinery. Verified to machine precision against three known cases: RC low-pass's single real pole, a critically-damped Sallen-Key's double real pole, and a series-RLC notch's pair of purely-imaginary zeros (all exact, closed-form results).

### Phase 2 note: ngspice cross-validation

I didn't have `ngspice` installed when I first built Phase 2, so I substituted an **extended analytic-transfer-function suite** instead of a real SPICE cross-check — each filter's transfer function derived from scratch via nodal analysis and checked against the MNA solver's output:

- RC low-pass, RC high-pass (passive)
- Series RLC band-pass, series RLC notch/band-stop (passive)
- Sallen-Key unity-gain low-pass, Sallen-Key unity-gain high-pass (active, ideal op-amp)

All 6 matched to machine precision (~1e-15–1e-17), well under the 1e-6 target.

### Phase 2b: real ngspice cross-validation

I later installed `ngspice` and added the real SPICE cross-check on top of the analytic suite above — `validate/ngspice_check.js` runs the same 6 filters, same component values, through ngspice in batch mode (ideal op-amps modeled as a very-high-gain VCVS, the standard SPICE trick since ngspice has no built-in ideal op-amp) and compares magnitude response directly against the MNA solver at ngspice's own swept frequencies. **All 6 filters matched to 0.0000 dB error** across 66-101 points each — essentially exact agreement, since both the JS solver and ngspice are solving the same linear circuit equations, just via different implementations. Results in `results/phase2_ngspice_comparison.json`.

```bash
node validate/ngspice_check.js
```

### Phase 5: deploy

Deployed via GitHub Pages (source: `main` branch, root folder — no build step needed since the UI is plain HTML/JS with relative script paths). Live at https://nishadsuresh.github.io/analog-filter-designer/ui/index.html, verified against the actual deployed URL (not just a local server): loads, all five engine scripts resolve, the RC low-pass demo solves correctly, and all three plots render.

## Quality pass: a real UI bug caught

Marking an output node on empty grid space (not an actual wire or component terminal) used to crash silently — `ui/circuit.js`'s `nodeOf()` fabricated a brand-new, disconnected node id for any point instead of only resolving real ones, so the solver would then index past the netlist it actually built. The generic error handler only cleared the Bode canvas, leaving the pole-zero and transient plots showing stale, misleading data from whatever was there before. Fixed at the source: `nodeOf()` is now a strict lookup that returns `undefined` for a point that was never an element terminal, and the UI checks for that explicitly with a clear "click on a wire or component terminal" message, clearing all three plots together. Verified live in a real browser (both the broken case now showing the clean message, and the working case still rendering correctly), and locked in with a regression test in `tests/test_phase3.js`.

## One-line summary

I wrote a Modified-Nodal-Analysis circuit solver, validated it against analytic reference transfer functions, and wrapped it in a browser tool that shows live Bode, pole-zero, and transient-response plots for analog filters.
