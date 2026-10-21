// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The Night Shift: a haunted plant on a hill works one shift, midnight to a
// dawn that never comes, making one jack-o'-lantern. Every shift is seeded,
// so it differs from the last (face, weather, visitor, moon phase, now and
// then a rare event), and the lanterns it ships stay on the hill. When the
// hill holds thirteen, they all rise and become the Carbon mark in the sky.

import type { Face } from "./faces";
import { drawFace } from "./faces";
import { hashSeed, pickWeighted, seeded } from "./random";

export const ACTS = [
  { id: "midnight", seconds: 9 },
  { id: "harvest", seconds: 14 },
  { id: "line", seconds: 24 },
  { id: "shipping", seconds: 18 },
  { id: "witching", seconds: 14 },
  { id: "dawn", seconds: 11 }
] as const;

export type ActId = (typeof ACTS)[number]["id"];

export const SHIFT_SECONDS = ACTS.reduce((sum, act) => sum + act.seconds, 0);

/** Where the story is: which shift, which act, how far into it. */
export type Moment = {
  shift: number;
  act: ActId;
  /** Seconds into the act. */
  t: number;
  /** 0 to 1 through the act. */
  progress: number;
  /** Seconds into the shift. */
  shiftT: number;
};

export function actStart(id: ActId) {
  let start = 0;
  for (const act of ACTS) {
    if (act.id === id) return start;
    start += act.seconds;
  }
  return start;
}

export function momentAt(seconds: number, firstShift = 0): Moment {
  const elapsed = Math.max(0, seconds);
  const shifts = Math.trunc(elapsed / SHIFT_SECONDS);
  const shiftT = elapsed - shifts * SHIFT_SECONDS;
  let start = 0;
  for (const act of ACTS) {
    if (shiftT < start + act.seconds) {
      const t = shiftT - start;
      return {
        shift: firstShift + shifts,
        act: act.id,
        t,
        progress: t / act.seconds,
        shiftT
      };
    }
    start += act.seconds;
  }
  const last = ACTS[ACTS.length - 1];
  return {
    shift: firstShift + shifts,
    act: last?.id ?? "dawn",
    t: last?.seconds ?? 0,
    progress: 1,
    shiftT
  };
}

export type Weather = "clear" | "drizzle" | "fog";
export type Visitor = "witch" | "horseman" | "spider" | "ship";
export type RareEvent = "none" | "reject" | "boo" | "dance";

export const LANTERNS_FOR_LIGHTING = 13;
const OPENING_LANTERNS = 4;

export type ShiftPlan = {
  index: number;
  /** The work order on the line's ticket, e.g. "JOB-1031". */
  job: string;
  face: Face;
  weather: Weather;
  visitor: Visitor;
  event: RareEvent;
  /** 0 full, 0.5 new, back to full at 1; one step of eight per shift. */
  moonPhase: number;
  /** The lanterns already on the hill when the shift starts, oldest first. */
  procession: Face[];
  /** This shift's lantern fills the hill: they rise instead of a visitor. */
  greatLighting: boolean;
};

function drawShift(seed: number, index: number, procession: Face[]): ShiftPlan {
  const random = seeded(hashSeed(seed, index));
  const face = drawFace(random);
  const weather = pickWeighted<Weather>(random, [
    ["clear", 9],
    ["drizzle", 5],
    ["fog", 6]
  ]);
  const visitor = pickWeighted<Visitor>(random, [
    ["witch", 1],
    ["horseman", 1],
    ["spider", 1],
    ["ship", 1]
  ]);
  const event = pickWeighted<RareEvent>(random, [
    ["none", 17],
    ["reject", 1],
    ["boo", 1],
    ["dance", 1]
  ]);
  const greatLighting =
    event !== "reject" && procession.length + 1 >= LANTERNS_FOR_LIGHTING;
  return {
    index,
    job: `JOB-${1031 + index}`,
    face,
    weather,
    visitor,
    event,
    moonPhase: (((index % 8) + 8) % 8) / 8,
    procession,
    greatLighting
  };
}

/** The lanterns on the hill once a shift is over. */
export function processionAfter(plan: ShiftPlan): Face[] {
  if (plan.event === "reject") return plan.procession;
  if (plan.greatLighting) return [];
  return [...plan.procession, plan.face];
}

function openingProcession(seed: number) {
  const random = seeded(hashSeed(seed, 0x0bad5eed));
  return Array.from({ length: OPENING_LANTERNS }, () => drawFace(random));
}

/** Plays the story from the first shift to `index` and returns that shift. */
export function planShift(seed: number, index: number): ShiftPlan {
  let procession = openingProcession(seed);
  for (let k = 0; k < index; k++) {
    procession = processionAfter(drawShift(seed, k, procession));
  }
  return drawShift(seed, index, procession);
}
