// Top-level entry point for the npm package. Aggregates the engine's
// public API (each module already dual-exports via module.exports/window,
// see engine/*.js) into a single require("analog-filter-designer").

const Complex = require("./engine/complex");
const MNA = require("./engine/mna");
const Poly = require("./engine/poly");
const PoleZero = require("./engine/pole_zero");
const Transient = require("./engine/transient");
const Circuit = require("./ui/circuit");

module.exports = { ...Complex, ...MNA, ...Poly, ...PoleZero, ...Transient, ...Circuit };
