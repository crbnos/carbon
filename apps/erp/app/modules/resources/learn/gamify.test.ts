import { describe, expect, it } from "vitest";
import {
  drawStratifiedForm,
  examCooldownEnd,
  heatmapBucket,
  levelForXp,
  quizXpForPassAttempt,
  seededShuffle,
  weeklyStreak,
  xpForLevel
} from "./gamify";

describe("xpForLevel / levelForXp", () => {
  it("uses the quadratic curve from the spec", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(500);
    expect(xpForLevel(3)).toBe(1500);
    expect(xpForLevel(4)).toBe(3000);
  });

  it("puts one full track around level 4", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(499)).toBe(1);
    expect(levelForXp(500)).toBe(2);
    expect(levelForXp(3600)).toBe(4);
  });
});

describe("quizXpForPassAttempt", () => {
  it("decays 100 / 50 / 25 and floors at 25", () => {
    expect(quizXpForPassAttempt(1)).toBe(100);
    expect(quizXpForPassAttempt(2)).toBe(50);
    expect(quizXpForPassAttempt(3)).toBe(25);
    expect(quizXpForPassAttempt(9)).toBe(25);
  });
});

describe("heatmapBucket", () => {
  it("maps daily XP onto five intensities", () => {
    expect(heatmapBucket(0)).toBe(0);
    expect(heatmapBucket(99)).toBe(1);
    expect(heatmapBucket(100)).toBe(2);
    expect(heatmapBucket(499)).toBe(3);
    expect(heatmapBucket(500)).toBe(4);
  });
});

describe("examCooldownEnd", () => {
  it("is null when nothing has failed", () => {
    expect(examCooldownEnd([])).toBeNull();
  });

  it("is 24 hours after a single failure", () => {
    expect(examCooldownEnd(["2026-09-01T10:00:00.000Z"])).toBe(
      "2026-09-02T10:00:00.000Z"
    );
  });

  it("is 7 days after the most recent of several failures", () => {
    expect(
      examCooldownEnd(["2026-09-01T10:00:00.000Z", "2026-09-03T10:00:00.000Z"])
    ).toBe("2026-09-10T10:00:00.000Z");
  });
});

describe("weeklyStreak", () => {
  const goal = 200;

  it("counts consecutive met weeks", () => {
    const weeks = { "2026-08-31": 250, "2026-08-24": 300 };
    expect(weeklyStreak(weeks, goal, "2026-08-31")).toBe(2);
  });

  it("does not break on an unmet CURRENT week", () => {
    const weeks = { "2026-08-31": 10, "2026-08-24": 300, "2026-08-17": 250 };
    expect(weeklyStreak(weeks, goal, "2026-08-31")).toBe(2);
  });

  it("resets when a previous week was missed", () => {
    const weeks = { "2026-08-31": 250, "2026-08-24": 0, "2026-08-17": 900 };
    expect(weeklyStreak(weeks, goal, "2026-08-31")).toBe(1);
  });

  it("is zero for a learner who has never met the goal", () => {
    expect(weeklyStreak({ "2026-08-31": 50 }, goal, "2026-08-31")).toBe(0);
  });
});

describe("seededShuffle", () => {
  it("is deterministic for a seed and keeps every element", () => {
    const items = ["a", "b", "c", "d", "e"];
    const first = seededShuffle(items, "seed-1");
    expect(seededShuffle(items, "seed-1")).toEqual(first);
    expect([...first].sort()).toEqual(items);
  });
});

describe("drawStratifiedForm", () => {
  const pool = [
    ...Array.from({ length: 10 }, (_, i) => ({
      slug: `o${i}`,
      topic: "orders"
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      slug: `r${i}`,
      topic: "receiving"
    }))
  ];
  const blueprint = [
    { topic: "orders", count: 4 },
    { topic: "receiving", count: 3 }
  ];

  it("draws exactly the blueprint counts per topic", () => {
    const form = drawStratifiedForm(pool, blueprint, "attempt-1");
    expect(form).toHaveLength(7);
    expect(form.filter((s) => s.startsWith("o"))).toHaveLength(4);
    expect(form.filter((s) => s.startsWith("r"))).toHaveLength(3);
    expect(new Set(form).size).toBe(7);
  });

  it("is deterministic for a seed", () => {
    expect(drawStratifiedForm(pool, blueprint, "x")).toEqual(
      drawStratifiedForm(pool, blueprint, "x")
    );
  });

  it("prefers questions the learner has not just seen", () => {
    const exclude = new Set(["o0", "o1", "o2", "o3", "o4", "o5"]);
    const form = drawStratifiedForm(pool, blueprint, "retake", exclude);
    const orders = form.filter((s) => s.startsWith("o"));
    expect(orders.every((slug) => !exclude.has(slug))).toBe(true);
  });

  it("refuses to draw a short form", () => {
    expect(() =>
      drawStratifiedForm(pool, [{ topic: "orders", count: 99 }], "s")
    ).toThrow(/needs 99 questions/);
  });
});
