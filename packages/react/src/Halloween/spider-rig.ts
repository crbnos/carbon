// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The spider's legs, animated the way real legs work rather than wiggled.
//
// Each foot stays put on the page while the body moves over it. Once the body has drawn too far ahead of a
// foot, the leg lifts and swings it forward to a new grip. Spiders walk with
// an alternating tetrapod gait: legs 1 and 3 on one side step together with
// legs 2 and 4 on the other, then the other four, so four feet are always
// down. Each leg's knee is placed by two-bone inverse kinematics, bent
// outward and up as a spider's are.
//
// The body's own frame has the head along +y and the spider's right along
// +x; an angle of 0 points the head down the screen.

import { at, ease } from "./math";

// Sized to sit in the top bar: about 20 px from fangs to spinnerets.
export const SPIDER_SCALE = 0.72;

type Vec = { x: number; y: number };

export type Body = { x: number; y: number; angle: number };

type LegSpec = {
  side: -1 | 1;
  hip: Vec;
  rest: Vec;
  bones: readonly [number, number];
  group: 0 | 1;
};

// Pairs I to IV, front to back, for the right side. Orb weavers reach well
// forward with I and II, hold III short and out to the side, and trail IV.
const PAIRS = [
  { hip: { x: 3.6, y: 2.8 }, rest: { x: 13.5, y: 17.5 }, bones: [10.5, 14] },
  { hip: { x: 4.4, y: 1 }, rest: { x: 18.5, y: 7.5 }, bones: [9.5, 13] },
  { hip: { x: 4.4, y: -0.9 }, rest: { x: 15, y: -5 }, bones: [6.8, 8.8] },
  { hip: { x: 3.7, y: -2.7 }, rest: { x: 11.5, y: -14.5 }, bones: [9, 12] }
] as const;

/** Legs 0–3 are the left side, I to IV; legs 4–7 the right. */
export const LEGS: LegSpec[] = ([-1, 1] as const).flatMap((side) =>
  PAIRS.map((pair, n) => ({
    side,
    hip: { x: pair.hip.x * side, y: pair.hip.y },
    rest: { x: pair.rest.x * side, y: pair.rest.y },
    bones: pair.bones,
    // Left I and III with right II and IV, then the other four.
    group: ((n + (side > 0 ? 1 : 0)) % 2) as 0 | 1
  }))
);

type Foot = {
  x: number;
  y: number;
  stepping: boolean;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t: number;
  duration: number;
};

export type LegPose = { hip: Vec; knee: Vec; ankle: Vec; foot: Vec };

// How far ahead of the body's motion a stepping foot aims, and the most that
// can be: a stride is never longer than a leg.
const LEAD = 0.11;
const MAX_LEAD = 9;

export function toWorld(body: Body, p: Vec): Vec {
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);
  return {
    x: body.x + (p.x * cos - p.y * sin) * SPIDER_SCALE,
    y: body.y + (p.x * sin + p.y * cos) * SPIDER_SCALE
  };
}

// How far the leg's plane leans outward: seen from above, how much the
// raised knee shows off the line from hip to foot.
const SPLAY = 0.3;

/**
 * Two-bone IK with the knee raised towards the viewer, as a spider's is, then
 * seen from above. The knee sits along the line from hip to foot, leaning
 * out a little, so the leg reads as nearly straight with a gentle bend, the
 * way spiders look from above, rather than as an elbow stuck out sideways.
 */
export function solveKnee(
  hip: Vec,
  foot: Vec,
  upper: number,
  lower: number,
  outward: Vec
) {
  const dx = foot.x - hip.x;
  const dy = foot.y - hip.y;
  const reach = Math.hypot(dx, dy) || 1e-6;
  const d = Math.max(
    Math.abs(upper - lower) + 0.01,
    Math.min(upper + lower - 0.01, reach)
  );
  const ux = dx / reach;
  const uy = dy / reach;
  const along = (upper * upper - lower * lower + d * d) / (2 * d);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  // The side of the hip-to-foot line that faces away from the body.
  let px = -uy;
  let py = ux;
  if (px * outward.x + py * outward.y < 0) {
    px = -px;
    py = -py;
  }
  const knee = {
    x: hip.x + ux * along + px * height * SPLAY,
    y: hip.y + uy * along + py * height * SPLAY
  };
  // Out of reach, the leg points straight at the foot, fully stretched.
  const end = { x: hip.x + ux * d, y: hip.y + uy * d };
  return { knee, end, height, outwardSide: { x: px, y: py } };
}

export function createRig() {
  const feet: Foot[] = LEGS.map(() => ({
    x: 0,
    y: 0,
    stepping: false,
    fromX: 0,
    fromY: 0,
    toX: 0,
    toY: 0,
    t: 0,
    duration: 0.1
  }));
  let nextGroup: 0 | 1 = 0;

  const restAt = (body: Body, i: number) => toWorld(body, at(LEGS, i).rest);
  const reachOf = (i: number) => {
    const [upper, lower] = at(LEGS, i).bones;
    return (upper + lower) * SPIDER_SCALE;
  };

  function startStep(i: number, target: Vec, speed: number) {
    const foot = at(feet, i);
    foot.stepping = true;
    foot.fromX = foot.x;
    foot.fromY = foot.y;
    foot.toX = target.x;
    foot.toY = target.y;
    foot.t = 0;
    // Quick steps when running, deliberate ones when creeping.
    foot.duration = Math.max(0.05, Math.min(0.12, 0.12 - speed / 2000));
  }

  return {
    /** Put every foot straight down where it rests. */
    place(body: Body) {
      feet.forEach((foot, i) => {
        const p = restAt(body, i);
        foot.x = p.x;
        foot.y = p.y;
        foot.stepping = false;
      });
    },

    /**
     * Move the feet for this step of the body. "curl" draws the legs in, as a
     * spider dangling from a thread holds them.
     */
    update(dt: number, body: Body, velocity: Vec, mode: "walk" | "curl") {
      const speed = Math.hypot(velocity.x, velocity.y);

      if (mode === "curl") {
        const pull = Math.min(1, dt * 14);
        feet.forEach((foot, i) => {
          const rest = at(LEGS, i).rest;
          const p = toWorld(body, { x: rest.x * 0.42, y: rest.y * 0.42 + 2 });
          foot.x += (p.x - foot.x) * pull;
          foot.y += (p.y - foot.y) * pull;
          foot.stepping = false;
        });
        return;
      }

      // Feet already in the air carry on to where they were going, swinging
      // out and round rather than straight across under the body.
      const lateral = { x: Math.cos(body.angle), y: Math.sin(body.angle) };
      feet.forEach((foot, i) => {
        if (!foot.stepping) return;
        foot.t = Math.min(1, foot.t + dt / foot.duration);
        const to = { x: foot.toX, y: foot.toY };
        const e = ease(foot.t);
        const stride = Math.hypot(to.x - foot.fromX, to.y - foot.fromY);
        const swing =
          Math.sin(Math.PI * foot.t) *
          Math.min(5 * SPIDER_SCALE, stride * 0.35) *
          at(LEGS, i).side;
        foot.x = foot.fromX + (to.x - foot.fromX) * e + lateral.x * swing;
        foot.y = foot.fromY + (to.y - foot.fromY) * e + lateral.y * swing;
        if (foot.t >= 1) {
          foot.stepping = false;
          foot.x = to.x;
          foot.y = to.y;
        }
      });

      const threshold = (speed > 6 ? 4.4 : 6.5) * SPIDER_SCALE;
      const lead = Math.min(
        LEAD,
        (MAX_LEAD * SPIDER_SCALE) / Math.max(speed, 1e-6)
      );
      const targets = feet.map((_, i) => {
        const p = restAt(body, i);
        return { x: p.x + velocity.x * lead, y: p.y + velocity.y * lead };
      });
      const error = feet.map((foot, i) => {
        const target = at(targets, i);
        return Math.hypot(foot.x - target.x, foot.y - target.y);
      });

      if (!feet.some((foot) => foot.stepping)) {
        for (const group of [nextGroup, 1 - nextGroup] as const) {
          const due = LEGS.some(
            (leg, i) => leg.group === group && at(error, i) > threshold
          );
          if (!due) continue;
          LEGS.forEach((leg, i) => {
            if (leg.group === group && at(error, i) > threshold * 0.4) {
              startStep(i, at(targets, i), speed);
            }
          });
          nextGroup = group === 0 ? 1 : 0;
          break;
        }
      }

      // Never leave a leg stretched past its reach, or trailing far behind
      // after a sharp turn or a sudden dash, whatever the gait says.
      let airborne = feet.filter((foot) => foot.stepping).length;
      feet.forEach((foot, i) => {
        if (foot.stepping || airborne >= 5) return;
        const hip = toWorld(body, at(LEGS, i).hip);
        const overstretched =
          Math.hypot(foot.x - hip.x, foot.y - hip.y) > reachOf(i) * 0.97;
        if (overstretched || at(error, i) > threshold * 3.2) {
          startStep(i, at(targets, i), speed);
          airborne++;
        }
      });
    },

    stepping() {
      return feet.some((foot) => foot.stepping);
    },

    feet() {
      return feet.map((foot) => ({
        x: foot.x,
        y: foot.y,
        stepping: foot.stepping
      }));
    },

    /** Hip, knee, ankle and foot of every leg, in page coordinates. */
    pose(body: Body): LegPose[] {
      const outwardRight = { x: Math.cos(body.angle), y: Math.sin(body.angle) };
      return LEGS.map((leg, i) => {
        const foot = at(feet, i);
        const hip = toWorld(body, leg.hip);
        // A foot in the air is lifted towards the viewer: seen from above, the
        // leg looks a little shorter mid-step.
        const lift = foot.stepping ? Math.sin(Math.PI * foot.t) * 0.14 : 0;
        const target = {
          x: foot.x + (hip.x - foot.x) * lift,
          y: foot.y + (hip.y - foot.y) * lift
        };
        const upper = leg.bones[0] * SPIDER_SCALE;
        const lower = leg.bones[1] * SPIDER_SCALE;
        const outward = {
          x: outwardRight.x * leg.side,
          y: outwardRight.y * leg.side
        };
        const { knee, end, height, outwardSide } = solveKnee(
          hip,
          target,
          upper,
          lower,
          outward
        );
        // The metatarsus comes down from the raised knee; near the foot the
        // tarsus bends a little, just short of the end.
        const ankle = {
          x: knee.x + (end.x - knee.x) * 0.74 + outwardSide.x * height * 0.08,
          y: knee.y + (end.y - knee.y) * 0.74 + outwardSide.y * height * 0.08
        };
        return { hip, knee, ankle, foot: end };
      });
    }
  };
}

export type Rig = ReturnType<typeof createRig>;
