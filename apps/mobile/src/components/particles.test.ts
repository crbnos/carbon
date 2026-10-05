// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { burst, seededRandom } from "./particles";

/** No jitter and no variation, so the pure geometry is what is measured. */
const mid = () => 0.5;

describe("burst", () => {
  it("spreads the particles evenly around the circle", () => {
    // The failure this guards: twelve particles at twelve RANDOM angles
    // clump, and a clumped burst reads as a rendering glitch rather than a
    // celebration. Each one owns a slice.
    const particles = burst(8, 100, mid);
    const angles = particles
      .map((p) => Math.atan2(p.dy + 100 * 0.35, p.dx))
      .map((a) => (a < 0 ? a + Math.PI * 2 : a))
      .sort((a, b) => a - b);

    for (let i = 1; i < angles.length; i++) {
      const gap = (angles[i] as number) - (angles[i - 1] as number);
      expect(gap).toBeCloseTo((Math.PI * 2) / 8, 4);
    }
  });

  it("drifts the whole burst UP, so it reads as release not explosion", () => {
    // Symmetric about the origin looks like a detonation. The average must
    // be above it — negative, since negative y is up.
    const particles = burst(12, 100, mid);
    const meanY =
      particles.reduce((sum, p) => sum + p.dy, 0) / particles.length;
    expect(meanY).toBeLessThan(0);
  });

  it("keeps every particle inside the radius it was given", () => {
    const radius = 80;
    for (const p of burst(16, radius)) {
      // The rise shifts the centre up, so distance is measured from it.
      const d = Math.hypot(p.dx, p.dy + radius * 0.35);
      expect(d).toBeLessThanOrEqual(radius + 0.001);
    }
  });

  it("varies distance, so the burst is not a single ring", () => {
    const distances = new Set(
      burst(12, 100).map((p) => Math.round(Math.hypot(p.dx, p.dy)))
    );
    expect(distances.size).toBeGreaterThan(1);
  });

  it("gives every particle a scale inside 0.5..1", () => {
    for (const p of burst(20, 100)) {
      expect(p.scale).toBeGreaterThanOrEqual(0.5);
      expect(p.scale).toBeLessThanOrEqual(1);
    }
  });

  it("emits nothing for a degenerate burst rather than NaN particles", () => {
    // A burst fired before layout has a radius of 0.
    expect(burst(0, 100)).toEqual([]);
    expect(burst(10, 0)).toEqual([]);
    expect(burst(-3, 100)).toEqual([]);
  });

  it("emits exactly the count asked for", () => {
    expect(burst(14, 100)).toHaveLength(14);
  });
});

describe("seededRandom", () => {
  it("gives the same burst twice for the same seed", () => {
    expect(burst(10, 100, seededRandom(7))).toEqual(
      burst(10, 100, seededRandom(7))
    );
  });

  it("gives a different burst for a different seed", () => {
    // Two completions in a row should not look identical.
    expect(burst(10, 100, seededRandom(7))).not.toEqual(
      burst(10, 100, seededRandom(8))
    );
  });

  it("stays inside 0..1, which every consumer assumes", () => {
    const next = seededRandom(123);
    for (let i = 0; i < 500; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("does not collapse on a zero seed", () => {
    // `0 || 1` is why; without it mulberry32 seeded at 0 is still fine, but
    // the guard also catches NaN from an uninitialised trigger.
    expect(burst(6, 100, seededRandom(0))).toHaveLength(6);
    expect(burst(6, 100, seededRandom(Number.NaN))).toHaveLength(6);
  });
});
