// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The hill at night: sky, moon, the plant with its clock tower and crane, the
// graveyard, the fence with its cat and crow, the lantern procession and the
// pumpkin patch, plus whoever visits this shift. Everything here is drawn
// from the moment alone, so any instant of the story can be rendered cold.

import { GROUND, HILL, NIGHT, SILHOUETTE } from "../scene-palette";
import type { Face } from "./faces";
import type { Color } from "./grid";
import { hex, mix, NO_BG, scale, spriteWidth } from "./grid";
import { lanternSlot, pointAlong } from "./layout";
import { fbm2, flicker, noise2 } from "./noise";
import { drawLantern, drawPumpkin } from "./pumpkin";
import type { Scene } from "./scene";
import {
  clamp01,
  ease,
  fraction,
  hash01,
  lerp,
  nearest,
  segment
} from "./scene";
import {
  BAT,
  BOO,
  CAT,
  CLOCK,
  CROW,
  GHOST,
  HORSEMAN,
  MARK_EDGES,
  MARK_STARS,
  SHIP,
  SKELETON,
  SPIDER,
  STONES,
  WITCH
} from "./sprites";
import { ACTS, actStart, LANTERNS_FOR_LIGHTING } from "./story";

export const SKY_TOP = hex(NIGHT);
export const SKY_HORIZON = hex("#1d1233");
export const DAWN_TOP = hex("#191628");
export const DAWN_HORIZON = hex("#5d4a68");
const SILHOUETTE_BG = hex(SILHOUETTE);
const GROUND_BG = hex(GROUND);
const HILL_BG = hex(HILL);
const RIM_EDGE = hex("#5b4a8a");
const DAWN_EDGE = hex("#8a7a96");
const STAR_DIM = hex("#3a3460");
const STAR_BRIGHT = hex("#ece6ff");
const MOON_DARK = hex("#3a3352");
const MOON_LIT = hex("#f4ecd6");
const EARTHSHINE = hex("#211b33");
const BAT_DARK = hex("#0b0711");
const BAT_RIM = hex("#5d4d86");
const GRASS = hex("#2e2440");
const GRASS_LIT = hex("#4d3d6a");
const TEXTURE = hex("#241a33");
const PATH = hex("#4a3a5c");
const STONE = hex("#6f6890");
const STONE_RIM = hex("#a49cc8");
const STONE_BG = hex("#17111f");
const RIP = hex("#3d3656");
const FACTORY_TEXTURE = hex("#1a1226");
const ROOF = hex("#4b3b70");
const WINDOW_OFF = hex("#2a2140");
const WINDOW_DIM = hex("#7a3a10");
const WINDOW_LIT = hex("#ffb347");
const DOOR_WOOD = hex("#1d120e");
const DOOR_OPEN = hex("#8a4a12");
const CHIMNEY = hex("#3d2f52");
const SMOKE = hex("#6a6088");
const CLOCK_RIM = hex("#a89a6a");
const CLOCK_FACE = hex("#3a2f18");
const CLOCK_HAND = hex("#fff1c4");
const STEEL = hex("#5f5874");
const CABLE = hex("#8a83a0");
const VINE = hex("#33502a");
const LEAF = hex("#4c7034");
const PUMPKIN_SHELL = hex("#9a420c");
const PUMPKIN_MARK = hex("#cf6a1c");
const FENCE = hex("#4f3d4e");
const CAT_LINE = hex("#3e3058");
const CAT_BG = hex("#07040b");
const CAT_EYES = hex("#d4ff5a");
const CROW_LINE = hex("#3a304e");
const CROW_EYE = hex("#ffcc33");
const CAW = hex("#efe8ff");
const LANTERN_LIGHT = hex("#ff8a2a");
const ALARM = hex("#ff2d2d");
const GHOST_GLOW = hex("#ddd8f6");
const GHOST_BG = hex("#272238");
const BONE = hex("#ece4cf");
const VISITOR_RIM = hex("#4f4074");
const SHIP_GLOW = hex("#8fd6b8");
const SPIDER_EYES = hex("#ff3b3b");
const HEAD_GLOW = hex("#ffb347");
const RAIN = hex("#5d5585");
const BOLT = hex("#f3eeff");
const RING = hex("#d9c98e");
const STAR_GOLD = hex("#ffe6a8");

/** How far into the dawn: the sky pales, then the clock spins back. */
export function dawnAt(scene: Scene) {
  return scene.moment.act === "dawn" ? ease(segment(scene.moment.t, 0, 6)) : 0;
}

/** Seconds into the Great Lighting (the witching hour, then the dawn). */
function lightingTime(scene: Scene) {
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

function overMoon(scene: Scene, x: number, y: number) {
  const { aspect } = scene.layout;
  const moon = moonAt(scene);
  const dx = (x + 0.5 - moon.x) / (moon.r * aspect);
  const dy = (y + 0.5 - moon.y) / moon.r;
  return dx * dx + dy * dy <= 1;
}

/** A silhouette's glyph colour: black against the moon, rim-lit elsewhere. */
function silhouette(scene: Scene, dark: Color, rim: Color) {
  return (x: number, y: number) => (overMoon(scene, x, y) ? dark : rim);
}

function drawStars(scene: Scene, dawn: number) {
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

function drawMoon(scene: Scene, dawn: number) {
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

function drawBats(scene: Scene) {
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

function drawHills(scene: Scene, dawn: number) {
  const { grid, layout } = scene;
  const edge = mix(RIM_EDGE, DAWN_EDGE, dawn);
  for (let c = 0; c < layout.cols; c++) {
    const top = layout.ridge[c] ?? layout.horizon;
    const r0 = Math.trunc(top);
    for (let r = r0 + 1; r <= layout.horizon + 1; r++) {
      grid.blank(c, r);
      grid.fill(c, r, mix(HILL_BG, hex("#2a2236"), dawn * 0.5));
      if (hash01(c * 131 + r * 71) < 0.045) grid.put(c, r, ".", hex("#2b1f3e"));
    }
    const slope = (layout.ridge[c + 1] ?? top) - (layout.ridge[c - 1] ?? top);
    const char = slope < -0.45 ? "/" : slope > 0.45 ? "\\" : "_";
    grid.put(c, r0, char, edge);
  }
}

function drawGround(scene: Scene, dawn: number) {
  const { grid, layout, seconds } = scene;
  for (let c = 0; c < layout.cols; c++) {
    const top = layout.ground[c] ?? layout.horizon;
    const r0 = Math.trunc(top);
    for (let r = r0 + 1; r < layout.rows; r++) {
      grid.fill(c, r, GROUND_BG);
      grid.blank(c, r);
      const h = hash01(c * 977 + r * 131);
      if (h < 0.07)
        grid.put(c, r, h < 0.025 ? "," : h < 0.05 ? "." : "`", TEXTURE);
    }
    const tall = hash01(c * 17 + 3) < 0.4;
    const sway = noise2(c * 0.25 + seconds * 0.6, 1.3, 2);
    const blade = tall
      ? sway < 0.4
        ? "/"
        : sway > 0.6
          ? "\\"
          : "|"
      : hash01(c) < 0.5
        ? ","
        : "'";
    grid.put(
      c,
      r0,
      blade,
      mix(GRASS, mix(GRASS_LIT, DAWN_EDGE, dawn * 0.4), hash01(c * 3))
    );
  }
}

function drawPath(scene: Scene) {
  const { grid, layout } = scene;
  const steps = 110;
  for (let k = 0; k <= steps; k++) {
    if (hash01(k * 29) > 0.7) continue;
    const p = pointAlong(layout.path, k / steps, layout.aspect);
    grid.put(p.x, p.y + 0.4, k % 3 === 0 ? "," : ".", PATH);
  }
}

function drawStones(scene: Scene) {
  const { grid, layout } = scene;
  for (const stone of layout.stones) {
    const art = STONES[stone.kind];
    const width = spriteWidth(art);
    const left = stone.x - Math.trunc(width / 2);
    const top = stone.base - art.length + 1;
    grid.sprite(
      left,
      top,
      art,
      (char, col, row) =>
        char === "R" || char === "I" || char === "P"
          ? RIP
          : row === 0 || col >= width - 2
            ? STONE_RIM
            : STONE,
      STONE_BG
    );
  }
}

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

function drawFactory(scene: Scene, dawn: number) {
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
function drawCraneAndHero(scene: Scene) {
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

function drawPatch(scene: Scene) {
  const { grid, layout, moment } = scene;
  const { patch } = layout;
  const grown =
    moment.act === "midnight"
      ? 0.15
      : moment.act === "harvest"
        ? ease(segment(moment.t, 0, 5))
        : 1;
  const end = patch.left + (patch.right - patch.left) * grown;
  for (let x = patch.left; x <= end; x++) {
    const wave = Math.sin(x * 0.42);
    const y = patch.y + 1 + nearest(wave * 0.8);
    const slope = Math.cos(x * 0.42);
    const char = slope > 0.5 ? "\\" : slope < -0.5 ? "/" : "~";
    grid.put(x, y, char, VINE);
    if (hash01(x * 41) < 0.22)
      grid.put(x, y - 1, hash01(x) < 0.5 ? "&" : "%", LEAF);
    if (hash01(x * 7 + 1) < 0.12) grid.put(x, y + 1, "@", scale(VINE, 0.8));
  }
  const spots = 6;
  for (let k = 0; k < spots; k++) {
    const x =
      patch.left + 2 + ((k + 0.5) * (patch.right - patch.left - 4)) / spots;
    if (Math.abs(x - layout.hero.x) < 7) continue;
    if (x > end) continue;
    const y = patch.y + (k % 2) - 0.2;
    const art = k % 3 === 0 ? "(@)" : k % 3 === 1 ? "(o)" : "(O)";
    grid.text(x - 1, y, art, PUMPKIN_SHELL);
    grid.put(x, y, art[1] ?? "@", PUMPKIN_MARK);
    grid.put(x, y - 1, "'", VINE);
  }
}

function drawFence(scene: Scene) {
  const { grid, layout, seconds, watcher } = scene;
  const { fence } = layout;
  for (let c = fence.left; c <= fence.right; c++) {
    const post = (c - fence.left) % 3 === 0;
    if (post) grid.put(c, fence.top, "^", FENCE);
    grid.put(c, fence.top + 1, post ? "|" : "-", FENCE);
    if (post) grid.put(c, fence.top + 2, "|", scale(FENCE, 0.8));
  }

  const { cat } = layout;
  let look: keyof typeof CAT.eyes = "ahead";
  if (watcher.secret) look = "left";
  else if (watcher.field) look = "right";
  else if (watcher.pointer) {
    const dx = watcher.pointer.x - cat.x;
    look = dx < -5 ? "left" : dx > 5 ? "right" : "ahead";
  } else {
    const idle = noise2(seconds * 0.18, 9, 4);
    look = idle < 0.36 ? "left" : idle > 0.64 ? "right" : "ahead";
  }
  if (fraction(seconds / 4.7) < 0.035) look = "blink";
  const art = [CAT.ears, CAT.eyes[look], ...CAT.body];
  grid.sprite(
    cat.x - 3,
    cat.y,
    art,
    (char) => (char === "o" ? CAT_EYES : CAT_LINE),
    CAT_BG
  );
  if (look !== "blink") {
    scene.lights.push({
      x: cat.x,
      y: cat.y + 1.5,
      radius: 1.4,
      color: CAT_EYES,
      power: 0.2,
      halo: 0.06
    });
  }

  const { crow } = layout;
  grid.sprite(
    crow.x,
    crow.y,
    CROW,
    (char) =>
      char === "o" ? CROW_EYE : char === ">" ? hex("#c9a227") : CROW_LINE,
    CAT_BG
  );
  if (watcher.alarm > 0)
    grid.text(
      crow.x + 4,
      crow.y - 1,
      "caw.",
      mix(CROW_LINE, CAW, watcher.alarm)
    );
}

function lanternLight(
  scene: Scene,
  x: number,
  y: number,
  lit: number,
  away: boolean
) {
  const flare = scene.watcher.flare;
  scene.lights.push({
    x,
    y,
    radius: 2.8 + flare * 2,
    color:
      scene.watcher.alarm > 0
        ? mix(LANTERN_LIGHT, ALARM, scene.watcher.alarm)
        : LANTERN_LIGHT,
    power: 0.55 * lit * (away ? 0.45 : 1) * (1 + flare * 1.6),
    halo: 0.2 * lit * (away ? 0.5 : 1) * (1 + flare * 1.6)
  });
}

function lanternTint(scene: Scene, lit: number) {
  const { alarm } = scene.watcher;
  if (alarm <= 0) return undefined;
  const on = fraction(scene.seconds * 7) < 0.6;
  return mix(hex("#ffd36a"), ALARM, on ? alarm : alarm * 0.4 * lit);
}

/** The lanterns on the hill, the newest still hopping down from the door. */
function drawProcession(scene: Scene) {
  const { grid, layout, plan, moment, seconds, watcher } = scene;
  if (
    plan.greatLighting &&
    (moment.act === "witching" || moment.act === "dawn")
  )
    return;
  const shipped =
    (moment.act === "witching" || moment.act === "dawn") &&
    plan.event !== "reject";
  const lanterns: Face[] = shipped
    ? [...plan.procession, plan.face]
    : plan.procession;
  const peek = lanterns.length - 1;
  lanterns.forEach((face, i) => {
    const s = lanternSlot(i, LANTERNS_FOR_LIGHTING);
    const p = pointAlong(layout.path, s, layout.aspect);
    const bob = noise2(seconds * 1.1 + i * 3.1, i, 6) > 0.64 ? -1 : 0;
    const lit = flicker(seconds + i * 1.7, i);
    const away = watcher.secret && !(watcher.peek && i === peek);
    drawLantern(grid, p.x, p.y - 0.6 + bob, face, {
      lit,
      away,
      tint: lanternTint(scene, lit)
    });
    lanternLight(scene, p.x, p.y - 0.6 + bob, lit, away);
  });

  if (moment.act !== "shipping") return;
  const t = moment.t;
  if (plan.event === "reject") {
    const s = segment(t, 2, 8.5) * 1.15;
    if (t > 2 && s <= 1) {
      const p = pointAlong(layout.path, s, layout.aspect);
      const roll =
        ["(@)", "(o)", "(@)", "(O)"][Math.trunc(seconds * 10) % 4] ?? "(@)";
      grid.text(p.x - 1, p.y - 0.6, roll, PUMPKIN_MARK);
    }
    const chase = segment(t, 2.7, 9.8) * 1.15;
    if (t > 2.7 && chase <= 1) {
      const p = pointAlong(layout.path, chase, layout.aspect);
      const frame =
        Math.trunc(seconds * 8) % 2 === 0 ? SKELETON.runA : SKELETON.runB;
      grid.sprite(p.x - 3, p.y - 4.6, frame, BONE);
    }
    return;
  }
  if (t < 2.5) return;
  const u = segment(t, 2.5, 11.5);
  const slot = lanternSlot(plan.procession.length, LANTERNS_FOR_LIGHTING);
  const p = pointAlong(layout.path, slot * u, layout.aspect);
  const hop = u < 1 ? Math.sin(fraction((t - 2.5) / 0.5) * Math.PI) * 1.2 : 0;
  const lit = flicker(seconds, 99);
  const away = watcher.secret && !watcher.peek;
  drawLantern(grid, p.x, p.y - 0.6 - hop, plan.face, {
    lit,
    away,
    tint: lanternTint(scene, lit)
  });
  lanternLight(scene, p.x, p.y - 0.6 - hop, lit, away);
}

function drawGhost(scene: Scene) {
  const { grid, layout, moment, seconds, watcher, lights } = scene;
  let alpha = 0;
  if (moment.act === "shipping") alpha = ease(segment(moment.t, 1.5, 4));
  else if (moment.act === "witching") alpha = 1;
  else if (moment.act === "dawn") alpha = 1 - ease(segment(moment.t, 6, 9));
  if (alpha <= 0) return;
  const first = layout.stones[0];
  const last = layout.stones[layout.stones.length - 1];
  const mid = first && last ? (first.x + last.x) / 2 : layout.cols * 0.45;
  const base = first?.base ?? layout.horizon + 2;
  const x = mid + Math.sin(seconds * 0.23) * layout.cols * 0.07;
  const y = base - 6.5 + Math.sin(seconds * 1.2) * 0.7;
  const body = watcher.secret
    ? watcher.peek
      ? GHOST.peek
      : GHOST.shut
    : GHOST.open;
  const hem = GHOST.hem[Math.trunc(seconds * 2.5) % 2] ?? GHOST.hem[0] ?? "";
  const color = mix(GROUND_BG, GHOST_GLOW, alpha * 0.9);
  grid.sprite(x - 4, y, [...body, hem], color, mix(GROUND_BG, GHOST_BG, alpha));
  lights.push({
    x,
    y: y + 2,
    radius: 3.4,
    color: hex("#b8b0ff"),
    power: 0.18 * alpha,
    halo: 0.1 * alpha
  });
}

function drawDance(scene: Scene) {
  const { grid, layout, moment, plan, seconds } = scene;
  if (plan.event !== "dance" || moment.act !== "witching" || plan.greatLighting)
    return;
  const f = layout.factory;
  const x = f.door + 3;
  const y = f.base - 4;
  const step = Math.trunc(seconds / 0.4) % 2 === 0;
  grid.sprite(x, y, step ? SKELETON.danceA : SKELETON.danceB, BONE);
  grid.text(x + (step ? 7 : 6), y + (step ? 0 : 2), "c[_]", hex("#c8a27a"));
  for (let k = 0; k < 3; k++) {
    const age = fraction(seconds * 0.5 + k / 3);
    grid.put(
      x + 3 + Math.sin(age * 6 + k) * 2,
      y - 1 - age * 5,
      k % 2 ? "♪" : "♫",
      scale(BONE, 1 - age)
    );
  }
}

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
function drawGreatLighting(scene: Scene) {
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

function drawSkyVisitor(scene: Scene) {
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

function drawHorseman(scene: Scene) {
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

function drawBong(scene: Scene) {
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

function drawRain(scene: Scene) {
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
function drawLightning(scene: Scene) {
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

export function drawExterior(scene: Scene) {
  const dawn = dawnAt(scene);
  drawStars(scene, dawn);
  drawMoon(scene, dawn);
  drawSkyVisitor(scene);
  drawBats(scene);
  drawHills(scene, dawn);
  drawHorseman(scene);
  drawGround(scene, dawn);
  drawPath(scene);
  drawStones(scene);
  drawFactory(scene, dawn);
  drawCraneAndHero(scene);
  drawFence(scene);
  drawPatch(scene);
  drawProcession(scene);
  drawGhost(scene);
  drawDance(scene);
  drawGreatLighting(scene);
  drawBong(scene);
  drawRain(scene);
  const flash = drawLightning(scene);
  return { dawn, flash };
}
