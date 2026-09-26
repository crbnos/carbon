import { describe, expect, it } from "vitest";
import {
  evaluateFirstArticleDue,
  type FirstArticleNeedInput,
  resolveFirstArticleNeeds
} from "./first-article";

const TODAY = "2026-09-25";

type MakeMethod = FirstArticleNeedInput["makeMethods"][number];

function makeMethod(overrides: Partial<MakeMethod> = {}): MakeMethod {
  return {
    jobMakeMethodId: "jmm1",
    itemId: "item1",
    description: "P-1001 Rev B",
    firstArticlePlanId: null,
    partPlanIds: ["plan-part"],
    latestApprovedAt: null,
    lastCompletedJobDate: null,
    hasFirstArticleLot: false,
    ...overrides
  };
}

function need(
  overrides: Partial<MakeMethod> = {},
  switches: Partial<
    Pick<
      FirstArticleNeedInput,
      "companyRequiresFirstArticle" | "customerRequiresFirstArticle"
    >
  > = { companyRequiresFirstArticle: true }
) {
  const [result] = resolveFirstArticleNeeds({
    companyRequiresFirstArticle: false,
    customerRequiresFirstArticle: false,
    today: TODAY,
    ...switches,
    makeMethods: [makeMethod(overrides)]
  });
  return result!;
}

describe("evaluateFirstArticleDue", () => {
  it("is due as New Part when nothing was ever approved", () => {
    expect(
      evaluateFirstArticleDue({
        latestApprovedAt: null,
        lastCompletedJobDate: "2026-01-01",
        today: TODAY
      })
    ).toEqual({ due: true, reason: "New Part" });
  });

  it("is not due when approved recently", () => {
    expect(
      evaluateFirstArticleDue({
        latestApprovedAt: "2026-03-01T10:00:00+00:00",
        lastCompletedJobDate: "2026-06-01",
        today: TODAY
      })
    ).toEqual({ due: false, reason: null });
  });

  it("is due as Production Lapse after 25 months without a completed job", () => {
    expect(
      evaluateFirstArticleDue({
        latestApprovedAt: "2024-01-15T10:00:00+00:00",
        lastCompletedJobDate: "2024-08-25",
        today: TODAY
      })
    ).toEqual({ due: true, reason: "Production Lapse" });
  });

  it("is not due when an FAI was approved after the lapse", () => {
    expect(
      evaluateFirstArticleDue({
        latestApprovedAt: "2026-02-01T10:00:00+00:00",
        lastCompletedJobDate: "2023-08-25",
        today: TODAY
      })
    ).toEqual({ due: false, reason: null });
  });

  it("is not due at exactly two years", () => {
    expect(
      evaluateFirstArticleDue({
        latestApprovedAt: "2024-01-15T10:00:00+00:00",
        lastCompletedJobDate: "2024-09-25",
        today: TODAY
      }).due
    ).toBe(false);
  });
});

describe("resolveFirstArticleNeeds", () => {
  it("requires nothing when every switch is off", () => {
    const result = need({}, {});
    expect(result.required).toBe(false);
    expect(result.create).toBe(false);
    expect(result.blocked).toBe(false);
  });

  it("creates when the company requires it and nothing was approved", () => {
    const result = need();
    expect(result).toMatchObject({
      required: true,
      due: true,
      reason: "New Part",
      planId: "plan-part",
      create: true,
      blocked: false
    });
  });

  it("requires it when the customer does", () => {
    expect(need({}, { customerRequiresFirstArticle: true }).create).toBe(true);
  });

  it("requires it when the part has a First Article plan, and that plan supersedes two part plans", () => {
    const result = need(
      { firstArticlePlanId: "plan-fa", partPlanIds: ["plan-a", "plan-b"] },
      {}
    );
    expect(result).toMatchObject({
      required: true,
      planId: "plan-fa",
      create: true,
      blocked: false
    });
  });

  it("uses the part's only plan", () => {
    expect(need({ partPlanIds: ["plan-only"] }).planId).toBe("plan-only");
  });

  it("blocks with no plan and no First Article slot", () => {
    expect(need({ partPlanIds: [] })).toMatchObject({
      planId: null,
      blocked: true,
      create: false
    });
  });

  it("blocks with two part plans and no First Article slot", () => {
    expect(need({ partPlanIds: ["plan-a", "plan-b"] })).toMatchObject({
      planId: null,
      blocked: true,
      create: false
    });
  });

  it("neither creates nor blocks when recently approved", () => {
    const result = need({
      partPlanIds: [],
      latestApprovedAt: "2026-03-01T10:00:00+00:00",
      lastCompletedJobDate: "2026-06-01"
    });
    expect(result).toMatchObject({
      due: false,
      create: false,
      blocked: false
    });
  });

  it("creates with Production Lapse after 25 months", () => {
    expect(
      need({
        latestApprovedAt: "2024-01-15T10:00:00+00:00",
        lastCompletedJobDate: "2024-08-25"
      })
    ).toMatchObject({ due: true, reason: "Production Lapse", create: true });
  });

  it("neither creates nor blocks when the job already has a First Article lot", () => {
    expect(need({ hasFirstArticleLot: true })).toMatchObject({
      required: true,
      due: true,
      create: false,
      blocked: false
    });
    expect(need({ hasFirstArticleLot: true, partPlanIds: [] })).toMatchObject({
      create: false,
      blocked: false
    });
  });

  it("evaluates every make method independently", () => {
    const result = resolveFirstArticleNeeds({
      companyRequiresFirstArticle: true,
      customerRequiresFirstArticle: false,
      today: TODAY,
      makeMethods: [
        makeMethod({ jobMakeMethodId: "root" }),
        makeMethod({ jobMakeMethodId: "sub", partPlanIds: [] })
      ]
    });
    expect(result.map((r) => [r.jobMakeMethodId, r.create, r.blocked])).toEqual(
      [
        ["root", true, false],
        ["sub", false, true]
      ]
    );
  });
});
