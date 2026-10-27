// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BarSpiderElements, Obstacle } from "./bar-spider";
import { createBarSpider, HIT_SIZE } from "./bar-spider";
import { BAR_HEIGHT } from "./corner-web";

// The spider lives on the top bar all day: it has to keep to the bar, never
// take a click meant for something on it, never stick to the pointer, and let
// the page sleep when it rests. The browser's frame and timer clocks, and its
// pointer events, are the boundary.

const WIDTH = 1200;
// A bar like the real one: breadcrumbs on the left, buttons on the right.
const BAR: Obstacle[] = [
  { left: 16, top: 15, right: 40, bottom: 34 },
  { left: 48, top: 16, right: 220, bottom: 33 },
  ...[0, 1, 2, 3, 4].map((i) => ({
    left: WIDTH - 210 + i * 40,
    top: 8.5,
    right: WIDTH - 178 + i * 40,
    bottom: 40.5
  }))
];

type FakeElement = {
  attrs: Map<string, string>;
  style: Record<string, string>;
  setAttribute: (name: string, value: string) => void;
  getBoundingClientRect: () => { left: number; top: number };
};

function fakeElement(): FakeElement {
  const attrs = new Map<string, string>();
  return {
    attrs,
    style: {},
    setAttribute: (name, value) => attrs.set(name, String(value)),
    getBoundingClientRect: () => ({ left: 0, top: 0 })
  };
}

const frames = new Map<number, FrameRequestCallback>();
// Timers fire when they fall due, as in a browser.
const timers = new Map<number, { due: number; fire: () => void }>();
let pointerMove: ((event: Partial<PointerEvent>) => void) | null = null;
let nextId = 1;
let now = 0;

function fireDue() {
  for (const [id, timer] of [...timers.entries()].sort(
    (a, b) => a[1].due - b[1].due
  )) {
    if (timer.due > now) break;
    timers.delete(id);
    timer.fire();
  }
}

function step() {
  now += 1000 / 60;
  fireDue();
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(now);
}

/** Run for a while; whenever the loop sleeps, skip ahead to the next timer. */
function live(seconds: number, each?: () => void) {
  const end = now + seconds * 1000;
  while (now < end) {
    if (frames.size === 0) {
      const next = Math.min(...[...timers.values()].map((t) => t.due));
      if (!Number.isFinite(next) || next > end) {
        now = end;
        return;
      }
      now = Math.max(now, next);
      fireDue();
      continue;
    }
    step();
    each?.();
  }
}

function moveTo(x: number, y: number) {
  now += 16;
  pointerMove?.({ clientX: x, clientY: y, timeStamp: now });
}

function setup(options = {}, width = WIDTH) {
  const sim = createBarSpider();
  const web = () => ({
    spokes: fakeElement(),
    rings: fakeElement(),
    torn: fakeElement()
  });
  const el = {
    svg: fakeElement(),
    webs: [web(), web()],
    dragline: fakeElement(),
    body: fakeElement(),
    femurs: fakeElement(),
    tibiae: fakeElement(),
    tarsi: fakeElement(),
    joints: fakeElement(),
    bristles: fakeElement(),
    button: fakeElement()
  };
  sim.attach(el as unknown as BarSpiderElements, options);
  sim.layout({ left: 0, top: 0, width });
  sim.setObstacles(BAR);
  return { sim, el };
}

beforeEach(() => {
  frames.clear();
  timers.clear();
  pointerMove = null;
  now = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.stubGlobal("window", {
    setTimeout: (callback: () => void, ms = 0) => {
      const id = nextId++;
      timers.set(id, { due: now + ms, fire: callback });
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
    addEventListener: (_: string, listener: typeof pointerMove) => {
      pointerMove = listener;
    },
    removeEventListener: vi.fn()
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const overlaps = (a: Obstacle, b: Obstacle) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

// Each test simulates minutes of the spider's life frame by frame; well under
// a second on a quiet machine, several on a loaded CI runner.
describe("createBarSpider", { timeout: 30_000 }, () => {
  it("crawls out of its web and along the bar, and never takes a click meant for the bar", () => {
    const { sim, el } = setup();
    sim.appear();
    expect(sim.state().mode).toBe("rest");

    let lowest = 0;
    let travelled = 0;
    let clickableSomewhere = false;
    let previous = sim.state().body.x;
    // Three simulated minutes is ~11k frames: note the first frame that breaks
    // a rule and assert once, since an expect per frame is what made this
    // test slow enough to time out on a loaded CI runner.
    let firstBreak: { frame: number; rule: string; hit: Obstacle } | null =
      null;
    let frame = 0;
    live(180, () => {
      frame++;
      const state = sim.state();
      travelled += Math.abs(state.body.x - previous);
      previous = state.body.x;
      lowest = Math.max(lowest, state.body.y);
      if (firstBreak) return;
      const takesClicks = el.button.style.pointerEvents === "auto";
      if (takesClicks) {
        clickableSomewhere = true;
        // Whenever it takes clicks, nothing on the bar is under it...
        if (BAR.some((thing) => overlaps(state.hit, thing))) {
          firstBreak = {
            frame,
            rule: "clickable over the bar",
            hit: { ...state.hit }
          };
        }
      }
      // ...and its target never leaves the bar.
      if (state.hit.top < 0 || state.hit.top + HIT_SIZE > BAR_HEIGHT) {
        firstBreak = {
          frame,
          rule: "target off the bar",
          hit: { ...state.hit }
        };
      }
    });
    expect(firstBreak).toBeNull();
    // It wandered well along the bar, keeping to it, and could be clicked
    // out in the open.
    expect(travelled).toBeGreaterThan(300);
    expect(lowest).toBeLessThan(BAR_HEIGHT);
    expect(clickableSomewhere).toBe(true);
  });

  it("runs for a web when the pointer comes close, then comes back out once it is quiet", () => {
    const { sim } = setup();
    sim.appear();
    // Out on the bar, somewhere in the open.
    live(30, () => undefined);
    for (let tries = 0; tries < 20 && sim.state().mode === "rest"; tries++)
      live(5);
    const { body } = sim.state();

    moveTo(body.x + 20, body.y);
    live(12, () => {
      if (sim.state().mode !== "hide") moveTo(sim.state().body.x + 20, body.y);
    });
    const hiding = sim.state();
    expect(hiding.mode).toBe("hide");
    // Ran away from the pointer, into the left-hand web.
    const [leftHub] = hiding.hubs;
    if (!leftHub) throw new Error("no left-hand web");
    expect(
      Math.hypot(hiding.body.x - leftHub.x, hiding.body.y - leftHub.y)
    ).toBeLessThan(1);

    // While it waits, its look round every second costs no frames.
    live(2);
    let frames = 0;
    live(4, () => {
      frames++;
    });
    expect(frames).toBe(0);

    moveTo(WIDTH / 2, 400);
    let outAgain = false;
    live(20, () => {
      if (sim.state().mode === "walk") outAgain = true;
    });
    expect(outAgain).toBe(true);
  });

  it("stops and turns to face a pointer drawing near, follows it, then moves on once it has gone", () => {
    const { sim } = setup();
    sim.appear();
    // Out on the bar, walking.
    live(30);
    for (let tries = 0; tries < 40 && sim.state().mode !== "walk"; tries++)
      live(1);
    expect(sim.state().mode).toBe("walk");

    // Closer than it would watch from, not so close it runs.
    const facing = (dx: number, dy: number) => Math.atan2(-dx, dy);
    const angleTo = (x: number, y: number) => {
      const { body } = sim.state();
      return facing(x - body.x, y - body.y);
    };
    const off = (a: number, b: number) =>
      Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    let { body } = sim.state();
    moveTo(body.x + 70, body.y - 60);
    expect(sim.state().mode).toBe("watch");
    live(2);
    expect(
      off(sim.state().body.angle, angleTo(body.x + 70, body.y - 60))
    ).toBeLessThan(0.02);
    // Facing a still pointer, it lets the page sleep.
    expect(frames.size).toBe(0);

    // It follows the pointer round to its other side.
    ({ body } = sim.state());
    moveTo(body.x - 80, body.y - 40);
    live(2);
    expect(sim.state().mode).toBe("watch");
    expect(
      off(sim.state().body.angle, angleTo(body.x - 80, body.y - 40))
    ).toBeLessThan(0.02);

    // The pointer goes; after a moment it walks on.
    moveTo(body.x, 900);
    let walkedOn = false;
    live(4, () => {
      if (sim.state().mode === "walk") walkedOn = true;
    });
    expect(walkedOn).toBe(true);
  });

  it("lets go when the release never arrives, instead of sticking to the pointer", () => {
    const { sim } = setup();
    sim.appear();
    live(10);
    const { body } = sim.state();

    sim.grab(body.x, body.y);
    sim.drag(body.x - 10, body.y + 60);
    expect(sim.state().mode).toBe("drag");
    sim.drag(body.x - 12, body.y + 70, false);
    // Hovering about afterwards must not pick the spider up again.
    sim.drag(body.x + 120, body.y + 90);
    expect(sim.state().mode).not.toBe("drag");

    let backOnTheBar = false;
    live(12, () => {
      if (sim.state().body.y < BAR_HEIGHT && sim.state().mode !== "dangle") {
        backOnTheBar = true;
      }
    });
    expect(backOnTheBar).toBe(true);
  });

  it("waits while the bar has no width (hidden below md), then appears once it has one", () => {
    const { sim } = setup({}, 0);
    sim.appear();
    moveTo(20, 20);
    live(5);
    expect(sim.state().total).toBe(0);

    sim.layout({ left: 0, top: 0, width: WIDTH });
    const { mode, s, total } = sim.state();
    expect(total).toBeGreaterThan(0);
    expect(mode).toBe("rest");
    expect(s).toBe(total);
  });

  it("lets the page sleep while it rests", () => {
    const { sim } = setup();
    sim.appear();
    let slept = false;
    live(120, () => {
      if (frames.size === 0) slept = true;
    });
    expect(slept).toBe(true);
  });

  it("stays asleep after the snap while the pointer sweeps the broken webs", () => {
    const { sim } = setup();
    sim.appear();
    live(5);
    sim.snap();
    live(1);
    sim.sleep();
    for (const hub of sim.state().hubs) {
      for (let dx = -60; dx <= 60; dx += 6) moveTo(hub.x + dx, hub.y);
    }
    live(5);
    expect(frames.size).toBe(0);
  });

  it("with reduced motion it simply stays in its web", () => {
    const { sim } = setup({ reducedMotion: true });
    sim.appear();
    expect(frames.size).toBe(0);
    expect(timers.size).toBe(0);
    expect(sim.state().mode).toBe("rest");
  });

  it("a press that stays put is a click, not a drag", () => {
    const { sim } = setup();
    sim.appear();
    sim.grab(100, 100);
    sim.drag(102, 101);
    sim.release();
    expect(sim.consumeDrag()).toBe(false);
  });

  it("stops every frame and timer on detach", () => {
    const { sim } = setup();
    sim.appear();
    live(5);
    sim.detach();
    expect(frames.size).toBe(0);
    expect(timers.size).toBe(0);
  });
});
