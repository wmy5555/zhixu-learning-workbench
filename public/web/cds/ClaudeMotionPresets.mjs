/* Adapted from Caho1/open-claude-ui code-examples/ClaudeMotionPresets.ts
 * Commit 4045ce76afdcb7dccef1b7e6417b04c4c6046e9c. MIT (c) 2026 Caho1.
 * See LICENSE.txt. Removed TypeScript/Framer bindings only; physics unchanged.
 * The upstream AGENTS table differs from source: source constants are canonical.
 */
export function calcDampedHarmonicOscillator(k, c, m, t) {
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(m * k));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t));
  } else if (Math.abs(zeta - 1) < 1e-4) {
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  }
  const s1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
  const s2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
  return 1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1);
}
export const SPRING_BOUNCY = { type: 'spring', stiffness: 600, damping: 30, mass: 1.0 };
export const SPRING_SNAPPY = { type: 'spring', stiffness: 320, damping: 28, mass: 1.0 };
export const SPRING_GENTLE = { type: 'spring', stiffness: 380, damping: 18, mass: 1.0 };
export const SPRING_HEAVY_SNAP = { type: 'spring', stiffness: 1200, damping: 80, mass: 0.1 };
