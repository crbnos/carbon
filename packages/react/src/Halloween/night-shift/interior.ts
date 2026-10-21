// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The Line: inside the plant, the pumpkin rides a conveyor through four
// stations (wash, carve, light, QC) while a work order in the corner ticks
// along, the way a Carbon job does. Once the candle catches, the whole floor
// turns from cold purple to warm orange.

import { carvedCells, cellKey, HERO_MIN_RADIUS } from "./faces";
import type { Color } from "./grid";
import { hex, mix, scale } from "./grid";
import { flicker, noise2 } from "./noise";
import { drawPumpkin } from "./pumpkin";
import type { Scene } from "./scene";
import { clamp01, ease, fraction, hash01, lerp, segment } from "./scene";
import { CANDLE, LAMP, NOZZLE, SKELETON } from "./sprites";

const WALL_COLD = hex("#120c18");
const WALL_WARM = hex("#1f120b");
const BRICK = hex("#1e1628");
const FLOOR = hex("#0b070e");
const FLOOR_LINE = hex("#3a2f4a");
const BELT = hex("#6a6380");
const ROLLER = hex("#9a93b0");
const LEG = hex("#3e3852");
const SIGN = hex("#8a80a8");
const SIGN_BG = hex("#1b1424");
const LAMP_COLD = hex("#b8c4ff");
const LAMP_WARM = hex("#ffd9a0");
const WATER = hex("#6aa8ff");
const BUBBLE = hex("#a8d4ff");
const CHIP = hex("#f2b26e");
const STEEL = hex("#7d7694");
const BLADE = hex("#e6e3f2");
const WAX = hex("#ece2c6");
const FLAME = hex("#ffd36a");
const BONE = hex("#ece4cf");
const PASS = hex("#6ee7a0");
const FAIL = hex("#ff5a5a");
const TICKET_LINE = hex("#5d5378");
const TICKET_TEXT = hex("#d9d1ee");
const TICKET_JOB = hex("#ffb347");
const TICKET_BG = hex("#140f1c");
const AMBER = hex("#f5b544");
const PENDING = hex("#5a5270");
const PUMPKIN_GLOW = hex("#ff8a2a");

const STATIONS = ["Wash", "Carve", "Light", "QC"] as const;

/** Where the pumpkin is along the line, seconds into the act. */
function travel(t: number, stops: number[], start: number, exit: number) {
  const [wash = 0, carve = 0, light = 0, qc = 0] = stops;
  if (t < 1.5) return start;
  if (t < 3.5) return lerp(start, wash, ease(segment(t, 1.5, 3.5)));
  if (t < 6.5) return wash;
  if (t < 8) return lerp(wash, carve, ease(segment(t, 6.5, 8)));
  if (t < 14.5) return carve;
  if (t < 16) return lerp(carve, light, ease(segment(t, 14.5, 16)));
  if (t < 19.5) return light;
  if (t < 20.5) return lerp(light, qc, ease(segment(t, 19.5, 20.5)));
  if (t < 22.5) return qc;
  return lerp(qc, exit, ease(segment(t, 22.5, 24)));
}

/** Which stations are done, seconds into the act; QC needs the stamp. */
function stationsDone(t: number) {
  return [t >= 6.5, t >= 14.5, t >= 19.5, t >= 21.3];
}

/** How warm the floor is: 0 until the candle catches, then 1. */
export function warmthAt(t: number) {
  return ease(segment(t, 17.4, 18.6));
}

function drawTicket(
  scene: Scene,
  done: boolean[],
  rejected: boolean,
  active: number
) {
  const { grid, layout, plan } = scene;
  const width = Math.min(layout.cols - 4, 48);
  const left = Math.trunc((layout.cols - width) / 2);
  const top = Math.max(7, Math.trunc(layout.rows * 0.12));
  const inner = width - 2;
  const border = `+${"-".repeat(inner)}+`;
  for (let r = top; r <= top + 3; r++) {
    for (let c = left; c <= left + width - 1; c++) grid.blank(c, r, TICKET_BG);
  }
  grid.text(left, top, border, TICKET_LINE);
  grid.text(left, top + 3, border, TICKET_LINE);
  grid.put(left, top + 1, "|", TICKET_LINE);
  grid.put(left, top + 2, "|", TICKET_LINE);
  grid.put(left + width - 1, top + 1, "|", TICKET_LINE);
  grid.put(left + width - 1, top + 2, "|", TICKET_LINE);

  grid.text(left + 2, top + 1, plan.job, TICKET_JOB);
  grid.text(
    left + 3 + plan.job.length,
    top + 1,
    "· Jack-o'-lantern",
    TICKET_TEXT
  );
  const finished = done.every(Boolean);
  const status =
    rejected && done[3] ? "Scrapped" : finished ? "Complete" : "In Progress";
  const statusColor = rejected && done[3] ? FAIL : finished ? PASS : AMBER;
  const statusLeft = left + width - 3 - status.length - 2;
  grid.put(statusLeft, top + 1, "●", statusColor);
  grid.text(statusLeft + 2, top + 1, status, statusColor);

  let x = left + 2;
  STATIONS.forEach((name, k) => {
    const isDone = done[k] ?? false;
    const failed = rejected && k === 3 && isDone;
    const mark = failed ? "✗" : isDone ? "✓" : k === active ? "●" : "○";
    const color = failed
      ? FAIL
      : isDone
        ? PASS
        : k === active
          ? AMBER
          : PENDING;
    grid.put(x, top + 2, mark, color);
    grid.text(
      x + 2,
      top + 2,
      name,
      isDone || k === active ? TICKET_TEXT : PENDING
    );
    x += name.length + 6;
  });
}

export function drawInterior(scene: Scene) {
  const { grid, layout, plan, moment, seconds, lights } = scene;
  const { cols, rows, aspect } = layout;
  const t = moment.act === "line" ? moment.t : 24;
  const warmth = warmthAt(t);
  const rejected = plan.event === "reject";

  // Laid out from the belt up: the pumpkin on it, the station signs just
  // above the pumpkin, the lamps above the signs. So a short panel only
  // loses wall, never a sign behind the pumpkin.
  const beltY = Math.trunc(rows * 0.68);
  const floorY = beltY + Math.max(4, Math.trunc(rows * 0.09));
  const radius = Math.min(6.2, Math.max(HERO_MIN_RADIUS, rows * 0.09));
  const signY = Math.trunc(beltY - radius * 2 - 0.2) - 2;
  const lampY = signY - 4;
  const wall = mix(WALL_COLD, WALL_WARM, warmth);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r < floorY) {
        grid.fill(c, r, wall);
        // Running bond: a mortar course every third row, the joints of
        // each course offset by half a brick. Barely above the wall until
        // a lamp lights it.
        const course = Math.trunc(r / 3);
        const joint = (c + (course % 2) * 5) % 10 === 0;
        if (r % 3 === 2) grid.put(c, r, "_", BRICK);
        else if (joint) grid.put(c, r, "|", BRICK);
      } else {
        grid.fill(c, r, FLOOR);
        if (r === floorY) grid.put(c, r, "_", FLOOR_LINE);
        else if (hash01(c * 31 + r * 7) < 0.05)
          grid.put(c, r, ".", scale(FLOOR_LINE, 0.7));
      }
    }
  }

  const stops = [0.17, 0.37, 0.57, 0.76].map((k) => cols * k);
  const halfWidth = radius * aspect * 1.18;
  const start = -halfWidth - 4;
  const exit = cols + halfWidth + 6;
  let x = travel(t, stops, start, exit);
  let y = beltY - radius - 0.2;
  let spin = Math.sin(seconds * 0.5) * 0.12;
  if (rejected && t > 22.5) {
    const fall = segment(t, 22.6, 24);
    y += fall * fall * rows * 0.5;
    spin += fall * 9;
  }

  stops.forEach((stop, k) => {
    for (let r = 0; r < lampY; r++) grid.put(stop, r, "|", scale(STEEL, 0.6));
    grid.sprite(stop - 1, lampY, LAMP, STEEL);
    const buzz = k === 2 && noise2(seconds * 3, 1, 7) > 0.8 ? 0.4 : 1;
    const color = mix(LAMP_COLD, LAMP_WARM, warmth);
    grid.put(stop, lampY + 2, "o", scale(color, buzz));
    lights.push({
      x: stop,
      y: lampY + 3,
      radius: 11,
      color,
      power: 0.28 * buzz,
      halo: 0.16 * buzz
    });
  });

  const beltShift = Math.trunc(x);
  for (let c = 1; c < cols - 1; c++) {
    const pattern = "=o==";
    const char = pattern[(((c - beltShift) % 4) + 4) % 4] ?? "=";
    grid.put(c, beltY, char, char === "o" ? ROLLER : BELT);
    grid.put(c, beltY + 1, "-", scale(BELT, 0.6));
    if (c % 10 === 3)
      for (let r = beltY + 2; r < floorY; r++) grid.put(c, r, "|", LEG);
  }

  const [wash = 0, carve = 0, light = 0, qc = 0] = stops;
  const top = y - radius;

  if (t >= 3.2 && t < 6.9) {
    for (let r = 0; r < top - 7; r++)
      grid.text(wash - 1, r, "||", scale(STEEL, 0.6));
    grid.sprite(wash - 1, top - 7, NOZZLE, STEEL);
    for (let k = 0; k < 6; k++) {
      const age = fraction(seconds * 1.8 + k / 6);
      grid.put(
        wash + (k % 2 ? 0 : -0.6),
        top - 4 + age * 4,
        age < 0.5 ? "'" : "|",
        WATER
      );
    }
    for (let k = 0; k < 16; k++) {
      const phase = fraction(seconds * 0.45 + k / 16);
      const bx = wash + (hash01(k * 5) - 0.5) * halfWidth * 2.4;
      const by = beltY - 1 - phase * radius * 2.6;
      const char = phase < 0.3 ? "." : phase < 0.65 ? "o" : "O";
      if (
        grid.isBlank(bx, by) ||
        grid.charAt(bx, by) === "_" ||
        grid.charAt(bx, by) === "|"
      ) {
        grid.put(bx, by, char, scale(BUBBLE, 1 - phase * 0.7));
      }
    }
  }

  const cells = carvedCells(plan.face);
  const carving = clamp01(segment(t, 8.6, 14));
  const revealed = t < 8.6 ? 0 : Math.trunc(cells.length * carving);
  const carved = new Set<number>();
  for (let k = 0; k < revealed; k++) {
    const cell = cells[k];
    if (cell) carved.add(cellKey(cell.x, cell.y));
  }
  const ignition = ease(segment(t, 17.4, 18.2));
  const glow =
    ignition * flicker(seconds, 21) * (1 + 0.4 * (1 - segment(t, 18.2, 19)));

  if (x > -halfWidth - 2 && x < cols + halfWidth + 2 && y < rows + radius) {
    drawPumpkin(grid, {
      x,
      y,
      radius,
      aspect,
      spin,
      carved,
      glow: clamp01(glow),
      seconds,
      fill: 0.32
    });
    if (ignition > 0) {
      lights.push({
        x,
        y,
        radius: 10,
        color: PUMPKIN_GLOW,
        power: 0.12 * ignition,
        halo: 0.34 * ignition
      });
    }
  }

  const armUp = t < 8.3 || t > 14.2;
  if (!armUp) {
    const last = cells[Math.max(0, revealed - 1)];
    const bladeX = carve + (last?.x ?? 0);
    const bladeY = Math.trunc(y) + (last?.y ?? -3) - 1;
    // A laser cutter: the arm stops above the pumpkin and the beam's
    // spark sits on the cell being cut.
    const armTop = Math.trunc(rows * 0.12);
    const head = Math.trunc(y - radius) - 1;
    for (let r = armTop; r < head; r++)
      grid.put(bladeX, r, r === head - 2 ? "o" : "|", STEEL);
    grid.put(bladeX, head, "V", BLADE);
    const sparks = ["*", "+", "x"];
    grid.put(
      bladeX,
      bladeY,
      sparks[Math.trunc(seconds * 14) % 3] ?? "*",
      BLADE
    );
    scene.lights.push({
      x: bladeX,
      y: bladeY,
      radius: 2.5,
      color: BLADE,
      power: 0.4,
      halo: 0.18
    });
    for (let k = 0; k < 10; k++) {
      const age = fraction(seconds * 2.2 + k / 10) * 0.9;
      const vx = (hash01(k * 9 + 1) - 0.5) * 16;
      grid.put(
        bladeX + vx * age,
        bladeY - 3 * age + 7 * age * age,
        k % 3 === 0 ? "," : k % 3 === 1 ? "'" : ".",
        scale(CHIP, 1 - age)
      );
    }
  } else {
    const armTop = Math.trunc(rows * 0.12);
    for (let r = armTop; r < armTop + 4; r++)
      grid.put(carve + 9, r, "|", scale(STEEL, 0.7));
    grid.put(carve + 9, armTop + 4, "v", scale(BLADE, 0.6));
  }

  if (t >= 15.6 && t < 17.5) {
    const cy = lerp(-3, top - 2.2, ease(segment(t, 15.6, 17.4)));
    for (let r = 0; r < cy; r++) grid.put(light, r, "|", scale(STEEL, 0.6));
    grid.sprite(light - 1, cy, CANDLE, (char) => (char === "^" ? FLAME : WAX));
    grid.put(light, cy, Math.trunc(seconds * 12) % 2 ? "^" : "'", FLAME);
    lights.push({
      x: light,
      y: cy,
      radius: 3.5,
      color: FLAME,
      power: 0.6,
      halo: 0.22
    });
  }

  const inspector = { x: Math.min(qc + halfWidth + 1, cols - 8), y: beltY - 5 };
  let pose = SKELETON.stand;
  if (t >= 20.5 && t < 21.2) pose = SKELETON.stampUp;
  else if (t >= 21.2 && t < 21.6) pose = SKELETON.stampDown;
  if (rejected && t > 22.8) {
    const run = segment(t, 22.8, 24);
    inspector.x = lerp(inspector.x, cols + 4, run);
    pose = Math.trunc(seconds * 8) % 2 === 0 ? SKELETON.runA : SKELETON.runB;
  }
  grid.sprite(inspector.x, inspector.y, pose, BONE);

  if (t >= 21.3) {
    // `$` keeps the wall out of the gaps between words.
    const stamp = rejected ? "[$REJECTED$]" : "[$QC$PASSED$]";
    const pop = 1 - ease(segment(t, 21.3, 21.6)) * 0.4;
    const color: Color = rejected ? FAIL : PASS;
    grid.sprite(
      qc - Math.trunc(stamp.length / 2),
      beltY - radius * 2 - 3.5,
      [stamp],
      scale(color, pop + 0.4),
      TICKET_BG
    );
  }

  // Signs last, so the wash pipe and the carving arm pass behind them.
  stops.forEach((stop, k) => {
    const label = `[$${(STATIONS[k] ?? "").toUpperCase()}$]`;
    grid.sprite(
      stop - Math.trunc(label.length / 2),
      signY,
      [label],
      SIGN,
      SIGN_BG
    );
  });

  const done = stationsDone(t);
  const active = done.indexOf(false);
  drawTicket(scene, done, rejected, active);

  return { warmth };
}
