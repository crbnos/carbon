// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The Great Lighting: thirteen lanterns rise and become the Carbon mark.

import { ease, lerp, segment } from "../math";
import { mix, scale } from "./grid";
import { lanternSlot, pointAlong } from "./layout";
import { flicker, noise2 } from "./noise";
import { LANTERN_LIGHT, STAR_GOLD } from "./palette";
import { drawLantern } from "./pumpkin";
import type { Scene } from "./scene";
import { lightingTime } from "./sky";
import { MARK_EDGES, MARK_STARS } from "./sprites";
import { LANTERNS_FOR_LIGHTING } from "./story";

function constellationPoint(scene: Scene, index: number) {
  const { cols, rows, aspect, factory } = scene.layout;
  const star = MARK_STARS[index] ?? MARK_STARS[0] ?? { x: 212, y: 240 };
  // Right of the chimney's smoke, as large as fits: the moon has set.
  const left = factory.chimney + 4;
  const right = cols - 3;
  const sy = Math.min((rows * 0.3) / 480, (right - left) / 2 / (212 * aspect));
  return {
    x: (left + right) / 2 + (star.x - 212) * sy * aspect,
    y: rows * 0.26 + (star.y - 240) * sy
  };
}

/** Thirteen lanterns rise and become the Carbon mark, then the stars. */
export function drawGreatLighting(scene: Scene) {
  const { grid, layout, plan, moment, seconds, lights } = scene;
  if (!plan.greatLighting) return;
  if (moment.act !== "witching" && moment.act !== "dawn") return;
  const T = lightingTime(scene);
  const lanterns = [...plan.procession, plan.face];
  const fade = 1 - ease(segment(T, 20, 24.5));
  const positions = lanterns.map((face, i) => {
    const slot = pointAlong(
      layout.path,
      lanternSlot(i, LANTERNS_FOR_LIGHTING),
      layout.aspect
    );
    const lift = ease(segment(T, 0.3 + i * 0.25, 3.8 + i * 0.25));
    const risen = {
      x: slot.x + Math.sin(seconds * 1.3 + i) * 2 * lift,
      y: slot.y - 0.6 - lift * 7
    };
    const glide = ease(segment(T, 5, 9));
    const target = constellationPoint(scene, i);
    return {
      face,
      x: lerp(risen.x, target.x, glide),
      y:
        lerp(risen.y, target.y, glide) +
        Math.sin(seconds * 2 + i) * 0.15 * (1 - glide),
      star: glide
    };
  });

  MARK_EDGES.forEach(([a, b], k) => {
    const from = positions[a];
    const to = positions[b];
    if (!from || !to) return;
    const shown = segment(T, 9 + k * 0.22, 9.6 + k * 0.22) * fade;
    if (shown <= 0) return;
    const steps = Math.trunc(
      Math.hypot((to.x - from.x) / layout.aspect, to.y - from.y) * 1.6
    );
    const dx = (to.x - from.x) / layout.aspect;
    const dy = to.y - from.y;
    const edge =
      Math.abs(dx) > 2 * Math.abs(dy)
        ? "-"
        : Math.abs(dy) > 2 * Math.abs(dx)
          ? "|"
          : dx * dy > 0
            ? "\\"
            : "/";
    for (let s = 1; s < steps; s++) {
      if (s / steps > shown) break;
      const x = lerp(from.x, to.x, s / steps);
      const y = lerp(from.y, to.y, s / steps);
      if (grid.isBlank(x, y))
        grid.put(x, y, edge, scale(STAR_GOLD, 0.7 * fade));
    }
  });

  positions.forEach((p, i) => {
    const lit = flicker(seconds + i, i);
    if (p.star < 0.5) {
      drawLantern(grid, p.x, p.y, p.face, { lit });
    } else {
      const twinkle = 0.7 + 0.3 * noise2(seconds * 3 + i, i, 8);
      const char = fade > 0.66 ? "*" : fade > 0.33 ? "+" : ".";
      grid.put(
        p.x,
        p.y,
        char,
        scale(
          mix(LANTERN_LIGHT, STAR_GOLD, p.star),
          twinkle * (0.4 + 0.6 * fade)
        )
      );
    }
    lights.push({
      x: p.x,
      y: p.y,
      radius: 2.6,
      color: mix(LANTERN_LIGHT, STAR_GOLD, p.star),
      power: 0.5 * lit * fade,
      halo: (0.18 + 0.12 * p.star) * fade
    });
  });
}
