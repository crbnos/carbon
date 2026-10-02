import { describe, expect, it } from "vitest";
import {
  analyzeDelay,
  canViewDelayModule,
  redactDelay,
  type DelayLink,
  type DelayNode
} from "../app/modules/production/delay";

function node(
  partial: Pick<DelayNode, "id" | "kind"> & Partial<DelayNode>
): DelayNode {
  return {
    planned: null,
    actual: null,
    ...partial
  };
}

function why(nodes: DelayNode[], links: DelayLink[], targetId: string) {
  return analyzeDelay({ nodes, links, mode: "why", targetId });
}

describe("analyzeDelay", () => {
  it("does not blame a purchase order whose lateness fits in the slack", () => {
    const result = why(
      [
        node({
          id: "po",
          kind: "supply",
          label: "PO0001",
          planned: "2026-01-01",
          actual: "2026-01-04"
        }),
        node({
          id: "job",
          kind: "job",
          label: "JOB0001",
          planned: "2026-01-06",
          actual: "2026-01-06"
        })
      ],
      [{ from: "po", to: "job", recorded: false }],
      "job"
    );
    expect(result).toEqual({
      reports: [
        expect.objectContaining({
          lateDays: 0,
          causes: [],
          absorbed: [
            expect.objectContaining({ class: "late_supply", days: 3, label: "PO0001" })
          ]
        })
      ]
    });
  });

  it("counts only the days a late purchase order pushes past the slack", () => {
    const result = why(
      [
        node({
          id: "po",
          kind: "supply",
          label: "PO0001",
          planned: "2026-01-01",
          actual: "2026-01-08"
        }),
        node({
          id: "job",
          kind: "job",
          planned: "2026-01-06",
          actual: "2026-01-08"
        })
      ],
      [{ from: "po", to: "job", recorded: false }],
      "job"
    );
    expect(result.reports[0]?.lateDays).toBe(2);
    expect(result.reports[0]?.causes).toEqual([
      expect.objectContaining({ class: "late_supply", days: 2 })
    ]);
    expect(result.reports[0]?.absorbed).toEqual([]);
  });

  it("leaves out a late record that is not upstream", () => {
    const result = why(
      [
        node({
          id: "po",
          kind: "supply",
          label: "PO0001",
          planned: "2026-01-01",
          actual: "2026-01-08"
        }),
        node({
          id: "other",
          kind: "supply",
          label: "PO9999",
          planned: "2026-01-01",
          actual: "2026-01-20"
        }),
        node({
          id: "job",
          kind: "job",
          planned: "2026-01-06",
          actual: "2026-01-08"
        })
      ],
      [{ from: "po", to: "job", recorded: false }],
      "job"
    );
    const text = JSON.stringify(result);
    expect(text).not.toContain("PO9999");
    expect(result.reports[0]?.causes).toHaveLength(1);
  });

  it("lists concurrent causes separately without adding their days", () => {
    const result = why(
      [
        node({
          id: "a",
          kind: "supply",
          label: "PO-A",
          planned: "2026-01-01",
          actual: "2026-01-04"
        }),
        node({
          id: "b",
          kind: "supply",
          label: "PO-B",
          planned: "2026-01-01",
          actual: "2026-01-04"
        }),
        node({
          id: "job",
          kind: "job",
          planned: "2026-01-01",
          actual: "2026-01-04"
        })
      ],
      [
        { from: "a", to: "job", recorded: false },
        { from: "b", to: "job", recorded: false }
      ],
      "job"
    );
    expect(result.reports[0]?.lateDays).toBe(3);
    expect(result.reports[0]?.causes.map((cause) => cause.days)).toEqual([3, 3]);
  });

  it("stacks a late supply and an operation that ran long", () => {
    const result = why(
      [
        node({
          id: "po",
          kind: "supply",
          planned: "2026-01-01",
          actual: "2026-01-03"
        }),
        node({
          id: "op",
          kind: "operation",
          label: "Machining",
          plannedStart: "2026-01-01",
          planned: "2026-01-03",
          actual: "2026-01-07",
          ranLongDays: 2
        }),
        node({
          id: "job",
          kind: "job",
          planned: "2026-01-03",
          actual: "2026-01-07"
        })
      ],
      [
        { from: "po", to: "op", recorded: false },
        { from: "op", to: "job", recorded: true }
      ],
      "job"
    );
    expect(result.reports[0]?.lateDays).toBe(4);
    expect(result.reports[0]?.causes).toEqual([
      expect.objectContaining({ class: "late_supply", days: 2 }),
      expect.objectContaining({
        class: "ran_long",
        days: 2,
        steps: [
          expect.objectContaining({ kind: "operation", label: "Machining" }),
          expect.objectContaining({ kind: "job", recorded: true })
        ]
      })
    ]);
  });

  it("reports a successor planned before the record it depends on", () => {
    const result = why(
      [
        node({
          id: "op",
          kind: "operation",
          label: "Machining",
          planned: "2026-01-10",
          actual: "2026-01-10"
        }),
        node({
          id: "line",
          kind: "salesLine",
          label: "SO0001",
          planned: "2026-01-08",
          actual: "2026-01-10"
        })
      ],
      [{ from: "op", to: "line", recorded: true }],
      "line"
    );
    expect(result.reports[0]?.lateDays).toBe(2);
    expect(result.reports[0]?.causes).toEqual([]);
    expect(result.reports[0]?.gaps).toEqual([
      expect.objectContaining({
        days: 2,
        recorded: true,
        from: expect.objectContaining({ label: "Machining" }),
        to: expect.objectContaining({ label: "SO0001" })
      })
    ]);
  });

  it("names one link when the graph cycles", () => {
    const result = why(
      [
        node({ id: "a", kind: "operation", label: "A", planned: "2026-01-01", actual: "2026-01-02" }),
        node({ id: "b", kind: "operation", label: "B", planned: "2026-01-01", actual: "2026-01-02" })
      ],
      [
        { from: "a", to: "b", recorded: true },
        { from: "b", to: "a", recorded: true }
      ],
      "a"
    );
    expect(result.reports).toEqual([]);
    expect("cycle" in result).toBe(true);
    if (!("cycle" in result)) return;
    expect(
      [result.cycle.from.label, result.cycle.to.label].sort()
    ).toEqual(["A", "B"]);
  });

  it("tells outside processing apart from purchased material", () => {
    const result = why(
      [
        node({
          id: "po",
          kind: "outside",
          planned: "2026-01-01",
          actual: "2026-01-04"
        }),
        node({
          id: "job",
          kind: "job",
          planned: "2026-01-01",
          actual: "2026-01-04"
        })
      ],
      [{ from: "po", to: "job", recorded: true }],
      "job"
    );
    expect(result.reports[0]?.causes[0]?.class).toBe("outside_processing");
    expect(result.reports[0]?.causes[0]?.steps[1]?.recorded).toBe(true);
  });

  it("holds a quality delay that the schedule had room for", () => {
    const result = why(
      [
        node({
          id: "ncr",
          kind: "quality",
          label: "NCR0001",
          planned: "2026-01-01",
          actual: "2026-01-04"
        }),
        node({
          id: "job",
          kind: "job",
          planned: "2026-01-06",
          actual: "2026-01-06"
        })
      ],
      [{ from: "ncr", to: "job", recorded: true }],
      "job"
    );
    expect(result.reports[0]?.causes).toEqual([]);
    expect(result.reports[0]?.absorbed[0]).toEqual(
      expect.objectContaining({ class: "quality_hold", days: 3 })
    );
  });

  it("says which open downstream records a late purchase order pushes", () => {
    const result = analyzeDelay({
      mode: "affects",
      sourceId: "po",
      nodes: [
        node({
          id: "po",
          kind: "supply",
          label: "PO0001",
          planned: "2026-01-01",
          actual: "2026-01-05"
        }),
        node({
          id: "job",
          kind: "job",
          label: "JOB0001",
          planned: "2026-01-01",
          actual: "2026-01-05",
          open: true
        }),
        node({
          id: "done",
          kind: "job",
          label: "JOB0002",
          planned: "2026-01-01",
          actual: "2026-01-05",
          open: false
        }),
        node({
          id: "other",
          kind: "job",
          label: "JOB0003",
          planned: "2026-01-01",
          actual: "2026-01-09",
          open: true
        })
      ],
      links: [
        { from: "po", to: "job", recorded: false },
        { from: "po", to: "done", recorded: false }
      ]
    });
    expect(result.reports[0]?.impacts).toEqual([
      expect.objectContaining({
        days: 4,
        steps: [
          expect.objectContaining({ label: "PO0001" }),
          expect.objectContaining({ label: "JOB0001" })
        ]
      })
    ]);
    expect(JSON.stringify(result)).not.toContain("JOB0003");
    expect(JSON.stringify(result)).not.toContain("JOB0002");
  });

  it("is the same when the input order changes", () => {
    const nodes = [
      node({ id: "job", kind: "job", planned: "2026-01-06", actual: "2026-01-08" }),
      node({
        id: "po",
        kind: "supply",
        label: "PO0001",
        planned: "2026-01-01",
        actual: "2026-01-08"
      })
    ];
    const links = [{ from: "po", to: "job", recorded: false }];
    expect(why(nodes, links, "job")).toEqual(
      why([...nodes].reverse(), links, "job")
    );
  });
});

describe("canViewDelayModule", () => {
  it("hides a module the API key cannot view even when the user can", () => {
    expect(
      canViewDelayModule(true, { production_view: ["co"] }, "purchasing", "co")
    ).toBe(false);
    expect(
      canViewDelayModule(true, { purchasing_view: ["co"] }, "purchasing", "co")
    ).toBe(true);
    expect(
      canViewDelayModule(true, { purchasing_view: ["other"] }, "purchasing", "co")
    ).toBe(false);
    expect(canViewDelayModule(true, null, "purchasing", "co")).toBe(true);
    expect(
      canViewDelayModule(false, { purchasing_view: ["co"] }, "purchasing", "co")
    ).toBe(false);
  });
});

describe("redactDelay", () => {
  it("drops the document number and link when the module is hidden", () => {
    const result = redactDelay(
      why(
        [
          node({
            id: "po",
            kind: "supply",
            label: "PO0001",
            href: "/x/purchase-order/pol_1",
            planned: "2026-01-01",
            actual: "2026-01-04"
          }),
          node({
            id: "job",
            kind: "job",
            label: "JOB0001",
            href: "/x/job/job_1",
            planned: "2026-01-01",
            actual: "2026-01-04"
          })
        ],
        [{ from: "po", to: "job", recorded: false }],
        "job"
      ),
      (module) => module !== "purchasing"
    );
    const cause = result.reports[0]?.causes[0];
    expect(cause?.days).toBe(3);
    expect(cause?.steps[0]).toEqual({ kind: "supply", recorded: true });
    expect(JSON.stringify(cause?.steps[0])).not.toContain("pol_1");
    expect(cause?.steps[1]?.label).toBe("JOB0001");
  });
});
