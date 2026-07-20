// circuit.js -- pure schematic-to-netlist logic, shared between the browser
// UI (ui/app.js) and the Phase 3 acceptance test (tests/test_phase3.js).
// No DOM/canvas dependency here on purpose, so the "click together a circuit"
// behavior can be verified numerically in Node, not just eyeballed in a browser
// (see the vault's numeric-verification-methodology note).
//
// A schematic is a flat list of elements, each with 2 or 3 terminal points on
// an integer grid:
//   { type: 'R'|'C'|'L'|'V'|'OPAMP'|'WIRE'|'GND', points: [{x,y}, ...], value }
// R/C/L/V/WIRE have 2 points; OPAMP has 3 ([+in, -in, out]); GND has 1.
// Two elements sharing a grid point are electrically connected there. WIRE
// elements exist purely to merge two points into the same node (zero
// impedance); GND merges a point into the fixed ground node (id 0).

function pointKey(p) {
  return `${p.x},${p.y}`;
}

class DisjointSet {
  constructor() {
    this.parent = new Map();
  }
  find(key) {
    if (!this.parent.has(key)) this.parent.set(key, key);
    let root = key;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    // path compression
    let cur = key;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur);
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const GROUND_KEY = "__GND__";

// Builds an MNA-ready netlist from a flat element list. Returns
// { netlist, nodeOf(pointKey) } so callers (e.g. the UI, to label nodes) can
// map schematic points back to resolved node numbers.
function buildNetlistFromElements(elements) {
  const dsu = new DisjointSet();
  dsu.find(GROUND_KEY); // seed ground's own root

  for (const el of elements) {
    if (el.type === "WIRE") {
      dsu.union(pointKey(el.points[0]), pointKey(el.points[1]));
    } else if (el.type === "GND") {
      dsu.union(pointKey(el.points[0]), GROUND_KEY);
    }
    // Non-WIRE/GND element points get registered below, in the same pass
    // that assigns their node ids -- no need to pre-register them here too.
  }

  // Assign sequential node ids to every distinct root, ground always = 0.
  const rootToId = new Map();
  rootToId.set(dsu.find(GROUND_KEY), 0);
  let nextId = 1;
  const assign = (key) => {
    const root = dsu.find(key);
    if (!rootToId.has(root)) rootToId.set(root, nextId++);
    return rootToId.get(root);
  };

  // Pre-assign ids for every non-wire/gnd element's points (deterministic order).
  for (const el of elements) {
    if (el.type === "WIRE" || el.type === "GND") continue;
    for (const p of el.points) assign(pointKey(p));
  }

  const components = [];
  for (const el of elements) {
    if (el.type === "WIRE" || el.type === "GND") continue;
    const nodes = el.points.map((p) => assign(pointKey(p)));
    if (el.type === "OPAMP") {
      components.push({ type: "OPAMP", nodes });
    } else {
      components.push({ type: el.type, nodes, value: el.value });
    }
  }

  // Strict lookup, NOT assign(): a point that was never a terminal of any
  // placed element (e.g. a user clicking empty grid space to mark an output
  // node) must not silently get its own brand-new, disconnected node id --
  // that id wouldn't exist in `netlist`, so `voltages[id]` would be
  // undefined and crash downstream with a confusing error instead of a
  // clear "that point isn't part of the circuit" message. Returns undefined
  // if `p` was never registered.
  const nodeOf = (p) => {
    const key = pointKey(p);
    const root = dsu.find(key);
    return rootToId.get(root);
  };

  return {
    netlist: { numNodes: nextId - 1, components },
    nodeOf,
  };
}

if (typeof module !== "undefined") module.exports = { buildNetlistFromElements, pointKey, DisjointSet };
if (typeof window !== "undefined") window.Circuit = { buildNetlistFromElements, pointKey, DisjointSet };
