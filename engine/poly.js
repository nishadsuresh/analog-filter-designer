// poly.js -- real-coefficient polynomials in s, ascending order
// (coeffs[i] = coefficient of s^i). Used by engine/pole_zero.js.

function trim(coeffs) {
  if (coeffs.length === 0) return [0];
  const c = coeffs.slice();
  while (c.length > 1 && Math.abs(c[c.length - 1]) < 1e-10) c.pop();
  return c;
}

// Horner evaluation at a Complex point s.
function polyEval(coeffs, s, Complex) {
  let acc = new Complex(0, 0);
  for (let i = coeffs.length - 1; i >= 0; i--) {
    acc = acc.mul(s).add(new Complex(coeffs[i], 0));
  }
  return acc;
}

if (typeof module !== "undefined") module.exports = { trim, polyEval };
if (typeof window !== "undefined") window.Poly = { trim, polyEval };
