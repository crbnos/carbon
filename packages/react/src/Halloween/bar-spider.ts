// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CornerWeb } from "./corner-web";
import { BAR_HEIGHT, createCornerWeb } from "./corner-web";
import { at, seeded } from "./math";
import type { Body, LegPose } from "./spider-rig";
import { createRig, SPIDER_SCALE, toWorld } from "./spider-rig";

// A garden spider living on the top bar, with a web in each of its top
// corners.
//
// It rests in one web, head down, and now and then climbs out and crawls
// along the bar's lower edge: a few steps, a stop to feel about, a few more,
// sometimes all the way across to the other web. A pointer drawing near makes
// it stop and turn to face it, following it as it moves; one coming close
// sends it running for the nearest web, where it hides until things are quiet.
//
// It never stands in the way: wherever it is over or beside something on the
// bar (a button, a link, the breadcrumbs), its click target is switched off,
// so a click there goes to the bar. Picked up, it drops on a dragline, legs
// drawn in, bounces and climbs back.

export const HIT_SIZE = 26;
const STEP = 1 / 120;

// The spider's walk along the bar, just inside its lower border.
const RUN_Y = BAR_HEIGHT - 7;
// The pointer this close and it runs.
const FLEE_RADIUS = 52;
// The pointer this close and it stops to watch it.
const WATCH_RADIUS = 150;
// Watching, it waits this long after the pointer has gone before moving on.
const WATCH_LINGER = 1.2;
// Hiding, it waits for the pointer to stay this far off for a while.
const SAFE_DISTANCE = 90;
const QUIET_BEFORE_RETURN = 4;

const WALK_SPEED = 34;
const RUN_SPEED = 140;
const ACCELERATION = 1800;
const TURN_RATE = 7;

// The dragline.
const GRAVITY = 1100;
const THREAD_STIFFNESS = 70;
const DANGLE_DAMPING = 0.85;
const CLIMB_RATE = 2.4;
const MAX_PULL = 90;
// The spinnerets, at the tip of the abdomen, in the spider's own frame.
const SPINNERETS = -21.8;

type Vec = { x: number; y: number };
type Mode =
  | "rest"
  | "walk"
  | "pause"
  | "watch"
  | "hide"
  | "drag"
  | "dangle"
  | "fall";

/** Something on the bar the spider must not cover with its click target. */
export type Obstacle = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type BarSpiderElements = {
  svg: SVGSVGElement | null;
  webs: {
    spokes: SVGPathElement | null;
    rings: SVGPathElement | null;
    torn: SVGPathElement | null;
  }[];
  dragline: SVGLineElement | null;
  body: SVGGElement | null;
  femurs: SVGPathElement | null;
  tibiae: SVGPathElement | null;
  tarsi: SVGPathElement | null;
  joints: SVGPathElement | null;
  bristles: SVGPathElement | null;
  button: HTMLButtonElement | null;
};

export type BarSpiderOptions = {
  /** The spider stays in its web and nothing moves. */
  reducedMotion?: boolean;
};

const nothing = () => undefined;

/** Shortest turn from a to b, in radians. */
function turn(from: number, to: number) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** The angle that points the spider's head along (dx, dy). */
const facing = (dx: number, dy: number) => Math.atan2(-dx, dy);

export function createBarSpider() {
  const rig = createRig();
  const rand = seeded(31);

  let width = 0;
  // Where the layer sits on the screen, from the last layout: a pointer event
  // is turned into layer coordinates without measuring the page.
  let origin = { left: 0, top: 0 };
  let webs: CornerWeb[] = [];
  // The spider's path: out of the left web, along the bar, into the right one.
  let track: Vec[] = [];
  let lengths: number[] = [];
  let total = 0;
  let obstacles: Obstacle[] = [];

  const spider = {
    mode: "rest" as Mode,
    /** Distance along the track. */
    s: 0,
    target: 0,
    speed: 0,
    maxSpeed: WALK_SPEED,
    nextStop: 0,
    pause: 0,
    timer: 0,
    after: nothing as () => void,
    body: { x: 0, y: 0, angle: 0 } as Body,
    vx: 0,
    vy: 0,
    // On a dragline: the spinnerets, and where the thread is tied.
    sx: 0,
    sy: 0,
    svx: 0,
    svy: 0,
    hold: { x: 0, y: 0 } as Vec,
    holdS: 0,
    thread: 0,
    threadTarget: 0,
    spin: 0
  };

  const pointer = {
    x: -1000,
    y: -1000,
    time: 0,
    pressed: false,
    downX: 0,
    downY: 0,
    grabDX: 0,
    grabDY: 0,
    dragged: false,
    lastDragX: 0,
    lastDragY: 0,
    lastDragTime: 0,
    dragVX: 0,
    dragVY: 0
  };

  let el: BarSpiderElements | null = null;
  let options: BarSpiderOptions = {};
  let frame = 0;
  let last = 0;
  let accumulator = 0;
  let calm = 0;
  let awake = false;
  let idleTimer = 0;
  let quietSince = 0;
  // Watching: whether the pointer is still close (else it moves on soon).
  let watching = false;
  let pointerWasNear = false;
  // Asked to appear before the bar had a width (the layer is hidden below
  // md): there is no track yet, so it appears on the first real layout.
  let appearOnLayout = false;

  // ---- The track ------------------------------------------------------------

  function buildTrack() {
    const left = webs[0]?.hub() ?? { x: 25, y: 16 };
    const right = webs[1]?.hub() ?? { x: width - 25, y: 16 };
    track = [
      left,
      { x: left.x + 10, y: 30 },
      { x: left.x + 24, y: RUN_Y },
      { x: right.x - 24, y: RUN_Y },
      { x: right.x - 10, y: 30 },
      right
    ];
    lengths = track.slice(1).map((p, i) => {
      const previous = at(track, i);
      return Math.hypot(p.x - previous.x, p.y - previous.y);
    });
    total = lengths.reduce((sum, length) => sum + length, 0);
  }

  /** The point s along the track, and which way the track runs there. */
  function along(s: number) {
    let rest = Math.max(0, Math.min(total, s));
    for (let k = 0; k < lengths.length; k++) {
      const length = at(lengths, k);
      if (rest <= length || k === lengths.length - 1) {
        const a = k === 0 ? (webs[0]?.hub() ?? at(track, 0)) : at(track, k);
        const b =
          k === lengths.length - 1
            ? (webs[1]?.hub() ?? at(track, k + 1))
            : at(track, k + 1);
        const t = length ? Math.min(1, rest / length) : 0;
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          dx: b.x - a.x,
          dy: b.y - a.y
        };
      }
      rest -= length;
    }
    const start = at(track, 0);
    return { x: start.x, y: start.y, dx: 1, dy: 0 };
  }

  // Where the bottom run starts and ends along the track.
  const runStart = () => at(lengths, 0) + at(lengths, 1);
  const runEnd = () =>
    total - at(lengths, lengths.length - 1) - at(lengths, lengths.length - 2);
  const atHome = () => spider.s <= 0.5 || spider.s >= total - 0.5;
  const homeWeb = () => (spider.s <= total / 2 ? webs[0] : webs[1]);

  // ---- Behaviour ------------------------------------------------------------

  function clearIdle() {
    window.clearTimeout(idleTimer);
  }

  function later(seconds: number, then: () => void) {
    clearIdle();
    if (options.reducedMotion) return;
    idleTimer = window.setTimeout(() => {
      if (document.visibilityState !== "visible") {
        later(seconds, then);
        return;
      }
      // Anything that moves the spider wakes the loop itself (`walkTo`,
      // `watch`), so a check that changes nothing costs no frames.
      then();
    }, seconds * 1000);
  }

  /** Still for a while, in a web or out on the bar; then out for a walk. */
  function rest(seconds: number) {
    spider.mode = "rest";
    spider.speed = 0;
    later(seconds, wander);
  }

  /** Off along the bar to somewhere, in fits and starts. */
  function wander() {
    const target = runStart() + rand() * (runEnd() - runStart());
    walkTo(target, WALK_SPEED, () => {
      spider.mode = "pause";
      spider.timer = 1 + rand() * 2.4;
      // Now and then it settles where it is for a long while; otherwise
      // it moves on. (The webs sit over the bar's corner buttons, so it only
      // goes in to hide.)
      spider.after = () => (rand() < 0.35 ? rest(14 + rand() * 20) : wander());
    });
  }

  function walkTo(target: number, maxSpeed: number, then: () => void) {
    clearIdle();
    spider.mode = "walk";
    spider.target = Math.max(0, Math.min(total, target));
    spider.maxSpeed = maxSpeed;
    spider.nextStop = 14 + rand() * 30;
    spider.after = then;
    wake();
  }

  /** Something big close by: run for the nearest web the other way, and hide. */
  function flee() {
    const pointerIsLeft = pointer.x < spider.body.x;
    walkTo(pointerIsLeft ? total : 0, RUN_SPEED, () => {
      spider.mode = "hide";
      quietSince = performance.now();
      watchFromHiding();
    });
  }

  function watchFromHiding() {
    later(1, () => {
      if (spider.mode !== "hide") return;
      const away =
        Math.hypot(pointer.x - spider.body.x, pointer.y - spider.body.y) >
        SAFE_DISTANCE;
      if (!away) quietSince = performance.now();
      if (
        away &&
        performance.now() - quietSince >= QUIET_BEFORE_RETURN * 1000
      ) {
        wander();
        return;
      }
      watchFromHiding();
    });
  }

  // ---- The loop ---------------------------------------------------------------

  function wake() {
    calm = 0;
    if (awake || !el || width === 0) return;
    awake = true;
    last = performance.now();
    accumulator = 0;
    frame = requestAnimationFrame(tick);
  }

  function sleep() {
    awake = false;
    cancelAnimationFrame(frame);
  }

  function tick(now: number) {
    const elapsed = Math.min(0.05, (now - last) / 1000);
    last = now;
    accumulator += elapsed;
    while (accumulator >= STEP) {
      step(STEP);
      accumulator -= STEP;
    }
    render();

    const resting =
      spider.mode === "rest" ||
      spider.mode === "hide" ||
      spider.mode === "watch";
    const target = restingAngle();
    const settled =
      resting &&
      !rig.stepping() &&
      webs.every((web) => web.restlessness() < 1) &&
      (target === null || Math.abs(turn(spider.body.angle, target)) < 0.01);
    calm = settled ? calm + 1 : 0;
    // Asleep after half a second of stillness: an idle page costs nothing.
    if (calm > 30) {
      awake = false;
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function step(dt: number) {
    for (const web of webs) web.step(dt);
    const before = { x: spider.body.x, y: spider.body.y };

    switch (spider.mode) {
      case "rest":
      case "hide":
      case "watch": {
        place();
        const target = restingAngle();
        if (target !== null) turnTowards(target, dt);
        if (atHome()) homeWeb()?.loadHub(0, 60);
        break;
      }
      case "pause":
        place();
        spider.timer -= dt;
        if (spider.timer <= 0) spider.after();
        break;
      case "walk":
        walkStep(dt);
        break;
      case "drag":
        break;
      case "dangle":
      case "fall":
        dangleStep(dt);
        break;
    }

    spider.vx = (spider.body.x - before.x) / dt;
    spider.vy = (spider.body.y - before.y) / dt;
    const onThread =
      spider.mode === "drag" ||
      spider.mode === "dangle" ||
      spider.mode === "fall";
    rig.update(
      dt,
      spider.body,
      { x: spider.vx, y: spider.vy },
      onThread ? "curl" : "walk"
    );
  }

  /** Whether the pointer is close enough for the spider to watch it. */
  function pointerNear() {
    return (
      Math.hypot(pointer.x - spider.body.x, pointer.y - spider.body.y) <
      WATCH_RADIUS
    );
  }

  /**
   * Where a still spider looks: at a pointer close by; otherwise, in a web,
   * head down, and out on the bar, as it stood (null).
   */
  function restingAngle() {
    if (spider.mode === "watch" || pointerNear()) {
      return facing(pointer.x - spider.body.x, pointer.y - spider.body.y);
    }
    return atHome() ? 0 : null;
  }

  /** Something moving close by: stop and face it. */
  function watch() {
    clearIdle();
    spider.mode = "watch";
    spider.speed = 0;
    spider.pause = 0;
    watching = true;
    wake();
  }

  function place() {
    const p = along(spider.s);
    spider.body.x = p.x;
    spider.body.y = p.y;
  }

  /**
   * Turn towards an angle: quickly while far off, easing in as it lines up,
   * and never past it.
   */
  function turnTowards(target: number, dt: number) {
    const delta = turn(spider.body.angle, target);
    const size = Math.min(
      Math.abs(delta),
      TURN_RATE * dt,
      Math.max(Math.abs(delta) * 0.35, 0.02)
    );
    spider.body.angle += Math.sign(delta) * size;
    if (Math.abs(turn(spider.body.angle, target)) < 0.004) {
      spider.body.angle = target;
    }
  }

  function walkStep(dt: number) {
    if (spider.pause > 0) {
      spider.pause -= dt;
      spider.speed = 0;
      place();
      return;
    }
    const direction = Math.sign(spider.target - spider.s) || 1;
    const here = along(spider.s);
    const target = facing(here.dx * direction, here.dy * direction);
    const off = Math.abs(turn(spider.body.angle, target));
    turnTowards(target, dt);
    // Turn first if facing well away; then go, braking hard to stop dead.
    const limit = off > 0.9 ? 0 : spider.maxSpeed;
    const left = Math.abs(spider.target - spider.s);
    const braking = Math.sqrt(2 * ACCELERATION * 1.2 * left);
    const wanted = Math.min(limit, braking);
    spider.speed =
      wanted > spider.speed
        ? Math.min(wanted, spider.speed + ACCELERATION * dt)
        : wanted;
    const move = Math.min(left, spider.speed * dt);
    spider.s += move * direction;
    // A walk is never one long glide: it stops now and then to feel about.
    if (spider.maxSpeed <= WALK_SPEED) {
      spider.nextStop -= move;
      if (spider.nextStop <= 0) {
        spider.nextStop = 14 + rand() * 30;
        spider.pause = 0.25 + rand() * 0.9;
      }
    }
    place();
    if (left - move <= 0.01) {
      spider.s = spider.target;
      spider.speed = 0;
      spider.mode = "pause";
      spider.timer = 0;
      const then = spider.after;
      spider.after = nothing;
      then();
    }
  }

  function dangleStep(dt: number) {
    let tension = 0;
    let ux = 0;
    let uy = 0;
    if (spider.mode === "dangle") {
      const h = spider.hold;
      const dx = spider.sx - h.x;
      const dy = spider.sy - h.y;
      const length = Math.hypot(dx, dy) || 1e-6;
      ux = dx / length;
      uy = dy / length;
      if (length > spider.thread) {
        tension = THREAD_STIFFNESS * (length - spider.thread);
      }
      spider.thread +=
        (spider.threadTarget - spider.thread) * Math.min(1, dt * CLIMB_RATE);
      spider.timer -= dt;
      if (spider.timer <= 0) spider.threadTarget = 0;
      // The last of the climb: it hauls itself back up onto the bar.
      if (spider.threadTarget === 0 && spider.thread < 3) {
        const pull = Math.min(1, dt * 9);
        spider.sx += (h.x - spider.sx) * pull;
        spider.sy += (h.y - spider.sy) * pull;
        spider.svx = 0;
        spider.svy = 0;
        placeFromSpinnerets(dt);
        if (Math.hypot(spider.sx - h.x, spider.sy - h.y) < 1.5) land();
        return;
      }
    }
    spider.svx += (-tension * ux - DANGLE_DAMPING * spider.svx) * dt;
    spider.svy += (GRAVITY - tension * uy - DANGLE_DAMPING * spider.svy) * dt;
    spider.sx += spider.svx * dt;
    spider.sy += spider.svy * dt;
    placeFromSpinnerets(dt);
  }

  /** On a thread the spider hangs from its spinnerets, head down. */
  function placeFromSpinnerets(dt: number) {
    if (spider.mode === "fall") {
      spider.body.angle += spider.spin * dt;
    } else {
      const dx = spider.hold.x - spider.sx;
      const dy = spider.hold.y - spider.sy;
      if (Math.hypot(dx, dy) > 2) turnTowards(Math.atan2(dx, -dy), dt);
    }
    const reach = -SPINNERETS * SPIDER_SCALE;
    spider.body.x = spider.sx - Math.sin(spider.body.angle) * reach;
    spider.body.y = spider.sy + Math.cos(spider.body.angle) * reach;
  }

  function land() {
    spider.s = spider.holdS;
    place();
    rig.place(spider.body);
    spider.mode = "pause";
    spider.timer = 0.8;
    spider.after = wander;
  }

  // ---- Drawing ------------------------------------------------------------------

  function render() {
    if (!el) return;
    webs.forEach((web, k) => {
      const p = web.paths();
      const parts = el?.webs[k];
      if (!parts) return;
      parts.spokes?.setAttribute("d", p.spokes);
      parts.rings?.setAttribute("d", p.rings);
      parts.torn?.setAttribute("d", p.torn);
    });

    const { body } = spider;
    el.body?.setAttribute(
      "transform",
      `translate(${body.x} ${body.y}) rotate(${(body.angle * 180) / Math.PI}) scale(${SPIDER_SCALE})`
    );
    drawLegs(rig.pose(body));

    const onThread = spider.mode === "drag" || spider.mode === "dangle";
    el.dragline?.setAttribute("visibility", onThread ? "visible" : "hidden");
    if (onThread) {
      const s = toWorld(body, { x: 0, y: SPINNERETS });
      el.dragline?.setAttribute("x1", String(spider.hold.x));
      el.dragline?.setAttribute("y1", String(spider.hold.y));
      el.dragline?.setAttribute("x2", String(s.x));
      el.dragline?.setAttribute("y2", String(s.y));
    }

    if (el.button) {
      const box = hitBox();
      el.button.style.transform = `translate(${box.left}px, ${box.top}px)`;
      // Over or beside anything on the bar, the spider takes no clicks: they
      // go to the bar. Being dragged, it keeps the one it has.
      el.button.style.pointerEvents =
        spider.mode === "drag" || clickable(box) ? "auto" : "none";
    }
  }

  /** The click target: on the body, inside the bar unless pulled out of it. */
  function hitBox(): Obstacle {
    const centre = toWorld(spider.body, { x: 0, y: -6 });
    const free =
      spider.mode === "drag" ||
      spider.mode === "dangle" ||
      spider.mode === "fall";
    const lowest = free ? Number.POSITIVE_INFINITY : BAR_HEIGHT - HIT_SIZE;
    const top = Math.min(lowest, Math.max(0, centre.y - HIT_SIZE / 2));
    const left = Math.min(
      Math.max(0, width - HIT_SIZE),
      Math.max(0, centre.x - HIT_SIZE / 2)
    );
    return { left, top, right: left + HIT_SIZE, bottom: top + HIT_SIZE };
  }

  function clickable(box: Obstacle) {
    const margin = 4;
    return !obstacles.some(
      (o) =>
        box.left < o.right + margin &&
        box.right > o.left - margin &&
        box.top < o.bottom + margin &&
        box.bottom > o.top - margin
    );
  }

  function drawLegs(legs: LegPose[]) {
    let femurs = "";
    let tibiae = "";
    let tarsi = "";
    let bands = "";
    let spines = "";
    // Leg detail scales with the spider.
    const k = SPIDER_SCALE / 1.15;
    // A short stretch from a toward b: the pale ring where a segment begins.
    const band = (a: Vec, b: Vec, length: number) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const span = Math.hypot(dx, dy) || 1;
      const f = Math.min(1, length / span);
      return `M ${a.x} ${a.y} L ${a.x + dx * f} ${a.y + dy * f} `;
    };
    // Fine spines along a segment, raked back towards the foot.
    const rake = (a: Vec, b: Vec) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const span = Math.hypot(dx, dy) || 1;
      const ux = dx / span;
      const uy = dy / span;
      const count = Math.trunc(span / (2.4 * k));
      let d = "";
      for (let n = 0; n < count; n++) {
        const t = (n + 0.6) / (count + 0.2);
        const x = a.x + dx * t;
        const y = a.y + dy * t;
        const side = n % 2 === 0 ? 1 : -1;
        d += `M ${x} ${y} l ${(ux * 0.8 - uy * 0.75 * side) * 1.15 * k} ${(uy * 0.8 + ux * 0.75 * side) * 1.15 * k} `;
      }
      return d;
    };
    for (const { hip, knee, ankle, foot } of legs) {
      femurs += `M ${hip.x} ${hip.y} L ${knee.x} ${knee.y} `;
      tibiae += `M ${knee.x} ${knee.y} L ${ankle.x} ${ankle.y} `;
      tarsi += `M ${ankle.x} ${ankle.y} L ${foot.x} ${foot.y} `;
      bands += band(knee, ankle, 1.7 * k) + band(ankle, foot, 1.2 * k);
      spines += rake(hip, knee) + rake(knee, ankle);
    }
    el?.femurs?.setAttribute("d", femurs);
    el?.tibiae?.setAttribute("d", tibiae);
    el?.tarsi?.setAttribute("d", tarsi);
    el?.joints?.setAttribute("d", bands);
    el?.bristles?.setAttribute("d", spines);
  }

  // ---- The pointer ------------------------------------------------------------

  function local(clientX: number, clientY: number) {
    return { x: clientX - origin.left, y: clientY - origin.top };
  }

  function onPointerMove(event: PointerEvent) {
    if (!el?.svg || !total || spider.mode === "drag") return;
    const p = local(event.clientX, event.clientY);
    const now = event.timeStamp;
    const dt = Math.max(0.008, (now - pointer.time) / 1000);
    const pvx = Math.max(-1500, Math.min(1500, (p.x - pointer.x) / dt));
    const pvy = Math.max(-1500, Math.min(1500, (p.y - pointer.y) / dt));
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.time = now;
    // A fallen spider never counts as resting, so a wake here would run
    // frames until `appear`.
    if (options.reducedMotion || spider.mode === "fall") return;

    const near = Math.hypot(p.x - spider.body.x, p.y - spider.body.y);
    const wasNear = pointerWasNear;
    pointerWasNear = near < WATCH_RADIUS;
    const running = spider.mode === "walk" && spider.maxSpeed >= RUN_SPEED;
    if (
      near < FLEE_RADIUS &&
      !running &&
      (spider.mode === "walk" ||
        spider.mode === "pause" ||
        spider.mode === "rest" ||
        spider.mode === "watch")
    ) {
      // Already home and the pointer is on the open side: it stays put.
      if (!(spider.mode === "rest" && atHome() && near > FLEE_RADIUS * 0.6)) {
        flee();
        return;
      }
    }
    if (spider.mode === "hide" && near < SAFE_DISTANCE) {
      quietSince = performance.now();
    }

    // Drawing near, it stops to face the pointer and follows it round; once
    // the pointer has gone, it waits a moment and moves on.
    if (near < WATCH_RADIUS) {
      if (
        !running &&
        (spider.mode === "walk" ||
          spider.mode === "pause" ||
          (spider.mode === "rest" && !atHome()))
      ) {
        watch();
      } else if (spider.mode === "watch" && !watching) {
        watch();
      } else if (
        spider.mode === "watch" ||
        spider.mode === "rest" ||
        spider.mode === "hide"
      ) {
        // Still, it turns to follow.
        wake();
      }
    } else if (spider.mode === "watch" && watching) {
      watching = false;
      later(WATCH_LINGER, wander);
    } else if (wasNear && (spider.mode === "rest" || spider.mode === "hide")) {
      // The pointer has gone: back to how it rests.
      wake();
    }

    // A hand through a web shakes it.
    let touched = false;
    for (const web of webs) {
      if (web.brush(p.x, p.y, pvx, pvy)) touched = true;
    }
    if (touched) wake();
  }

  function release() {
    pointer.pressed = false;
    if (spider.mode !== "drag") return;
    spider.mode = "dangle";
    // Fling: it leaves with the pointer's speed, bounces on its dragline,
    // hangs a moment and climbs back.
    spider.svx = Math.max(-1600, Math.min(1600, pointer.dragVX));
    spider.svy = Math.max(-1600, Math.min(1600, pointer.dragVY));
    spider.thread = Math.max(
      10,
      Math.hypot(spider.sx - spider.hold.x, spider.sy - spider.hold.y) * 0.85
    );
    spider.threadTarget = spider.thread;
    spider.timer = 1.3;
    wake();
  }

  /**
   * The webs, and the spider resting in the right-hand one; in a moment it
   * comes out for a walk. With reduced motion it simply stays there.
   */
  function appear() {
    appearOnLayout = !total;
    if (appearOnLayout) return;
    clearIdle();
    for (const web of webs) web.reset();
    spider.s = total;
    spider.speed = 0;
    spider.spin = 0;
    spider.body.angle = 0;
    place();
    rig.place(spider.body);
    render();
    spider.mode = "rest";
    if (options.reducedMotion) return;
    later(1.6, wander);
  }

  return {
    attach(elements: BarSpiderElements, spiderOptions: BarSpiderOptions = {}) {
      el = elements;
      options = spiderOptions;
      // With reduced motion nothing follows the pointer.
      if (!options.reducedMotion) {
        window.addEventListener("pointermove", onPointerMove, {
          passive: true
        });
      }
    },
    detach() {
      sleep();
      clearIdle();
      window.removeEventListener("pointermove", onPointerMove);
      el = null;
    },
    sleep,
    /**
     * Where the layer is now. When the bar's width changed, re-spin the
     * corner webs to fit.
     */
    layout(box: { left: number; top: number; width: number }) {
      origin = { left: box.left, top: box.top };
      const nextWidth = box.width;
      // A hidden layer measures 0: keep the last track rather than none.
      if (!nextWidth || nextWidth === width) return;
      const fraction = total ? spider.s / total : 1;
      width = nextWidth;
      webs = [createCornerWeb("left", width), createCornerWeb("right", width)];
      buildTrack();
      spider.s = fraction * total;
      spider.target = Math.min(total, spider.target);
      if (spider.mode !== "drag" && spider.mode !== "dangle") {
        place();
        rig.place(spider.body);
      }
      render();
      if (appearOnLayout) appear();
    },
    /** What on the bar the click target must keep clear of. */
    setObstacles(next: Obstacle[]) {
      obstacles = next;
      render();
    },
    appear,
    /** The webs burst and the spider drops. */
    snap() {
      clearIdle();
      for (const web of webs) web.burst(rand);
      const s = toWorld(spider.body, { x: 0, y: SPINNERETS });
      spider.sx = s.x;
      spider.sy = s.y;
      spider.svx = (rand() - 0.5) * 140;
      spider.svy = -180;
      spider.spin = (rand() < 0.5 ? -1 : 1) * 7;
      spider.mode = "fall";
      wake();
    },
    grab(clientX: number, clientY: number) {
      const p = local(clientX, clientY);
      pointer.pressed = true;
      pointer.downX = p.x;
      pointer.downY = p.y;
      pointer.grabDX = spider.body.x - p.x;
      pointer.grabDY = spider.body.y - p.y;
      pointer.dragged = false;
      pointer.lastDragX = p.x;
      pointer.lastDragY = p.y;
      pointer.lastDragTime = performance.now();
      pointer.dragVX = 0;
      pointer.dragVY = 0;
    },
    /**
     * Lift the spider off the bar on a dragline while the button is held. A
     * move with the button up means the release was never delivered (a
     * right-click's context menu, a release outside the window): let go
     * rather than stay glued to the pointer.
     */
    drag(clientX: number, clientY: number, held = true) {
      if (!pointer.pressed || spider.mode === "fall") return;
      if (!held) {
        release();
        return;
      }
      const p = local(clientX, clientY);
      if (!pointer.dragged) {
        if (Math.hypot(p.x - pointer.downX, p.y - pointer.downY) < 5) return;
        pointer.dragged = true;
        clearIdle();
        // The dragline is tied where the spider was standing.
        if (spider.mode !== "dangle") {
          spider.hold = { x: spider.body.x, y: spider.body.y };
          spider.holdS = spider.s;
        }
        spider.mode = "drag";
      }
      const now = performance.now();
      const dt = Math.max(0.008, (now - pointer.lastDragTime) / 1000);
      pointer.dragVX = (p.x - pointer.lastDragX) / dt;
      pointer.dragVY = (p.y - pointer.lastDragY) / dt;
      pointer.lastDragX = p.x;
      pointer.lastDragY = p.y;
      pointer.lastDragTime = now;

      // However hard you pull, the dragline only pays out so far.
      const h = spider.hold;
      let bx = p.x + pointer.grabDX;
      let by = Math.max(4, p.y + pointer.grabDY);
      const dx = bx - h.x;
      const dy = by - h.y;
      const length = Math.hypot(dx, dy);
      if (length > MAX_PULL) {
        bx = h.x + (dx / length) * MAX_PULL;
        by = h.y + (dy / length) * MAX_PULL;
      }
      spider.body.x = bx;
      spider.body.y = by;
      const angle = Math.atan2(h.x - bx, -(h.y - by));
      spider.body.angle += turn(spider.body.angle, angle) * 0.3;
      const s = toWorld(spider.body, { x: 0, y: SPINNERETS });
      spider.sx = s.x;
      spider.sy = s.y;
      pointer.x = p.x;
      pointer.y = p.y;
      wake();
    },
    release,
    /** Whether the press that just ended was a drag; resets for the next. */
    consumeDrag() {
      const dragged = pointer.dragged;
      pointer.dragged = false;
      return dragged;
    },
    /** For tests: what the spider is doing and where. */
    state() {
      return {
        mode: spider.mode,
        s: spider.s,
        total,
        body: { ...spider.body },
        stepping: rig.stepping(),
        hubs: webs.map((web) => web.hub()),
        hit: hitBox(),
        clickable: clickable(hitBox())
      };
    }
  };
}
