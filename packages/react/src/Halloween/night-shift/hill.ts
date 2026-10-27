// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The hill: its ridges and ground, the path, the graveyard, the pumpkin
// patch, the fence with its cat and crow, the lantern procession, the ghost
// and the foreman's dance.

import { ease, fraction, hash01, nearest, segment } from "../math";
import type { Face } from "./faces";
import { hex, mix, scale, spriteWidth } from "./grid";
import { lanternSlot, pointAlong } from "./layout";
import { flicker, noise2 } from "./noise";
import {
  ALARM,
  BONE,
  CAT_BG,
  CAT_EYES,
  CAT_LINE,
  CAW,
  CROW_EYE,
  CROW_LINE,
  DAWN_EDGE,
  FENCE,
  GHOST_BG,
  GHOST_GLOW,
  GRASS,
  GRASS_LIT,
  GROUND_BG,
  HILL_BG,
  LANTERN_LIGHT,
  LEAF,
  PATH,
  PUMPKIN_MARK,
  PUMPKIN_SHELL,
  RIM_EDGE,
  RIP,
  STONE,
  STONE_BG,
  STONE_RIM,
  TEXTURE,
  VINE
} from "./palette";
import { drawLantern } from "./pumpkin";
import type { Scene } from "./scene";
import { CAT, CROW, GHOST, SKELETON, STONES } from "./sprites";
import { LANTERNS_FOR_LIGHTING } from "./story";

export function drawHills(scene: Scene, dawn: number) {
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

export function drawGround(scene: Scene, dawn: number) {
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

export function drawPath(scene: Scene) {
  const { grid, layout } = scene;
  const steps = 110;
  for (let k = 0; k <= steps; k++) {
    if (hash01(k * 29) > 0.7) continue;
    const p = pointAlong(layout.path, k / steps, layout.aspect);
    grid.put(p.x, p.y + 0.4, k % 3 === 0 ? "," : ".", PATH);
  }
}

export function drawStones(scene: Scene) {
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

export function drawPatch(scene: Scene) {
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

export function drawFence(scene: Scene) {
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
export function drawProcession(scene: Scene) {
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

export function drawGhost(scene: Scene) {
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

export function drawDance(scene: Scene) {
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
