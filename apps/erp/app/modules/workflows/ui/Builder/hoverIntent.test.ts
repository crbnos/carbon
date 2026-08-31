import { describe, expect, it } from "vitest";
import { createHoverIntent } from "./hoverIntent";

/** A hand-driven clock, so the timing is asserted rather than slept through. */
function harness() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const events: string[] = [];

  const intent = createHoverIntent({
    openDelayMs: 1000,
    closeDelayMs: 220,
    onOpen: () => events.push("open"),
    onClose: () => events.push("close"),
    setTimer: (fn, ms) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => timers.delete(id)
  });

  return {
    intent,
    events,
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    }
  };
}

describe("output popover hover intent", () => {
  it("opens only after the hover delay", () => {
    const h = harness();
    h.intent.enter();
    h.advance(999);
    expect(h.events).toEqual([]);
    h.advance(1);
    expect(h.events).toEqual(["open"]);
  });

  it("does not open when the pointer passes straight through", () => {
    const h = harness();
    h.intent.enter();
    h.advance(300);
    h.intent.leave();
    h.advance(2000);
    expect(h.events).toEqual([]);
  });

  // The reported bug: the panel is offset from the handle, so the pointer crosses a
  // gap. Closing on mouse-leave dismissed it mid-journey and it could never be reached.
  it("survives the gap between the handle and the panel", () => {
    const h = harness();
    h.intent.enter();
    h.advance(1000);
    expect(h.events).toEqual(["open"]);

    h.intent.leave(); // left the handle, now over the gap
    h.advance(120); // still travelling — under the grace period
    h.intent.enter(); // arrived at the panel
    h.advance(5000); // and stays as long as the pointer is on it

    expect(h.events).toEqual(["open"]);
    expect(h.intent.isOpen()).toBe(true);
  });

  it("closes once the pointer really leaves", () => {
    const h = harness();
    h.intent.enter();
    h.advance(1000);
    h.intent.leave();
    h.advance(219);
    expect(h.events).toEqual(["open"]);
    h.advance(1);
    expect(h.events).toEqual(["open", "close"]);
  });

  // Crossing onto the panel must not re-time: re-running the open delay would
  // recompute a preview that is already on screen.
  it("does not reopen or re-time while already showing", () => {
    const h = harness();
    h.intent.enter();
    h.advance(1000);
    h.intent.leave();
    h.advance(100);
    h.intent.enter();
    h.advance(5000);
    expect(h.events).toEqual(["open"]);
  });

  it("dismisses immediately on a drag or click", () => {
    const h = harness();
    h.intent.enter();
    h.advance(1000);
    h.intent.dismiss();
    expect(h.events).toEqual(["open", "close"]);
    expect(h.intent.isOpen()).toBe(false);
  });

  it("a dismiss cancels a hover that had not opened yet", () => {
    const h = harness();
    h.intent.enter();
    h.advance(500);
    h.intent.dismiss();
    h.advance(5000);
    // One close from the dismiss, and the pending open never fires.
    expect(h.events).toEqual(["close"]);
  });
});
