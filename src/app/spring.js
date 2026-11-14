// Spring physics matching CASpringAnimation (mass, stiffness, damping, velocity 0),
// sampled into a CSS linear() easing so the preview behaves like the device.

export function springCurve({ mass = 1, stiffness = 100, damping = 10 }, duration, samples = 60) {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * duration;
    let x;
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      x = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
    } else {
      x = 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    }
    pts.push(Math.round(x * 10000) / 10000);
  }
  pts[pts.length - 1] = 1;
  return pts;
}

/** Duration CA would settle the spring in (approximation of settlingDuration). */
export function settlingDuration({ mass = 1, stiffness = 100, damping = 10 }) {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const decay = zeta < 1 ? zeta * w0 : w0;
  return Math.min(10, Math.max(0.1, Math.log(1000) / decay));
}

const supportsLinear = typeof CSS !== 'undefined' && CSS.supports?.('transition-timing-function', 'linear(0, 1)');

export function transitionCSS(t) {
  if (!t || t.type === 'basic') return { duration: t?.duration || 0.5, easing: 'ease-in-out' };
  // mica_autorecalculatesDuration="1" → CA uses the real settling time
  const d = settlingDuration(t);
  if (!supportsLinear) return { duration: d, easing: 'cubic-bezier(.2,.9,.25,1.05)' };
  return { duration: d, easing: `linear(${springCurve(t, d).join(', ')})` };
}
