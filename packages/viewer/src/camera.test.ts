import { describe, expect, it } from "vitest";
import { fitFraming } from "./camera";
import type { Vec3 } from "./types";

describe("fitFraming", () => {
  const tanH = Math.tan((30 * Math.PI) / 180); // wide-ish frustum for readable numbers
  const tanV = Math.tan((22.5 * Math.PI) / 180);
  const margin = 0.85;

  /** Every point inside the margin frustum for the fitted pan/distance? */
  function contained(
    points: Vec3[],
    fit: { pan: [number, number]; distance: number }
  ): boolean {
    return points.every(([x, y, v]) => {
      const depth = fit.distance - v;
      return (
        depth > 0 &&
        Math.abs(x - fit.pan[0]) <= margin * tanH * depth + 1e-9 &&
        Math.abs(y - fit.pan[1]) <= margin * tanV * depth + 1e-9
      );
    });
  }

  it("keeps a centered action untouched", () => {
    const points: Vec3[] = [
      [-5, -5, 0],
      [5, 5, 0]
    ];
    const fit = fitFraming(points, tanH, tanV, margin, 100);
    expect(fit.pan).toEqual([0, 0]);
    expect(fit.distance).toBe(100);
    expect(contained(points, fit)).toBe(true);
  });

  it("pans minimally toward an off-center action instead of zooming", () => {
    // Far right of the frustum at distance 100: half-width = .85*tanH*100 ≈ 49
    const points: Vec3[] = [
      [60, 0, 0],
      [70, 0, 0]
    ];
    const fit = fitFraming(points, tanH, tanV, margin, 100);
    expect(fit.distance).toBe(100); // no zoom — pan suffices
    expect(fit.pan[0]).toBeGreaterThan(0);
    expect(contained(points, fit)).toBe(true);
    // Minimal: the nearest constraint edge, not the action center
    expect(fit.pan[0]).toBeCloseTo(70 - margin * tanH * 100, 5);
  });

  it("grows the distance only when the action cannot fit", () => {
    // Spread wider than the frustum can hold at the standing distance
    // (needs ~306 units of eye distance; fits under the 4× cap)
    const points: Vec3[] = [
      [-150, 0, 0],
      [150, 0, 0]
    ];
    const fit = fitFraming(points, tanH, tanV, margin, 100);
    expect(fit.distance).toBeGreaterThan(100);
    expect(contained(points, fit)).toBe(true);
  });

  it("caps the zoom-out at 4× the standing distance", () => {
    // Impossible spread — capping preserves context instead of zooming to a dot
    const points: Vec3[] = [
      [-1000, 0, 0],
      [1000, 0, 0]
    ];
    const fit = fitFraming(points, tanH, tanV, margin, 100);
    expect(fit.distance).toBe(400);
  });

  it("accounts for point depth (closer points need more room)", () => {
    // Same lateral offset, but one point sits far toward the eye where the
    // frustum is narrower
    const points: Vec3[] = [
      [40, 0, 60],
      [40, 0, 0]
    ];
    const fit = fitFraming(points, tanH, tanV, margin, 100);
    expect(contained(points, fit)).toBe(true);
  });

  it("never returns a point behind the eye", () => {
    const points: Vec3[] = [[0, 0, 150]]; // beyond the standing distance
    const fit = fitFraming(points, tanH, tanV, margin, 100);
    expect(fit.distance).toBeGreaterThan(150);
    expect(contained(points, fit)).toBe(true);
  });
});
