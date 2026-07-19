// complex.js -- minimal complex-number arithmetic (JS has no native complex type).

class Complex {
  constructor(re, im = 0) {
    this.re = re;
    this.im = im;
  }
  static from(x) {
    return x instanceof Complex ? x : new Complex(x, 0);
  }
  add(other) {
    const o = Complex.from(other);
    return new Complex(this.re + o.re, this.im + o.im);
  }
  sub(other) {
    const o = Complex.from(other);
    return new Complex(this.re - o.re, this.im - o.im);
  }
  mul(other) {
    const o = Complex.from(other);
    return new Complex(this.re * o.re - this.im * o.im, this.re * o.im + this.im * o.re);
  }
  div(other) {
    const o = Complex.from(other);
    const denom = o.re * o.re + o.im * o.im;
    if (denom === 0) throw new Error("division by zero in Complex.div");
    return new Complex(
      (this.re * o.re + this.im * o.im) / denom,
      (this.im * o.re - this.re * o.im) / denom
    );
  }
  neg() {
    return new Complex(-this.re, -this.im);
  }
  abs() {
    return Math.hypot(this.re, this.im);
  }
  phaseDeg() {
    return (Math.atan2(this.im, this.re) * 180) / Math.PI;
  }
  static zero() {
    return new Complex(0, 0);
  }
}

if (typeof module !== "undefined") module.exports = { Complex };
if (typeof window !== "undefined") window.Complex = Complex;
