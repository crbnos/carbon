// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// One frame of the Night Shift: picks the scene for the moment (the hill or
// the Line), wipes between them with a curtain of falling glyphs, rolls the
// fog in, and lights every glyph near a lantern, a window or a candle.

import {
  DAWN_HORIZON,
  DAWN_TOP,
  drawExterior,
  SKY_HORIZON,
  SKY_TOP
} from "./exterior";
import type { Color } from "./grid";
import { blue, Grid, green, hex, mix, NO_BG, red, rgb } from "./grid";
import { drawInterior } from "./interior";
import type { Layout } from "./layout";
import { fbm2 } from "./noise";
import type { Light, Scene, Watcher } from "./scene";
import { ease, hash01, lerp, segment } from "./scene";
import type { Moment, ShiftPlan } from "./story";

export type Sky = { top: Color; horizon: Color };

export type FrameOut = {
  sky: Sky;
  lights: Light[];
  /** A white flash over everything, 0 to 1 (lightning). */
  flash: number;
};

export type Buffers = { main: Grid; from: Grid; to: Grid; light: Float32Array };

export function makeBuffers(cols: number, rows: number): Buffers {
  return {
    main: new Grid(cols, rows),
    from: new Grid(cols, rows),
    to: new Grid(cols, rows),
    light: new Float32Array(cols * rows * 3)
  };
}

const WIPE_SECONDS = 1.5;
const FOG_RAMP = ".,-~~=";
const FOG_DIM = hex("#352d4d");
const FOG_BRIGHT = hex("#a79ecb");
const WIPE_HEAD = hex("#ffe2b0");
const WIPE_TAIL = hex("#ff8a2a");
const WIPE_GLYPHS = "*+x%#@&?!/\\";

const BASE_FOG = { clear: 0.62, drizzle: 0.74, fog: 0.95 } as const;

/** How thick the fog is and how high it reaches, for this moment. */
export function fogAt(plan: ShiftPlan, moment: Moment, layout: Layout) {
  const base = BASE_FOG[plan.weather];
  const low = layout.rows * 0.68;
  if (moment.act === "midnight") {
    const clear = ease(segment(moment.t, 0, 2.6));
    return { density: lerp(1.6, base, clear), top: lerp(0, low, clear) };
  }
  if (moment.act === "witching") {
    return {
      density: base + 0.25 * ease(moment.progress),
      top: low - 3 * ease(moment.progress)
    };
  }
  if (moment.act === "dawn") {
    const swallow = ease(segment(moment.t, 7, 11));
    return {
      density: lerp(base + 0.25, 1.6, swallow),
      top: lerp(low - 3, 0, swallow)
    };
  }
  return { density: base, top: low };
}

function rollFog(scene: Scene, density: number, top: number) {
  const { grid, layout, seconds } = scene;
  const start = Math.max(0, Math.trunc(top) - 6);
  for (let r = start; r < layout.rows; r++) {
    const rise = (r - top + 6) / 10;
    if (rise <= 0) continue;
    const height = rise >= 1 ? 1 : rise;
    for (let c = 0; c < layout.cols; c++) {
      const n = fbm2(
        c * 0.055 + seconds * 0.16,
        r * 0.2 - seconds * 0.03,
        3,
        31
      );
      const v = n * height * density;
      if (v < 0.3) continue;
      const k = Math.min(1, (v - 0.3) / 0.7);
      const i = r * layout.cols + c;
      const color = mix(FOG_DIM, FOG_BRIGHT, k);
      if (grid.ch[i] === 32 || k > 0.62) {
        grid.ch[i] = (
          FOG_RAMP[
            Math.min(FOG_RAMP.length - 1, Math.trunc(k * FOG_RAMP.length))
          ] ?? "~"
        ).charCodeAt(0);
        grid.fg[i] = color;
      } else {
        grid.fg[i] = mix(grid.fg[i] ?? 0, color, k * 0.6);
      }
      const bg = grid.bg[i] ?? NO_BG;
      if (bg !== NO_BG) grid.bg[i] = mix(bg, FOG_DIM, k * 0.45);
    }
  }
}

/** Lights every glyph near a light source: warm near lanterns, cool at lamps. */
function applyLights(
  grid: Grid,
  layout: Layout,
  lights: Light[],
  buffer: Float32Array
) {
  buffer.fill(0);
  const { cols, rows, aspect } = layout;
  for (const light of lights) {
    if (light.power <= 0) continue;
    const reachX = light.radius * aspect;
    const r0 = Math.max(0, Math.trunc(light.y - light.radius));
    const r1 = Math.min(rows - 1, Math.trunc(light.y + light.radius) + 1);
    const c0 = Math.max(0, Math.trunc(light.x - reachX));
    const c1 = Math.min(cols - 1, Math.trunc(light.x + reachX) + 1);
    const lr = (red(light.color) / 255) * light.power;
    const lg = (green(light.color) / 255) * light.power;
    const lb = (blue(light.color) / 255) * light.power;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const d =
          Math.hypot((c + 0.5 - light.x) / aspect, r + 0.5 - light.y) /
          light.radius;
        if (d >= 1) continue;
        const f = (1 - d) * (1 - d);
        const i = (r * cols + c) * 3;
        buffer[i] = (buffer[i] ?? 0) + lr * f;
        buffer[i + 1] = (buffer[i + 1] ?? 0) + lg * f;
        buffer[i + 2] = (buffer[i + 2] ?? 0) + lb * f;
      }
    }
  }
  for (let i = 0; i < cols * rows; i++) {
    const lr = buffer[i * 3] ?? 0;
    const lg = buffer[i * 3 + 1] ?? 0;
    const lb = buffer[i * 3 + 2] ?? 0;
    if (lr + lg + lb < 0.01) continue;
    if (grid.ch[i] !== 32) {
      const fg = grid.fg[i] ?? 0;
      grid.fg[i] = rgb(
        red(fg) + lr * 230,
        green(fg) + lg * 230,
        blue(fg) + lb * 230
      );
    }
    const bg = grid.bg[i] ?? NO_BG;
    if (bg !== NO_BG)
      grid.bg[i] = rgb(
        red(bg) + lr * 40,
        green(bg) + lg * 40,
        blue(bg) + lb * 40
      );
  }
}

/** The curtain between scenes: falling glyphs, the new scene above them. */
function wipe(
  target: Grid,
  from: Grid,
  to: Grid,
  progress: number,
  seconds: number
) {
  const { cols, rows } = target;
  const spread = 0.45;
  for (let c = 0; c < cols; c++) {
    const lag = hash01(c * 53 + 7) * spread;
    const front = (progress * (1 + spread) - lag) * (rows + 4);
    for (let r = 0; r < rows; r++) {
      const i = r * cols + c;
      const source = r < front - 2 ? to : from;
      target.ch[i] = source.ch[i] ?? 32;
      target.fg[i] = source.fg[i] ?? 0;
      target.bg[i] = source.bg[i] ?? NO_BG;
      const behind = front - r;
      if (behind >= 0 && behind < 3) {
        const glyph =
          WIPE_GLYPHS[
            Math.trunc(
              hash01(c * 7 + r * 3 + Math.trunc(seconds * 20)) *
                WIPE_GLYPHS.length
            )
          ] ?? "*";
        target.ch[i] = glyph.charCodeAt(0);
        target.fg[i] =
          behind < 1 ? WIPE_HEAD : mix(WIPE_TAIL, WIPE_HEAD, 1 - behind / 3);
      }
    }
  }
}

function sceneFor(
  grid: Grid,
  layout: Layout,
  plan: ShiftPlan,
  moment: Moment,
  seconds: number,
  watcher: Watcher
): Scene {
  return { grid, layout, plan, moment, seconds, watcher, lights: [] };
}

export function renderFrame(
  buffers: Buffers,
  layout: Layout,
  plan: ShiftPlan,
  moment: Moment,
  seconds: number,
  watcher: Watcher
): FrameOut {
  const { main, from, to } = buffers;
  main.clear();
  let lights: Light[] = [];
  let flash = 0;
  let dawn = 0;
  let exterior = true;

  const inWipe =
    (moment.act === "line" || moment.act === "shipping") &&
    moment.t < WIPE_SECONDS;

  if (inWipe) {
    const progress = moment.t / WIPE_SECONDS;
    from.clear();
    to.clear();
    const toLine = moment.act === "line";
    const before: Moment = toLine
      ? { ...moment, act: "harvest", t: 14, progress: 1 }
      : { ...moment, act: "line", t: 24, progress: 1 };
    const fromScene = sceneFor(from, layout, plan, before, seconds, watcher);
    const toScene = sceneFor(to, layout, plan, moment, seconds, watcher);
    if (toLine) {
      drawExterior(fromScene);
      drawInterior(toScene);
      const fog = fogAt(plan, before, layout);
      rollFog(fromScene, fog.density, fog.top);
    } else {
      drawInterior(fromScene);
      drawExterior(toScene);
      const fog = fogAt(plan, moment, layout);
      rollFog(toScene, fog.density, fog.top);
    }
    wipe(main, from, to, progress, seconds);
    lights = [
      ...fromScene.lights.map((light) => ({
        ...light,
        power: light.power * (1 - progress),
        halo: (light.halo ?? 0) * (1 - progress)
      })),
      ...toScene.lights.map((light) => ({
        ...light,
        power: light.power * progress,
        halo: (light.halo ?? 0) * progress
      }))
    ];
    exterior = !toLine;
  } else if (moment.act === "line") {
    const scene = sceneFor(main, layout, plan, moment, seconds, watcher);
    drawInterior(scene);
    lights = scene.lights;
    exterior = false;
  } else {
    const scene = sceneFor(main, layout, plan, moment, seconds, watcher);
    const out = drawExterior(scene);
    flash = out.flash;
    dawn = out.dawn;
    const fog = fogAt(plan, moment, layout);
    rollFog(scene, fog.density, fog.top);
    lights = scene.lights;
  }

  applyLights(main, layout, lights, buffers.light);

  const sky: Sky = exterior
    ? {
        top: mix(SKY_TOP, DAWN_TOP, dawn),
        horizon: mix(SKY_HORIZON, DAWN_HORIZON, dawn)
      }
    : { top: hex("#120c18"), horizon: hex("#120c18") };
  return { sky, lights, flash };
}
