// Vanilla Web Animations bridge: sample the upstream oscillator, not a guessed ease.
import { calcDampedHarmonicOscillator, SPRING_SNAPPY } from './ClaudeMotionPresets.mjs';
export function springEnter(element, preset = SPRING_SNAPPY, distance = 12, scale = 0.985, axis = 'Y') {
  if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const { stiffness, damping, mass } = preset;
  let end = 2;
  for (let t = 0.12; t <= 2; t += 1 / 120) {
    if ([0, 0.05, 0.1, 0.2].every(dt => Math.abs(1 - calcDampedHarmonicOscillator(stiffness, damping, mass, t + dt)) < 0.001)) { end = t; break; }
  }
  const frames = Array.from({ length: Math.ceil(end * 120) + 1 }, (_, i) => {
    const t = i / 120;
    const progress = calcDampedHarmonicOscillator(stiffness, damping, mass, t);
    return { offset: Math.min(t / end, 1), opacity: Math.min(1, Math.max(0, progress)), transform: `translate${axis}(${distance * (1 - progress)}px) scale(${scale + (1 - scale) * progress})` };
  });
  frames[frames.length - 1] = { offset: 1, opacity: 1, transform: 'translateY(0) scale(1)' };
  return element.animate(frames, { duration: end * 1000, fill: 'none' });
}
