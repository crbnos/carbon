// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The plant: the factory with its clock tower, the crane on its roof and
// the hero pumpkin it lifts, and the clock's bong at midnight.

import {
  clamp01,
  ease,
  fraction,
  hash01,
  lerp,
  nearest,
  segment
} from "../math";
import { hex, mix, NO_BG, scale } from "./grid";
import { flicker } from "./noise";
import {
  CABLE,
  CHIMNEY,
  CLOCK_FACE,
  CLOCK_HAND,
  CLOCK_RIM,
  DOOR_OPEN,
  DOOR_WOOD,
  FACTORY_TEXTURE,
  RING,
  ROOF,
  SILHOUETTE_BG,
  SMOKE,
  STEEL,
  WINDOW_DIM,
  WINDOW_LIT,
  WINDOW_OFF
} from "./palette";
import { drawPumpkin } from "./pumpkin";
import type { Scene } from "./scene";
import { CLOCK } from "./sprites";
import { ACTS, actStart } from "./story";

const RUN_START = ACTS[0].seconds;

/** The tower clock: 12 at midnight, about half past five at dawn, then back. */
export function clockHours(scene: Scene) {
  const { moment } = scene;
  const runEnd = actStart("dawn") + 6;
  const run = (s: number) =>
    5.6 * clamp01((s - RUN_START) / (runEnd - RUN_START));
  if (moment.act !== "dawn") return run(moment.shiftT);
  if (moment.t < 6) return run(moment.shiftT);
  return run(runEnd) * (1 - ease(segment(moment.t, 6, 8.5)));
}

function handChar(angle: number) {
  const a = ((angle % Math.PI) + Math.PI) % Math.PI;
  if (a < Math.PI / 8 || a > (7 * Math.PI) / 8) return "|";
  if (a < (3 * Math.PI) / 8) return "/";
  if (a < (5 * Math.PI) / 8) return "-";
  return "\\";
}

function strikeGlow(scene: Scene) {
  if (scene.moment.act !== "midnight") return 0;
  let glow = 0;
  for (let k = 0; k < 12; k++) {
    const age = scene.moment.t - (0.6 + k * 0.55);
    if (age >= 0 && age < 0.5) glow = Math.max(glow, 1 - age / 0.5);
  }
  return glow;
}

export function drawFactory(scene: Scene, dawn: number) {
  const { grid, layout, seconds, lights, moment, plan } = scene;
  const f = layout.factory;
  for (let r = f.roof; r < f.base + 1; r++) {
    for (let c = f.left; c <= f.right; c++) {
      grid.fill(c, r, SILHOUETTE_BG);
      grid.blank(c, r);
      if (hash01(c * 61 + r * 17) < 0.04) grid.put(c, r, ".", FACTORY_TEXTURE);
    }
  }
  for (let c = f.left; c + 2 <= f.right; c += 3) {
    grid.sprite(c, f.roof - 2, [" /|", "/$|"], ROOF, SILHOUETTE_BG);
  }
  for (const row of [f.roof + 2, f.roof + 5]) {
    if (row > f.base - 3) continue;
    for (let x = f.left + 2; x + 1 < f.right - 1; x += 4) {
      if (Math.abs(x - f.door) < 3) continue;
      const h = hash01(x * 13 + row * 7);
      if (h > 0.28) {
        const b = (0.6 + 0.4 * flicker(seconds + h * 10, x)) * (1 - dawn * 0.7);
        grid.text(x, row, "[]", mix(WINDOW_DIM, WINDOW_LIT, b));
        lights.push({
          x: x + 1,
          y: row + 0.5,
          radius: 2.2,
          color: WINDOW_LIT,
          power: 0.32 * b,
          halo: 0.05 * b
        });
      } else {
        grid.text(x, row, "[]", WINDOW_OFF);
      }
    }
  }
  const open =
    moment.act === "shipping" &&
    moment.t > 1.5 &&
    moment.t < (plan.event === "reject" ? 10 : 12.5);
  grid.sprite(
    f.door - 1,
    f.base - 3,
    [" _ ", "|$|", "|$|"],
    ROOF,
    open ? DOOR_OPEN : DOOR_WOOD
  );
  if (open) {
    lights.push({
      x: f.door,
      y: f.base - 1.5,
      radius: 4.5,
      color: WINDOW_LIT,
      power: 0.75,
      halo: 0.22
    });
  }

  for (let r = f.chimneyTop + 1; r < f.roof; r++) {
    grid.sprite(f.chimney - 1, r, ["|$|"], CHIMNEY, SILHOUETTE_BG);
  }
  grid.text(f.chimney - 1, f.chimneyTop, "===", ROOF);
  for (let k = 0; k < 16; k++) {
    const age = fraction(seconds * 0.11 + k / 16);
    const x =
      f.chimney + age * age * 18 + Math.sin(seconds * 0.7 + k) * age * 2;
    const y = f.chimneyTop - 1 - age * 12;
    const char =
      age < 0.18
        ? "o"
        : age < 0.5
          ? k % 2
            ? "("
            : ")"
          : age < 0.8
            ? "~"
            : ".";
    if (grid.isBlank(x, y)) grid.put(x, y, char, scale(SMOKE, 1 - age * 0.75));
  }

  grid.put(f.tower, f.towerTop - 1, "+", ROOF);
  grid.put(f.tower, f.towerTop, "^", ROOF);
  for (let k = 1; k <= 4; k++) {
    const y = f.towerTop + k;
    grid.put(f.tower - k - 1, y, "/", ROOF);
    grid.put(f.tower + k + 1, y, "\\", ROOF);
    for (let c = f.tower - k; c <= f.tower + k; c++) {
      grid.fill(c, y, SILHOUETTE_BG);
      grid.blank(c, y);
    }
  }
  for (let y = f.towerTop + 5; y < f.roof; y++) {
    grid.put(f.tower - 5, y, "|", ROOF);
    grid.put(f.tower + 5, y, "|", ROOF);
    for (let c = f.tower - 4; c <= f.tower + 4; c++) {
      grid.fill(c, y, SILHOUETTE_BG);
      grid.blank(c, y);
    }
  }
  const strike = strikeGlow(scene);
  const face = mix(CLOCK_FACE, hex("#7a6430"), strike * 0.6);
  grid.sprite(f.tower - 3, f.towerTop + 5, CLOCK, CLOCK_RIM, face);
  const center = { x: f.tower, y: f.towerTop + 7 };
  const hours = clockHours(scene);
  const minute = fraction(hours) * Math.PI * 2;
  const hour = (hours / 12) * Math.PI * 2;
  for (const k of [1, 2]) {
    grid.put(
      center.x + nearest(Math.sin(minute) * k),
      center.y + nearest(-Math.cos(minute) * k * 0.5),
      handChar(minute),
      CLOCK_HAND
    );
  }
  const hx = center.x + nearest(Math.sin(hour) * 1.2);
  const hy = center.y + nearest(-Math.cos(hour) * 0.6);
  if (hx !== center.x || hy !== center.y)
    grid.put(hx, hy, handChar(hour), scale(CLOCK_HAND, 0.85));
  grid.put(center.x, center.y, "o", CLOCK_HAND);
  lights.push({
    x: center.x,
    y: center.y,
    radius: 3 + strike * 5,
    color: hex("#ffd98a"),
    power: 0.25 + strike * 0.8,
    halo: 0.1 + strike * 0.3
  });
}

/** The crane on the roof, and the hero pumpkin while it hangs from it. */
export function drawCraneAndHero(scene: Scene) {
  const { grid, layout, moment, seconds } = scene;
  const f = layout.factory;
  const stub = 4;
  const reach = Math.max(stub, Math.trunc(layout.hero.x - f.mast));
  const heroRadius =
    moment.act === "midnight"
      ? 1.05
      : 1.05 +
        1.15 * ease(segment(moment.t, 2.5, 6.5)) +
        0.05 * Math.sin(seconds * 3);
  const heroTop = layout.hero.y - heroRadius;
  const t = moment.act === "harvest" ? moment.t : -1;

  let length = stub;
  let hookY = f.jib + 2;
  let carried = false;
  if (t >= 0) {
    if (t < 8) length = lerp(stub, reach, ease(segment(t, 6, 8)));
    else if (t < 11.5) length = reach;
    else length = lerp(reach, stub, ease(segment(t, 11.5, 13.2)));
    if (t >= 8 && t < 9.5)
      hookY = lerp(f.jib + 2, heroTop - 1, ease(segment(t, 8, 9.5)));
    else if (t >= 9.5 && t < 10) hookY = heroTop - 1;
    else if (t >= 10 && t < 13.2)
      hookY = lerp(heroTop - 1, f.jib + 3, ease(segment(t, 10, 11.5)));
    else if (t >= 13.2)
      hookY = lerp(f.jib + 3, f.roof + 2, ease(segment(t, 13.2, 14)));
    carried = t >= 10;
  }
  const L = Math.trunc(length);
  for (let y = f.jib; y < f.roof; y++) grid.put(f.mast, y, "H", STEEL);
  for (let k = 1; k <= L; k++) {
    grid.put(f.mast + k, f.jib, k === L ? ">" : "=", STEEL);
    if (k < L)
      grid.put(f.mast + k, f.jib + 1, k % 2 ? "\\" : "/", scale(STEEL, 0.7));
  }
  const hookX = f.mast + L - 1;
  for (let y = f.jib + 1; y < hookY; y++) grid.put(hookX, y, "|", CABLE);
  grid.put(hookX, hookY, "J", CABLE);

  // Lowered through the roof hatch at the end of the harvest: gone inside.
  const sunk = t >= 13.2 && hookY + 1 > f.roof - 1;
  const showHero =
    moment.act === "midnight" || (moment.act === "harvest" && !sunk);
  if (!showHero) return;
  const center = carried
    ? { x: hookX + 0.5, y: hookY + 1 + heroRadius }
    : { x: layout.hero.x, y: layout.hero.y };
  drawPumpkin(grid, {
    x: center.x,
    y: center.y,
    radius: heroRadius,
    aspect: layout.aspect,
    spin: seconds * 0.4,
    seconds
  });
}

export function drawBong(scene: Scene) {
  const { grid, layout, moment } = scene;
  if (moment.act !== "midnight") return;
  const origin = { x: layout.factory.tower, y: layout.factory.towerTop + 7 };
  for (let k = 0; k < 12; k++) {
    const age = moment.t - (0.6 + k * 0.55);
    if (age < 0 || age > 1.8) continue;
    const radius = age * 15;
    const strength = 1 - age / 1.8;
    const samples = Math.max(12, Math.trunc(radius * layout.aspect * 6));
    for (let s = 0; s < samples; s++) {
      const a = (s / samples) * Math.PI * 2;
      const x = origin.x + Math.cos(a) * radius * layout.aspect;
      const y = origin.y + Math.sin(a) * radius;
      if (!grid.isBlank(x, y) || grid.bg[grid.index(x, y)] !== NO_BG) continue;
      const char = strength > 0.66 ? "*" : strength > 0.33 ? ":" : ".";
      grid.put(x, y, char, scale(RING, strength * 0.8));
    }
  }
}
