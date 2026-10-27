// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The sky over the hill: stars, the moon, bats, the witching hour's
// visitors, rain and lightning. Also when the dawn and the Great Lighting
// are, and what sits in front of the moon, which the hill and plant read.

import { clamp01, ease, fraction, hash01, lerp, segment } from "../math";
import type { Color } from "./grid";
import { hex, mix, scale } from "./grid";
import { fbm2, noise2 } from "./noise";
import {
  BAT_DARK,
  BAT_RIM,
  BOLT,
  CABLE,
  DAWN_EDGE,
  EARTHSHINE,
  HEAD_GLOW,
  MOON_DARK,
  MOON_LIT,
  RAIN,
  SHIP_GLOW,
  SPIDER_EYES,
  STAR_BRIGHT,
  STAR_DIM,
  VISITOR_RIM
} from "./palette";
import type { Scene } from "./scene";
import { BAT, BOO, HORSEMAN, SHIP, SPIDER, WITCH } from "./sprites";

/** How far into the dawn: the sky pales, then the clock spins back. */
export function dawnAt(scene: Scene) {
  return scene.moment.act === "dawn" ? ease(segment(scene.moment.t, 0, 6)) : 0;
}

/** Seconds into the Great Lighting (the witching hour, then the dawn). */
export function lightingTime(scene: Scene) {
  const { moment } = scene;
  if (moment.act === "witching") return moment.t;
  if (moment.act === "dawn") return 14 + moment.t;
  return -1;
}

/**
 * Where the moon is. On the shift of the Great Lighting it sets behind the
 * hills as the lanterns rise, and leaves them the sky.
 */
function moonAt(scene: Scene) {
  const { moon, horizon } = scene.layout;
  if (!scene.plan.greatLighting) return moon;
  const T = lightingTime(scene);
  if (T < 0) return moon;
  const set = ease(segment(T, 0.5, 7));
  return { ...moon, y: lerp(moon.y, horizon + moon.r + 2, set) };
}

export function overMoon(scene: Scene, x: number, y: number) {
  const { aspect } = scene.layout;
  const moon = moonAt(scene);
  const dx = (x + 0.5 - moon.x) / (moon.r * aspect);
  const dy = (y + 0.5 - moon.y) / moon.r;
  return dx * dx + dy * dy <= 1;
}

/** A silhouette's glyph colour: black against the moon, rim-lit elsewhere. */
export function silhouette(scene: Scene, dark: Color, rim: Color) {
  return (x: number, y: number) => (overMoon(scene, x, y) ? dark : rim);
}

export function drawStars(scene: Scene, dawn: number) {
  const { grid, layout, seconds } = scene;
  for (const star of layout.stars) {
    const v = noise2(seconds * 0.7 + star.seed * 0.013, star.seed % 97);
    const shine = (0.3 + 0.7 * v) * (1 - dawn);
    if (shine < 0.14) continue;
    const char = v > 0.8 ? "*" : v > 0.64 ? "+" : v > 0.4 ? "." : "'";
    grid.put(star.x, star.y, char, mix(STAR_DIM, STAR_BRIGHT, shine));
  }
}

const MOON_RAMP = " .:-=+*#%@";

export function drawMoon(scene: Scene, dawn: number) {
  const { grid, layout, plan, lights } = scene;
  const { aspect } = layout;
  const moon = moonAt(scene);
  const angle = plan.moonPhase * Math.PI * 2;
  const lx = Math.sin(angle);
  const lz = Math.cos(angle);
  const rx = moon.r * aspect;
  for (
    let row = Math.trunc(moon.y - moon.r) - 1;
    row <= moon.y + moon.r + 1;
    row++
  ) {
    for (let col = Math.trunc(moon.x - rx) - 1; col <= moon.x + rx + 1; col++) {
      const nx = (col + 0.5 - moon.x) / rx;
      const ny = (row + 0.5 - moon.y) / moon.r;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      const facing = nx * lx + nz * lz;
      const lit = clamp01((facing + 0.06) / 0.2);
      const maria = clamp01(
        (fbm2(nx * 2.4 + 3, ny * 2.4 + 1, 3, 5) - 0.5) / 0.16
      );
      const crater = noise2(nx * 9 + 1, ny * 9 + 4, 9) > 0.78 ? 0.75 : 1;
      const brightness = lit * (0.7 + 0.3 * nz) * (1 - 0.35 * maria) * crater;
      if (brightness < 0.07) {
        if ((col + row) % 2 === 0) grid.put(col, row, ".", EARTHSHINE);
        continue;
      }
      const index = Math.min(
        MOON_RAMP.length - 1,
        Math.trunc(brightness * MOON_RAMP.length)
      );
      grid.put(
        col,
        row,
        MOON_RAMP[index] ?? "@",
        mix(MOON_DARK, mix(MOON_LIT, DAWN_EDGE, dawn * 0.5), brightness)
      );
    }
  }
  const illumination = (1 + lz) / 2;
  lights.push({
    x: moon.x,
    y: moon.y,
    radius: moon.r * 3,
    color: hex("#b9b0e0"),
    power: 0,
    halo: (0.08 + 0.14 * illumination) * (1 - dawn * 0.6)
  });
}

function batTargets(scene: Scene) {
  const { cols, rows } = scene.layout;
  const targets: { x: number; y: number }[] = [];
  const spacingX = 2;
  const spacingY = 1;
  const letterWidth = spacingX * 5 + 4;
  const left = cols * 0.4 - (letterWidth * BOO.length) / 2;
  BOO.forEach((letter, k) => {
    letter.forEach((line, row) => {
      for (let col = 0; col < line.length; col++) {
        if (line[col] !== "#") continue;
        targets.push({
          x: left + k * letterWidth + col * spacingX,
          y: rows * 0.13 + row * spacingY
        });
      }
    });
  });
  return targets;
}

export function drawBats(scene: Scene) {
  const { grid, layout, plan, moment, seconds } = scene;
  const t = moment.shiftT;
  if (t > 16) return;
  const boo = plan.event === "boo";
  const targets = boo ? batTargets(scene) : [];
  const count = boo ? targets.length : 12;
  const belfry = { x: layout.factory.tower, y: layout.factory.towerTop + 2 };
  const shade = silhouette(scene, BAT_DARK, BAT_RIM);
  for (let i = 0; i < count; i++) {
    const start = 1 + i * (boo ? 0.06 : 0.13);
    const u = (t - start) / (boo ? 11 : 8.5);
    if (u < 0 || u > 1) continue;
    const r1 = hash01(i * 7 + plan.index * 131);
    const r2 = hash01(i * 13 + 5);
    const control = {
      x: layout.moon.x + (r1 - 0.5) * layout.moon.r * layout.aspect * 2.6,
      y: layout.moon.y + (r2 - 0.5) * layout.moon.r * 2.2
    };
    const exit = {
      x: layout.cols + 6 + r1 * 10,
      y: layout.rows * (0.02 + hash01(i * 31 + 2) * 0.16)
    };
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    let x = a * belfry.x + b * control.x + c * exit.x;
    let y =
      a * belfry.y +
      b * control.y +
      c * exit.y +
      Math.sin(seconds * 9 + i) * 0.5;
    const target = targets[i];
    let folded = false;
    if (target) {
      const w = ease(segment(t, 3.4, 4.8)) * (1 - ease(segment(t, 7.4, 8.4)));
      x = lerp(x, target.x, w);
      y = lerp(y, target.y, w);
      // In formation each bat hangs as one glyph, so the letters read.
      folded = w > 0.85;
    }
    if (folded) {
      grid.put(x, y, "v", shade(x, y));
      continue;
    }
    const frame =
      BAT[Math.trunc(seconds * 11 + i * 0.37) % BAT.length] ?? "-v-";
    for (let k = 0; k < frame.length; k++) {
      grid.put(x - 1 + k, y, frame[k] ?? " ", shade(x - 1 + k, y));
    }
  }
}

export function drawSkyVisitor(scene: Scene) {
  const { grid, layout, plan, moment, seconds, lights } = scene;
  if (moment.act !== "witching" || plan.greatLighting) return;
  const t = moment.t;
  const { moon, cols } = layout;
  const shade = silhouette(scene, BAT_DARK, VISITOR_RIM);
  if (plan.visitor === "witch") {
    const u = segment(t, 2, 12);
    if (u <= 0 || u >= 1) return;
    const x = lerp(cols + 4, -22, u);
    const y = moon.y - 3 + Math.sin(t * 1.3) * 1.4;
    const cape = WITCH.cape[Math.trunc(seconds * 5) % 2] ?? "";
    const art = [...WITCH.body.slice(0, 4), cape, WITCH.broom];
    grid.sprite(x, y, art, (_char, col, row) => shade(x + col, y + row));
    return;
  }
  if (plan.visitor === "ship") {
    const u = segment(t, 1.5, 13);
    if (u <= 0 || u >= 1) return;
    const x = lerp(-30, cols + 2, u);
    const y = moon.y - 2 + Math.sin(t * 0.9) * 0.6;
    grid.sprite(x, y, SHIP, (_char, col, row) =>
      overMoon(scene, x + col, y + row) ? hex("#163a30") : SHIP_GLOW
    );
    lights.push({
      x: x + 13,
      y: y + 3,
      radius: 6,
      color: SHIP_GLOW,
      power: 0.15,
      halo: 0.12
    });
    return;
  }
  if (plan.visitor === "spider") {
    const down = ease(segment(t, 1.5, 5));
    const up = ease(segment(t, 10, 13));
    const drop = down * (1 - up);
    if (drop <= 0) return;
    const x = moon.x - 6;
    const y = lerp(-6, moon.y - 1, drop) + Math.sin(seconds * 1.6) * 0.4 * drop;
    for (let r = 0; r < y; r++) grid.put(x + 6, r, "|", scale(CABLE, 0.7));
    grid.sprite(x, y, SPIDER, (char, col, row) =>
      char === "o" ? SPIDER_EYES : shade(x + col, y + row)
    );
    lights.push({
      x: x + 6,
      y: y + 1,
      radius: 1.6,
      color: SPIDER_EYES,
      power: 0.3,
      halo: 0.08
    });
  }
}

export function drawHorseman(scene: Scene) {
  const { grid, layout, plan, moment, seconds, lights } = scene;
  if (
    moment.act !== "witching" ||
    plan.greatLighting ||
    plan.visitor !== "horseman"
  )
    return;
  const u = segment(moment.t, 2, 11);
  if (u <= 0 || u >= 1) return;
  const x = lerp(-22, layout.cols + 2, u);
  const column = Math.trunc(x + 10);
  const ground =
    layout.ridge[Math.max(0, Math.min(layout.cols - 1, column))] ??
    layout.horizon;
  const gallop = Math.trunc(seconds * 8) % 2;
  const y = ground - 4.6 - (gallop ? 0.4 : 0);
  const legs = HORSEMAN.legs[gallop] ?? "";
  grid.sprite(x, y, [...HORSEMAN.body, legs], (char) =>
    char === "@" || char === "(" || char === ")" ? HEAD_GLOW : VISITOR_RIM
  );
  lights.push({
    x: x + 12,
    y,
    radius: 2.5,
    color: HEAD_GLOW,
    power: 0.5,
    halo: 0.2
  });
}

export function drawRain(scene: Scene) {
  const { grid, layout, plan, moment, seconds } = scene;
  if (plan.weather !== "drizzle") return;
  const heavy = moment.act === "witching" ? 1.7 : 1;
  const count = Math.trunc(layout.cols * 0.45 * heavy);
  for (let k = 0; k < count; k++) {
    const speed = 22 + hash01(k * 3) * 10;
    const y =
      fraction((seconds * speed) / (layout.rows + 6) + hash01(k * 11)) *
        (layout.rows + 6) -
      3;
    const x = hash01(k * 17) * (layout.cols + 10) - 5 + y * 0.3;
    grid.put(x, y, k % 3 === 0 ? "," : "'", RAIN);
  }
}

/** Lightning in the witching hour: draws the bolt, returns the flash. */
export function drawLightning(scene: Scene) {
  const { grid, layout, plan, moment } = scene;
  if (moment.act !== "witching" || plan.greatLighting) return 0;
  let flash = 0;
  const strikes = [
    3.2 + hash01(plan.index * 3) * 1.5,
    8.7 + hash01(plan.index * 5) * 1.8
  ];
  strikes.forEach((at, k) => {
    const age = moment.t - at;
    if (age < 0 || age > 0.6) return;
    flash = Math.max(
      flash,
      age < 0.08 ? 1 : age < 0.18 ? 0.35 : age < 0.26 ? 0.7 : 0
    );
    let x = layout.cols * (0.15 + hash01(plan.index * 7 + k) * 0.75);
    const bright = scale(BOLT, 1 - age / 0.6);
    for (let y = 0; y < (layout.ridge[Math.trunc(x)] ?? layout.horizon); y++) {
      const step = hash01(plan.index * 97 + k * 31 + y) * 3;
      const dx = step < 1 ? -1 : step < 2 ? 0 : 1;
      grid.put(x, y, dx < 0 ? "/" : dx > 0 ? "\\" : "|", bright);
      x += dx;
    }
  });
  return flash;
}
