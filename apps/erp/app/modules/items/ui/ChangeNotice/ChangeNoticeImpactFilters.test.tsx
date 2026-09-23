import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/react", () => ({
  HStack: () => null
}));
vi.mock("@lingui/react/macro", () => ({
  Trans: () => null,
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings[0] })
}));
vi.mock("~/components", () => ({ SearchFilter: () => null }));
vi.mock("~/components/Table/components/Filter", () => ({
  ActiveFilters: () => null,
  Filter: () => null
}));
vi.mock("~/components/Table/components/Filter/useFilters", () => ({
  useFilters: () => ({ hasFilters: false, urlFiltersParams: [] })
}));
vi.mock("~/hooks", () => ({
  useUrlParams: () => [new URLSearchParams(), vi.fn()]
}));
vi.mock("~/stores", () => ({ usePeople: () => [[]] }));
vi.mock("~/modules/items", () => ({
  changeNoticeImpactDecisionStatuses: [
    "No action required",
    "Action required",
    "Resolved"
  ],
  changeNoticeImpactExposureClassifications: [
    "Current operational exposure",
    "Historical reference",
    "No longer in current scope"
  ],
  changeNoticeImpactFreshnessStatuses: [
    "Current",
    "Changed since assessment",
    "Unknown"
  ],
  changeNoticeImpactSourceAvailabilities: [
    "Present",
    "Restricted",
    "Source deleted",
    "Unavailable"
  ],
  changeNoticeImpactTargetTypes: ["purchaseOrderLine", "job", "jobMaterial"],
  changeNoticeTaskStatus: ["Pending", "In Progress", "Completed", "Skipped"]
}));

const {
  filterChangeNoticeImpactCandidates,
  getImpactDecisionFilterValue,
  getImpactFilteredEmptyState,
  getImpactFilterValues,
  hasIncompleteImpactTaskFilter,
  impactFilterOptionValues
} = await import("./ChangeNoticeImpactFilters");

type Candidate = Parameters<
  typeof filterChangeNoticeImpactCandidates
>[0]["candidates"][number];
type Coverage = Parameters<
  typeof filterChangeNoticeImpactCandidates
>[0]["coverage"];

const coverage = {
  purchaseOrderLine: { status: "complete" },
  job: { status: "complete" },
  jobMaterial: { status: "complete" }
} as unknown as Coverage;

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    targetType: "purchaseOrderLine",
    targetId: "po-line-internal-id",
    parent: {
      type: "purchaseOrder",
      id: "po-internal-id",
      readableId: "PO-123",
      status: "Open",
      supplierName: "Acme Steel"
    },
    item: {
      id: "item-internal-id",
      readableId: "PART-100",
      readableIdWithRevision: "PART-100 / A",
      revision: "A",
      unitOfMeasureCode: "ea"
    },
    currentSnapshot: { schema: "PO_LINE_SNAPSHOT_V1" },
    currentProvenance: [],
    historicalProvenance: [],
    provenance: [],
    exposureClassification: "Current operational exposure",
    sourceAvailability: "Present",
    unavailableReason: null,
    decision: null,
    freshness: null,
    taskLinks: [],
    ...overrides
  } as unknown as Candidate;
}

function filterCandidates(
  candidates: Candidate[],
  filters: Record<string, string[]> = {},
  search?: string
) {
  return filterChangeNoticeImpactCandidates({
    candidates,
    search,
    filters,
    coverage,
    taskCoverageStatus: "complete"
  });
}

function decision(
  status: "No action required" | "Action required" | "Resolved"
) {
  return {
    id: `decision-${status}`,
    status,
    decisionStatus: status,
    noActionReasonCode: null,
    rationale: null,
    resolutionNote: null,
    revision: 1,
    snapshotVersion: 1,
    persistedSnapshot: null
  };
}

describe("Change Notice Impact URL filter matching", () => {
  it("searches only visible readable labels, case-insensitively and trimmed", () => {
    const job = candidate({
      targetType: "job",
      parent: {
        type: "job",
        id: "job-internal-id",
        readableId: "JOB-100",
        status: "In Progress"
      }
    });
    const material = candidate({
      targetType: "jobMaterial",
      parent: {
        type: "job",
        id: "job-internal-id",
        readableId: "JOB-100",
        status: "In Progress"
      },
      item: {
        id: "item-internal-id",
        readableId: "MAT-200",
        readableIdWithRevision: "MAT-200 / B",
        revision: "B",
        unitOfMeasureCode: "kg"
      }
    });

    expect(filterCandidates([candidate()], {}, "  po-123 ")).toHaveLength(1);
    expect(filterCandidates([job], {}, "job-100")).toHaveLength(1);
    expect(filterCandidates([material], {}, "mat-200 / b")).toHaveLength(1);
    expect(filterCandidates([candidate()], {}, "acme steel")).toHaveLength(1);
    expect(
      filterCandidates(
        [candidate({ targetId: "raw-target-id-should-not-match" })],
        {},
        "raw-target-id"
      )
    ).toHaveLength(0);
  });

  it("uses OR semantics for multiple domain values", () => {
    const job = candidate({ targetType: "job" });
    const material = candidate({ targetType: "jobMaterial" });
    const poLine = candidate({ targetType: "purchaseOrderLine" });

    expect(
      filterCandidates([job, material, poLine], {
        targetType: ["job", "jobMaterial"]
      })
    ).toEqual([job, material]);
  });

  it.each([
    "Current operational exposure",
    "Historical reference",
    "No longer in current scope"
  ] as const)("filters by exposure: %s", (exposureClassification) => {
    const matching = candidate({ exposureClassification });
    const other = candidate({ exposureClassification: "Historical reference" });

    expect(
      filterCandidates([matching, other], {
        exposureClassification: [exposureClassification]
      })
    ).toContain(matching);
  });

  it("derives Unassessed only for a current, present, completely covered row", () => {
    const current = candidate();
    const historical = candidate({
      exposureClassification: "Historical reference"
    });
    const unavailable = candidate({
      sourceAvailability: "Unavailable",
      exposureClassification: null
    });
    const partialCoverage = {
      ...coverage,
      purchaseOrderLine: { status: "partial" }
    } as unknown as Coverage;

    expect(getImpactDecisionFilterValue(current, "complete")).toBe(
      "Unassessed"
    );
    expect(getImpactDecisionFilterValue(historical, "complete")).toBeNull();
    expect(getImpactDecisionFilterValue(unavailable, "complete")).toBeNull();
    expect(getImpactDecisionFilterValue(current, "partial")).toBeNull();
    expect(
      filterCandidates([current, historical, unavailable], {
        decisionStatus: ["Unassessed"]
      })
    ).toEqual([current]);
    expect(
      filterChangeNoticeImpactCandidates({
        candidates: [current],
        filters: { decisionStatus: ["Unassessed"] },
        coverage: partialCoverage,
        taskCoverageStatus: "complete"
      })
    ).toHaveLength(0);
  });

  it("filters persisted decision states without treating task state as decision state", () => {
    const noAction = candidate({ decision: decision("No action required") });
    const action = candidate({ decision: decision("Action required") });
    const resolved = candidate({ decision: decision("Resolved") });

    expect(
      filterCandidates([noAction, action, resolved], {
        decisionStatus: ["No action required", "Resolved"]
      })
    ).toEqual([noAction, resolved]);
  });

  it.each([
    "Current",
    "Changed since assessment",
    "Unknown"
  ] as const)("filters by derived freshness: %s", (freshness) => {
    const matching = candidate({ freshness });
    const notApplicable = candidate({ freshness: null });
    expect(
      filterCandidates([matching, notApplicable], { freshness: [freshness] })
    ).toEqual([matching]);
  });

  it("filters row availability without fabricating Restricted rows", () => {
    const present = candidate({ sourceAvailability: "Present" });
    const deleted = candidate({ sourceAvailability: "Source deleted" });
    const unavailable = candidate({ sourceAvailability: "Unavailable" });
    const restricted = candidate({ sourceAvailability: "Restricted" });

    expect(filterCandidates([restricted])).toEqual([]);
    expect(impactFilterOptionValues.sourceAvailability).not.toContain(
      "Restricted"
    );
    expect(getImpactFilterValues(["sourceAvailability:eq:Restricted"])).toEqual(
      {}
    );
    expect(
      filterCandidates([present, deleted, unavailable], {
        sourceAvailability: ["Source deleted", "Unavailable"]
      })
    ).toEqual([deleted, unavailable]);
  });

  it("does not treat incomplete task metadata as a negative match", () => {
    const candidateWithoutLoadedTasks = candidate({ taskLinks: [] });

    expect(
      filterChangeNoticeImpactCandidates({
        candidates: [candidateWithoutLoadedTasks],
        filters: { taskStatus: ["Pending"] },
        coverage,
        taskCoverageStatus: "partial"
      })
    ).toEqual([candidateWithoutLoadedTasks]);
    expect(
      filterChangeNoticeImpactCandidates({
        candidates: [candidateWithoutLoadedTasks],
        filters: { taskStatus: ["Pending"] },
        coverage,
        taskCoverageStatus: "complete"
      })
    ).toEqual([]);
  });

  it("matches a candidate when any linked task has the selected status or assignee", () => {
    const matching = candidate({
      taskLinks: [
        {
          decisionId: "decision-1",
          actionTaskId: "task-1",
          name: "First task",
          status: "Completed",
          assignee: "person-1",
          dueDate: null,
          taskOrigin: "Manual"
        },
        {
          decisionId: "decision-1",
          actionTaskId: "task-2",
          name: "Second task",
          status: "In Progress",
          assignee: "person-2",
          dueDate: null,
          taskOrigin: "Impact follow-up"
        }
      ]
    });
    const notMatching = candidate({
      taskLinks: [
        {
          decisionId: "decision-2",
          actionTaskId: "task-3",
          name: "Other task",
          status: "Pending",
          assignee: "person-3",
          dueDate: null,
          taskOrigin: "Manual"
        }
      ]
    });

    expect(
      filterCandidates([matching, notMatching], {
        taskStatus: ["In Progress"]
      })
    ).toEqual([matching]);
    expect(
      filterCandidates([matching, notMatching], {
        assignee: ["person-2"]
      })
    ).toEqual([matching]);
  });

  it("combines search and different filter dimensions with AND semantics", () => {
    const matching = candidate({
      targetType: "jobMaterial",
      parent: {
        type: "job",
        id: "job-internal-id",
        readableId: "JOB-100",
        status: "In Progress"
      },
      decision: decision("Action required"),
      freshness: "Changed since assessment"
    });
    const sameDomain = candidate({ targetType: "jobMaterial" });
    const sameDecision = candidate({ decision: decision("Action required") });

    expect(
      filterCandidates(
        [matching, sameDomain, sameDecision],
        {
          targetType: ["job", "jobMaterial"],
          decisionStatus: ["Action required"],
          freshness: ["Changed since assessment"]
        },
        "job-100"
      )
    ).toEqual([matching]);
  });

  it("ignores unsupported URL values instead of changing the result set", () => {
    expect(
      getImpactFilterValues([
        "decisionStatus:eq:Banana",
        "unknown:eq:value",
        "taskStatus:bad:Completed"
      ])
    ).toEqual({});
  });

  it("keeps filtered empty states honest when coverage is incomplete", () => {
    expect(
      getImpactFilteredEmptyState({
        candidateCount: 0,
        hasDisplayFilters: true,
        coverageHasWarning: false
      })
    ).toBe("complete");
    expect(
      getImpactFilteredEmptyState({
        candidateCount: 0,
        hasDisplayFilters: true,
        coverageHasWarning: true
      })
    ).toBe("incomplete");
    expect(
      getImpactFilteredEmptyState({
        candidateCount: 0,
        hasDisplayFilters: false,
        coverageHasWarning: true
      })
    ).toBeNull();
  });

  it("warns only when task-based filters run over incomplete task coverage", () => {
    expect(
      hasIncompleteImpactTaskFilter({ taskStatus: ["Pending"] }, "partial")
    ).toBe(true);
    expect(
      hasIncompleteImpactTaskFilter({ assignee: ["person-1"] }, "failed")
    ).toBe(true);
    expect(
      hasIncompleteImpactTaskFilter(
        { decisionStatus: ["Action required"] },
        "partial"
      )
    ).toBe(false);
    expect(
      hasIncompleteImpactTaskFilter({ taskStatus: ["Pending"] }, "complete")
    ).toBe(false);
  });
});
