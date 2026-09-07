/**
 * The engine's decision rules, tested without a database.
 *
 * These are the four places a bug would be invisible in the UI but wrong in the
 * data: what counts as the next exam question, how an attempt scores, when an
 * attempt must be voided, and when the exam is allowed to start at all.
 */

import { describe, expect, it } from "vitest";
import {
  canStartExam,
  isExpectedExamQuestion,
  nextExamQuestion,
  scoreAttempt,
  shouldVoid
} from "./engine.server";
import { isWithinRenewalWindow, LEARN_CONTENT_VERSION } from "./gamify";

describe("shouldVoid", () => {
  it("passes an attempt served by the current content version", () => {
    expect(shouldVoid(LEARN_CONTENT_VERSION)).toBe(false);
  });

  it("voids an attempt whose bank has since changed", () => {
    expect(shouldVoid("2020.01.1")).toBe(true);
  });
});

describe("nextExamQuestion", () => {
  const form = ["q1", "q2", "q3"];

  it("serves the first question when nothing is answered", () => {
    expect(nextExamQuestion(form, [])).toEqual({ slug: "q1", index: 0 });
  });

  it("advances strictly in order", () => {
    expect(nextExamQuestion(form, ["q1"])).toEqual({ slug: "q2", index: 1 });
    expect(nextExamQuestion(form, ["q1", "q2"])).toEqual({
      slug: "q3",
      index: 2
    });
  });

  it("returns null once the form is complete", () => {
    expect(nextExamQuestion(form, ["q1", "q2", "q3"])).toBeNull();
  });
});

describe("isExpectedExamQuestion", () => {
  const form = ["q1", "q2", "q3"];

  it("accepts the next question", () => {
    expect(isExpectedExamQuestion(form, ["q1"], "q2")).toBe(true);
  });

  it("rejects going back to an answered question", () => {
    expect(isExpectedExamQuestion(form, ["q1"], "q1")).toBe(false);
  });

  it("rejects skipping ahead", () => {
    expect(isExpectedExamQuestion(form, ["q1"], "q3")).toBe(false);
  });

  it("rejects anything once the form is complete", () => {
    expect(isExpectedExamQuestion(form, form, "q3")).toBe(false);
  });
});

describe("scoreAttempt", () => {
  it("passes at exactly the 80% bar", () => {
    expect(scoreAttempt(24, 30)).toEqual({ ratio: 0.8, passed: true });
  });

  it("fails just below it", () => {
    const { passed } = scoreAttempt(23, 30);
    expect(passed).toBe(false);
  });

  it("treats an empty form as a fail rather than a divide by zero", () => {
    expect(scoreAttempt(0, 0)).toEqual({ ratio: 0, passed: false });
  });
});

describe("canStartExam", () => {
  const base = {
    requiredChallengeSlugs: ["c1", "c2"],
    passedChallengeSlugs: ["c1", "c2"],
    failedExamSubmittedAt: [] as string[],
    now: "2026-09-06T12:00:00.000Z"
  };

  it("allows a first sitting once the challenges are done", () => {
    expect(canStartExam(base)).toEqual({ ok: true });
  });

  it("blocks and names the missing challenges", () => {
    const result = canStartExam({ ...base, passedChallengeSlugs: ["c1"] });
    expect(result).toEqual({
      ok: false,
      reason: "challenges",
      missing: ["c2"]
    });
  });

  it("blocks for 24 hours after the first failure", () => {
    const result = canStartExam({
      ...base,
      failedExamSubmittedAt: ["2026-09-06T06:00:00.000Z"]
    });
    expect(result).toEqual({
      ok: false,
      reason: "cooldown",
      until: "2026-09-07T06:00:00.000Z"
    });
  });

  it("allows a retry once the cooldown has elapsed", () => {
    expect(
      canStartExam({
        ...base,
        failedExamSubmittedAt: ["2026-09-04T06:00:00.000Z"]
      })
    ).toEqual({ ok: true });
  });

  it("escalates to 7 days after a second failure", () => {
    const result = canStartExam({
      ...base,
      failedExamSubmittedAt: [
        "2026-09-01T06:00:00.000Z",
        "2026-09-05T06:00:00.000Z"
      ]
    });
    expect(result).toEqual({
      ok: false,
      reason: "cooldown",
      until: "2026-09-12T06:00:00.000Z"
    });
  });

  it("checks challenges before the cooldown", () => {
    const result = canStartExam({
      ...base,
      passedChallengeSlugs: [],
      failedExamSubmittedAt: ["2026-09-06T06:00:00.000Z"]
    });
    expect(result).toMatchObject({ reason: "challenges" });
  });
});

describe("isWithinRenewalWindow", () => {
  it("is closed more than 30 days out", () => {
    expect(
      isWithinRenewalWindow(
        "2026-12-01T00:00:00.000Z",
        "2026-09-06T00:00:00.000Z"
      )
    ).toBe(false);
  });

  it("opens inside the last 30 days", () => {
    expect(
      isWithinRenewalWindow(
        "2026-09-20T00:00:00.000Z",
        "2026-09-06T00:00:00.000Z"
      )
    ).toBe(true);
  });

  it("stays open after expiry so a lapsed holder can still renew", () => {
    expect(
      isWithinRenewalWindow(
        "2026-09-01T00:00:00.000Z",
        "2026-09-06T00:00:00.000Z"
      )
    ).toBe(true);
  });
});
