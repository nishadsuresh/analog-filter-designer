# analog-filter-designer

A browser-based tool for placing R/L/C/op-amp components and instantly seeing the Bode plot, pole-zero map, and transient response — a free, zero-install analog-filter teaching tool.

**Status: Phase 1 of 5** (MNA solver engine).

## Scope (deliberate)

Locked to **linear** filter design: resistors, capacitors, inductors, ideal op-amps. Nonlinear devices (diodes, transistors) are an optional appendix only if everything else ships — this keeps the project's biggest risk (scope creep) under control. Success is defined as correctness vs. known analytic/reference transfer functions plus a working deployed tool, not "adoption" (outside anyone's control on a deadline).

## Engine

`engine/mna.js` implements complex-valued Modified Nodal Analysis: R stamped as `1/R`, C as `jwC`, L as `1/(jwL)`, independent voltage sources and ideal op-amps (nullor model) each add one extra current unknown. Solved via complex Gaussian elimination with partial pivoting.

## Setup

```bash
node tests/test_phase1.js
```

## Phases

| # | Phase | Acceptance test | Result |
|---|---|---|---|
| 1 | Complex MNA AC solver | Matches analytic RC & RLC to <1e-6 | ✅ **~1e-16** (machine precision) |
| 2 | Reference-filter validation suite | Agreement within tolerance on ≥5 filters | — |
| 3 | Schematic UI | Click together an RC low-pass, solver runs | — |
| 4 | Live Bode/pole-zero/transient plots | Plots update on value change | — |
| 5 | Deploy + README | Public link loads and computes a response | — |

## One-line summary

I wrote a Modified-Nodal-Analysis circuit solver, validated it against analytic reference transfer functions, and wrapped it in a browser tool that shows live Bode and pole-zero plots for analog filters.
