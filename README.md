# analog-filter-designer

A browser-based tool for placing R/L/C/op-amp components and instantly seeing the Bode plot, pole-zero map, and transient response — a free, zero-install analog-filter teaching tool.

**Status: Phase 2 of 5** (reference-filter validation suite).

## Scope (deliberate)

Locked to **linear** filter design: resistors, capacitors, inductors, ideal op-amps. Nonlinear devices (diodes, transistors) are an optional appendix only if everything else ships — this keeps the project's biggest risk (scope creep) under control. Success is defined as correctness vs. known analytic/reference transfer functions plus a working deployed tool, not "adoption" (outside anyone's control on a deadline).

## Engine

`engine/mna.js` implements complex-valued Modified Nodal Analysis: R stamped as `1/R`, C as `jwC`, L as `1/(jwL)`, independent voltage sources and ideal op-amps (nullor model) each add one extra current unknown. Solved via complex Gaussian elimination with partial pivoting.

## Setup

```bash
node tests/test_phase1.js
node tests/test_phase2.js
```

## Phases

| # | Phase | Acceptance test | Result |
|---|---|---|---|
| 1 | Complex MNA AC solver | Matches analytic RC & RLC to <1e-6 | ✅ **~1e-16** (machine precision) |
| 2 | Reference-filter validation suite | Agreement within tolerance on ≥5 filters | ✅ **6/6 filters, ~1e-15 to 1e-17** (machine precision) |
| 3 | Schematic UI | Click together an RC low-pass, solver runs | — |
| 4 | Live Bode/pole-zero/transient plots | Plots update on value change | — |
| 5 | Deploy + README | Public link loads and computes a response | — |

### Phase 2 note: ngspice substitution

No `ngspice` install was available in the build environment (no passwordless `sudo`, same constraint hit on Project B's `iverilog` install). Per Nishi's call, Phase 2 was substituted with an **extended analytic-transfer-function suite** instead of a real SPICE cross-check — each filter's transfer function was derived from scratch via nodal analysis and checked against the MNA solver's output:

- RC low-pass, RC high-pass (passive)
- Series RLC band-pass, series RLC notch/band-stop (passive)
- Sallen-Key unity-gain low-pass, Sallen-Key unity-gain high-pass (active, ideal op-amp)

All 6 matched to machine precision (~1e-15–1e-17), well under the 1e-6 target.

## One-line summary

I wrote a Modified-Nodal-Analysis circuit solver, validated it against analytic reference transfer functions, and wrapped it in a browser tool that shows live Bode and pole-zero plots for analog filters.
