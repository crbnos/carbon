import { describe, expect, it } from "vitest";
import { reduceStreak, type UsageDayInput } from "./streak";

const run = (pattern: string, startDay = 1): UsageDayInput[] =>
  pattern.split("").map((ch, i) => ({
    date: `2026-08-${String(startDay + i).padStart(2, "0")}`,
    qualifying: ch === "x"
  }));

describe("reduceStreak", () => {
  it("starts empty", () => {
    const s = reduceStreak([]);
    expect(s.streak).toBe(0);
    expect(s.daysOnCarbon).toBe(0);
    expect(s.freezesRemaining).toBe(2);
    expect(s.activatedOn).toBeNull();
  });

  it("counts qualifying days", () => {
    const s = reduceStreak(run("xxx"));
    expect(s.streak).toBe(3);
    expect(s.best).toBe(3);
    expect(s.daysOnCarbon).toBe(3);
    expect(s.milestoneDates[3]).toBe("2026-08-03");
  });

  it("a quiet day consumes a freeze and the streak survives", () => {
    const s = reduceStreak(run("xx.xx"));
    expect(s.streak).toBe(4);
    expect(s.freezesRemaining).toBe(1);
    expect(s.freezeDates).toEqual(["2026-08-03"]);
  });

  it("with no freezes left the streak resets — but progress stays", () => {
    const s = reduceStreak(run("xx.x.x.xx"));
    // Freezes absorb days 3 and 5 (streak reaches 4 by day 6); day 7 quiet
    // resets; then two more qualifying days rebuild to 2.
    expect(s.freezesRemaining).toBe(0);
    expect(s.streak).toBe(2);
    expect(s.best).toBe(4);
    expect(s.daysOnCarbon).toBe(6); // qualifying days never un-count
  });

  it("quiet days before the streak starts don't burn freezes", () => {
    const s = reduceStreak(run("..xx"));
    expect(s.freezesRemaining).toBe(2);
    expect(s.streak).toBe(2);
  });

  it("milestones stay reached after a reset", () => {
    const s = reduceStreak(run("xxxxx...x"));
    expect(s.milestoneDates[3]).toBe("2026-08-03");
    expect(s.milestoneDates[5]).toBe("2026-08-05");
    expect(s.streak).toBe(1); // two freezes burned, third quiet day reset
    expect(s.milestoneDates[10]).toBeUndefined();
  });

  it("ten straight qualifying business days = activated", () => {
    const s = reduceStreak(run("xxxxxxxxxx"));
    expect(s.activatedOn).toBe("2026-08-10");
    expect(s.milestoneDates[10]).toBe("2026-08-10");
  });

  it("freezes count toward the ten only by not resetting — activation still needs ten qualifying days", () => {
    const s = reduceStreak(run("xxxxx.xxxxx"));
    expect(s.freezesRemaining).toBe(1);
    expect(s.streak).toBe(10);
    expect(s.activatedOn).toBe("2026-08-11");
  });

  it("is order-insensitive (recompute from scratch)", () => {
    const days = run("xx.xx");
    const shuffled = [days[3]!, days[0]!, days[4]!, days[2]!, days[1]!];
    expect(reduceStreak(shuffled)).toEqual(reduceStreak(days));
  });
});
