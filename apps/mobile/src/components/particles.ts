// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The geometry of a particle burst, with no React and no renderer in it.
 *
 * A burst is the one piece of motion in this app that exists purely to mark
 * a moment — a unit finished, a job done. Everything else here earns its
 * place by telling an operator something; this one says "that counted", and
 * it is the only place the overshooting spring and the colour budget are
 * spent.
 *
 * Kept pure so the thing most likely to be wrong — where the particles go —
 * is checked by a test rather than by watching it and hoping.
 */

export type Particle = {
  /** Where it ends up, relative to the burst's origin, in points. */
  dx: number;
  dy: number;
  /** Degrees, so each piece tumbles differently. */
  rotation: number;
  /** 0..1 of the full particle size, so a burst is not uniform. */
  scale: number;
  /** Milliseconds before this one leaves. */
  delay: number;
};

/**
 * `Math.random` by default; a test passes its own so the geometry is
 * checkable. A seeded sequence is also what makes a burst reproducible in a
 * screenshot.
 */
export type Random = () => number;

/**
 * Particles thrown evenly around a circle, with the randomness kept to
 * variation rather than placement.
 *
 * Even ANGULAR spacing matters: twelve particles at twelve random angles
 * clump, and a clumped burst reads as a glitch rather than a celebration.
 * So the circle is divided evenly and each particle is jittered within its
 * own slice — the eye sees "scattered" while the distribution stays whole.
 *
 * The upward bias (`RISE`) is the other half. A burst that is symmetric
 * about its origin looks like an explosion; one that drifts up reads as
 * release, which is the feeling a finished unit should have.
 */
const RISE = 0.35;
const JITTER = 0.6;

export function burst(
  count: number,
  radius: number,
  random: Random = Math.random
): Particle[] {
  if (count <= 0 || radius <= 0) return [];
  const particles: Particle[] = [];
  const slice = (Math.PI * 2) / count;

  for (let i = 0; i < count; i++) {
    // Each particle owns its slice and is jittered INSIDE it, so the ring
    // stays even however the random source behaves.
    const angle = i * slice + (random() - 0.5) * slice * JITTER;
    // 60–100% of the radius: a burst where everything lands on one circle
    // reads as a mechanism, not a scatter.
    const distance = radius * (0.6 + random() * 0.4);
    particles.push({
      dx: Math.cos(angle) * distance,
      // Negative is up on screen, and the rise is added to all of them.
      dy: Math.sin(angle) * distance - radius * RISE,
      rotation: (random() - 0.5) * 240,
      scale: 0.5 + random() * 0.5,
      delay: Math.round(random() * 60)
    });
  }
  return particles;
}

/**
 * A small deterministic generator, so a burst is reproducible from a seed.
 *
 * Two reasons it is worth the eight lines over `Math.random`. A burst is
 * generated inside a memo keyed on the trigger, and seeding FROM that
 * trigger is what makes the trigger a real input rather than a dependency
 * the body never reads — the shape an exhaustive-deps rule rightly objects
 * to. And a seeded burst renders identically twice, which is the difference
 * between a screenshot test that can exist and one that cannot.
 *
 * mulberry32: short, well-distributed enough for scatter, and not a
 * cryptographic claim.
 */
export function seededRandom(seed: number): Random {
  let state = Math.trunc(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
