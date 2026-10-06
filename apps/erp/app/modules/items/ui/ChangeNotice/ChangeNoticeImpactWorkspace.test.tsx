// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeNoticeImpactWorkspaceReadModel } from "~/modules/items";

const presentation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  revalidate: vi.fn()
}));

import { getImpactDecisionFilterValue } from "./ChangeNoticeImpactFilters";

vi.mock("@carbon/form", () => ({ ValidatedForm: () => null }));
vi.mock("@carbon/react", () => {
  const passthrough = (props: { children?: ReactNode }) => props.children;
  const exports = Object.fromEntries(
    [
      "Alert",
      "AlertDescription",
      "AlertTitle",
      "Badge",
      "Card",
      "CardAction",
      "CardAttribute",
      "CardAttributeLabel",
      "CardAttributes",
      "CardAttributeValue",
      "CardContent",
      "CardHeader",
      "CardTitle",
      "Drawer",
      "DrawerBody",
      "DrawerContent",
      "DrawerFooter",
      "DrawerHeader",
      "DrawerTitle",
      "HStack",
      "Modal",
      "ModalBody",
      "ModalContent",
      "ModalFooter",
      "ModalHeader",
      "ModalTitle",
      "VStack",
      "Status",
      "TruncatedTooltipText",
      "Tooltip",
      "TooltipTrigger",
      "TooltipContent"
    ].map((name) => [name, passthrough])
  );
  return {
    ...exports,
    Checkbox: () => null,
    MenuIcon: () => null,
    MenuItem: () => null,
    IconButton: () => null,
    Button: (props: { children?: ReactNode; isDisabled?: boolean }) =>
      createElement("button", { disabled: props.isDisabled }, props.children)
  };
});
vi.mock("@carbon/utils", () => ({ formatDate: vi.fn() }));
vi.mock("@lingui/react/macro", () => ({
  Plural: (props: { value: number; one: string; other: string }) =>
    (props.value === 1 ? props.one : props.other).replace(
      "#",
      String(props.value)
    ),
  Trans: (props: { children?: ReactNode }) => props.children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce(
        (text, part, index) => text + part + (values[index] ?? ""),
        ""
      )
  })
}));
vi.mock("@react-aria/i18n", () => ({
  useLocale: () => ({ locale: "en-US" }),
  useNumberFormatter: () => ({ format: String })
}));
vi.mock("react-icons/lu", () => ({
  LuArrowRight: () => null,
  LuBookMarked: () => null,
  LuCircleCheck: () => null,
  LuInfo: () => null,
  LuLink: () => null,
  LuListTodo: () => null,
  LuPackage: () => null,
  LuChevronRight: () => null,
  LuExternalLink: () => null,
  LuHistory: () => null,
  LuRefreshCw: () => null,
  LuStar: () => null,
  LuTriangleAlert: () => null
}));
vi.mock("react-router", () => ({
  Link: () => null,
  useFetcher: () => ({ state: "idle" })
}));
vi.mock("@carbon/query", () => ({
  useRevalidator: () => ({ revalidate: presentation.revalidate, state: "idle" })
}));
vi.mock("~/components", () => ({ EmployeeAvatar: () => null }));
vi.mock("~/components/Hyperlink", () => ({
  default: (props: { children?: ReactNode }) => props.children
}));
vi.mock("~/components/Table", () => ({
  default: (props: {
    data: Parameters<
      typeof getChangeNoticeImpactDecisionControls
    >[0]["candidate"][];
    columns: {
      cell?: (context: {
        row: {
          original: Parameters<
            typeof getChangeNoticeImpactDecisionControls
          >[0]["candidate"];
        };
      }) => ReactNode;
    }[];
    emptyState?: ReactNode;
  }) =>
    createElement(
      "div",
      { "data-impact-table": true },
      props.data.length === 0
        ? props.emptyState
        : props.data.map((row, index) =>
            createElement(
              "div",
              { key: index },
              props.columns.map((column, columnIndex) =>
                createElement(
                  "span",
                  { key: columnIndex },
                  column.cell?.({ row: { original: row } })
                )
              )
            )
          )
    )
}));
vi.mock("~/components/Table/components/Filter", () => ({
  ActiveFilters: () => null,
  Filter: () => null
}));
vi.mock("~/components/Table/components/Filter/useFilters", () => ({
  useFilters: () => ({ hasFilters: false, urlFiltersParams: [] })
}));
vi.mock("~/stores", () => ({ usePeople: () => [[]] }));
vi.mock("./ChangeNoticeImpactFilters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ChangeNoticeImpactFilters")>()),
  ChangeNoticeImpactFilterBar: () => null
}));
vi.mock("~/components/Form", () => ({
  Boolean: () => null,
  Hidden: () => null,
  Select: () => null,
  Submit: () => null,
  TextArea: () => null,
  TextAreaControlled: () => null
}));
vi.mock("~/hooks", () => ({
  usePermissions: () => ({ can: () => true }),
  useUrlParams: () => [presentation.params, vi.fn()]
}));
vi.mock("~/modules/items", () => ({
  changeNoticeImpactDecisionBulkFormValidator: {},
  changeNoticeImpactDecisionFormValidator: {},
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
  changeNoticeTaskStatus: ["Pending", "In Progress", "Completed", "Skipped"],
  changeNoticeStageFlow: [
    "Draft",
    "Start",
    "Engineering Complete",
    "Implementation",
    "Done"
  ]
}));
vi.mock("~/modules/production/ui/Jobs/JobStatus", () => ({
  default: () => null
}));
vi.mock("~/modules/purchasing/ui/PurchaseOrder/PurchasingStatus", () => ({
  default: () => null
}));
vi.mock("~/utils/path", () => ({
  path: {
    to: {
      changeNoticeImpact: (id: string) => `/impact/${id}`,
      purchaseOrderLine: () => "/po/line",
      job: () => "/job",
      jobMaterials: () => "/job/materials"
    }
  }
}));
vi.mock("./ChangeNoticeStatus", () => ({ default: () => null }));
vi.mock("./ChangeNoticeImpactTasks", () => ({
  ChangeNoticeImpactTasks: () => null
}));
vi.mock("./ChangeNoticeImpactHistory", () => ({
  ChangeNoticeImpactHistory: () => null
}));

const {
  default: ChangeNoticeImpactWorkspace,
  canSelectChangeNoticeImpactCandidate,
  canViewChangeNoticeImpactHistory,
  conditionBadges,
  getChangeNoticeImpactBulkDecisionStatusOptions,
  getChangeNoticeImpactBulkNoActionReasonOptions,
  getChangeNoticeImpactDecisionControls,
  getChangeNoticeImpactDecisionStatusOptions,
  getChangeNoticeImpactRationaleDefault,
  groupCandidates,
  refreshChangeNoticeImpactWorkspace
} = await import("./ChangeNoticeImpactWorkspace");

function candidate(over: Record<string, unknown> = {}) {
  return {
    targetType: "purchaseOrderLine",
    targetId: "pol-1",
    parent: null,
    item: null,
    currentSnapshot: { schema: "PO_LINE_SNAPSHOT_V1" },
    currentProvenance: [],
    historicalProvenance: [],
    provenance: [],
    exposureClassification: "Current operational exposure",
    sourceAvailability: "Present",
    unavailableReason: null,
    decision: null,
    previewFingerprint: "preview-1",
    freshness: null,
    taskLinks: [],
    ...over
  } as unknown as Parameters<
    typeof getChangeNoticeImpactDecisionControls
  >[0]["candidate"];
}

const base = {
  coverageStatus: "complete" as const,
  taskCoverageStatus: "complete" as const,
  changeNoticeStatus: "Implementation" as const,
  canUpdate: true
};

describe("Change Notice Impact refresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps refresh GET-only for read-only viewers", () => {
    const submit = vi.fn();
    const revalidate = vi.fn();

    refreshChangeNoticeImpactWorkspace({
      canUpdate: false,
      id: "change-1",
      submit,
      revalidate
    });

    expect(revalidate).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });

  it("submits reconciliation and lets the router revalidate the workspace", () => {
    const submit = vi.fn();
    const revalidate = vi.fn();

    refreshChangeNoticeImpactWorkspace({
      canUpdate: true,
      id: "change-1",
      submit,
      revalidate
    });

    expect(submit).toHaveBeenCalledWith(null, {
      method: "post",
      action: "/impact/change-1"
    });
    expect(revalidate).not.toHaveBeenCalled();
  });
});

describe("Change Notice Impact decision controls", () => {
  beforeEach(() => vi.clearAllMocks());

  it("only selects complete, current, readable candidates with a preview proof", () => {
    expect(
      canSelectChangeNoticeImpactCandidate({
        candidate: candidate(),
        ...base
      })
    ).toBe(true);
    expect(
      canSelectChangeNoticeImpactCandidate({
        candidate: candidate({ previewFingerprint: null }),
        ...base
      })
    ).toBe(false);
    expect(
      canSelectChangeNoticeImpactCandidate({
        candidate: candidate({
          exposureClassification: "Historical reference"
        }),
        ...base
      })
    ).toBe(false);
    expect(
      canSelectChangeNoticeImpactCandidate({
        candidate: candidate(),
        ...base,
        coverageStatus: "partial"
      })
    ).toBe(false);
  });

  it("keeps bulk preview conclusions distinct from Unassessed and preserves changed freshness", () => {
    const unassessed = candidate();
    const changed = candidate({
      decision: pendingCandidateDecision(),
      freshness: "Changed since assessment"
    });

    expect(getImpactDecisionFilterValue(unassessed, "complete")).toBe(
      "Unassessed"
    );
    expect(getImpactDecisionFilterValue(changed, "complete")).toBe(
      "Action required"
    );
    expect(
      getImpactDecisionFilterValue(
        candidate({
          decision: {
            ...pendingCandidateDecision(),
            status: "No action required",
            decisionStatus: "No action required"
          }
        }),
        "complete"
      )
    ).toBe("No action required");
    expect(
      getImpactDecisionFilterValue(
        candidate({
          decision: {
            ...pendingCandidateDecision(),
            status: "Resolved",
            decisionStatus: "Resolved"
          }
        }),
        "complete"
      )
    ).toBe("Resolved");
    expect(conditionBadges(changed)).toHaveLength(1);
  });

  it("offers only shared bulk conclusions and domain-valid reasons", () => {
    const options = getChangeNoticeImpactBulkDecisionStatusOptions({
      candidates: [candidate(), candidate({ targetId: "pol-2" })],
      coverage: {
        purchaseOrderLine: { status: "complete" },
        job: { status: "complete" },
        jobMaterial: { status: "complete" }
      } as any,
      taskCoverageStatus: "complete",
      changeNoticeStatus: "Implementation"
    });
    expect(options).toEqual([
      "No action required",
      "Action required",
      "Resolved"
    ]);
    expect(
      getChangeNoticeImpactBulkNoActionReasonOptions([candidate()])
    ).toEqual([
      "Not affected after review",
      "No purchasing intervention remains"
    ]);
    expect(
      getChangeNoticeImpactBulkNoActionReasonOptions([
        candidate(),
        candidate({ targetType: "job", targetId: "job-1" })
      ])
    ).toEqual(["Not affected after review"]);
  });

  it("shows history only for a readable persisted decision", () => {
    const assessed = candidate({ decision: pendingCandidateDecision() });
    expect(canViewChangeNoticeImpactHistory(assessed)).toBe(true);
    expect(
      canViewChangeNoticeImpactHistory(
        candidate({
          decision: pendingCandidateDecision(),
          sourceAvailability: "Source deleted"
        })
      )
    ).toBe(true);
    expect(
      canViewChangeNoticeImpactHistory(
        candidate({
          decision: pendingCandidateDecision(),
          sourceAvailability: "Restricted"
        })
      )
    ).toBe(false);
    expect(
      canViewChangeNoticeImpactHistory(
        candidate({
          decision: pendingCandidateDecision(),
          sourceAvailability: "Unavailable"
        })
      )
    ).toBe(true);
    expect(canViewChangeNoticeImpactHistory(candidate())).toBe(false);
  });

  it("offers Assess and direct first-time Resolve only for current complete exposure", () => {
    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate(),
        ...base
      })
    ).toEqual({
      assess: true,
      reassess: false,
      resolve: true,
      resolveBlock: null
    });

    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({
          exposureClassification: "Historical reference"
        }),
        ...base
      })
    ).toMatchObject({
      assess: false,
      reassess: false,
      resolve: false
    });
  });

  it("offers Reassess for changed current decisions and Resolve for historical open work", () => {
    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({
          decision: {
            status: "No action required",
            decisionStatus: "No action required",
            noActionReasonCode: "Not affected after review",
            rationale: "Reviewed",
            resolutionNote: null,
            id: "decision-1",
            revision: 2,
            snapshotVersion: 1,
            persistedSnapshot: null
          },
          freshness: "Changed since assessment"
        }),
        ...base
      })
    ).toMatchObject({
      assess: false,
      reassess: true,
      resolve: false
    });

    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({
          exposureClassification: "Historical reference",
          decision: {
            status: "Action required",
            decisionStatus: "Action required",
            noActionReasonCode: null,
            rationale: "Follow-up",
            resolutionNote: null,
            id: "decision-1",
            revision: 1,
            snapshotVersion: 1,
            persistedSnapshot: null
          },
          currentSnapshot: null
        }),
        ...base
      })
    ).toMatchObject({
      assess: false,
      reassess: false,
      resolve: true,
      resolveBlock: null
    });
  });

  it("keeps Resolve visible but blocked when linked task evidence is incomplete or non-terminal", () => {
    const pending = getChangeNoticeImpactDecisionControls({
      candidate: candidate({
        decision: {
          status: "Action required",
          decisionStatus: "Action required",
          noActionReasonCode: null,
          rationale: "Follow-up",
          resolutionNote: null,
          id: "decision-1",
          revision: 1,
          snapshotVersion: 1,
          persistedSnapshot: null
        },
        taskLinks: [
          {
            decisionId: "decision-1",
            actionTaskId: "task-1",
            name: "Call supplier",
            status: "Pending",
            assignee: null,
            dueDate: null,
            taskOrigin: "Impact follow-up"
          }
        ]
      }),
      ...base
    });
    expect(pending).toMatchObject({
      reassess: true,
      resolve: true,
      resolveBlock: "nonTerminalTask"
    });

    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({
          decision: pendingCandidateDecision(),
          taskLinks: []
        }),
        ...base,
        taskCoverageStatus: "partial"
      })
    ).toMatchObject({ resolve: true, resolveBlock: "taskCoverage" });

    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate(),
        ...base,
        taskCoverageStatus: "partial"
      })
    ).toEqual({
      assess: true,
      reassess: false,
      resolve: true,
      resolveBlock: null
    });
  });

  it.each([
    "Completed",
    "Skipped"
  ] as const)("allows existing Action required resolution when linked tasks are %s", (status) => {
    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({
          decision: pendingCandidateDecision(),
          taskLinks: [
            {
              decisionId: "decision-1",
              actionTaskId: "task-1",
              name: "Supplier follow-up",
              status,
              assignee: null,
              dueDate: null,
              taskOrigin: "Manual"
            }
          ]
        }),
        ...base
      })
    ).toMatchObject({
      reassess: true,
      resolve: true,
      resolveBlock: null
    });
  });

  it("keeps existing Action required resolution available for unavailable sources", () => {
    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({
          sourceAvailability: "Unavailable",
          exposureClassification: null,
          currentSnapshot: null,
          decision: pendingCandidateDecision()
        }),
        ...base
      })
    ).toEqual({
      assess: false,
      reassess: false,
      resolve: true,
      resolveBlock: null
    });
  });

  it("does not offer a duplicate Resolved option in Assess or open Action required Reassess", () => {
    expect(getChangeNoticeImpactDecisionStatusOptions(null)).toEqual([
      "No action required",
      "Action required"
    ]);
    expect(
      getChangeNoticeImpactDecisionStatusOptions(pendingCandidateDecision())
    ).toEqual(["No action required", "Action required"]);
    expect(
      getChangeNoticeImpactDecisionStatusOptions(
        candidate({
          decision: {
            ...pendingCandidateDecision(),
            status: "No action required",
            decisionStatus: "No action required"
          }
        }).decision
      )
    ).toEqual(["No action required", "Action required"]);
    expect(
      getChangeNoticeImpactDecisionStatusOptions(
        candidate({
          decision: {
            ...pendingCandidateDecision(),
            status: "Resolved",
            decisionStatus: "Resolved"
          }
        }).decision
      )
    ).toEqual(["No action required", "Action required", "Resolved"]);
  });

  it("clears rationale for a changed conclusion while retaining it for same-state edits", () => {
    expect(
      getChangeNoticeImpactRationaleDefault({
        persistedStatus: "Action required",
        selectedStatus: "No action required",
        persistedRationale: "The old follow-up rationale."
      })
    ).toBe("");
    expect(
      getChangeNoticeImpactRationaleDefault({
        persistedStatus: "No action required",
        selectedStatus: "Action required",
        persistedRationale: "The old review rationale."
      })
    ).toBe("");
    expect(
      getChangeNoticeImpactRationaleDefault({
        persistedStatus: "Action required",
        selectedStatus: "Action required",
        persistedRationale: "The existing follow-up rationale."
      })
    ).toBe("The existing follow-up rationale.");
  });

  it("keeps filtered children in their document group without empty groups", () => {
    const parent = {
      type: "job" as const,
      id: "job-1",
      readableId: "JOB-100",
      status: "In Progress"
    };
    const matchingChild = candidate({
      targetType: "jobMaterial",
      targetId: "material-1",
      parent
    });
    const matchingParent = candidate({
      targetType: "job",
      targetId: "job-1",
      parent
    });
    const otherDocument = candidate({
      targetType: "jobMaterial",
      targetId: "material-2",
      parent: { ...parent, id: "job-2", readableId: "JOB-200" }
    });

    const groups = groupCandidates([matchingChild, matchingParent]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("JOB-100");
    expect(groups[0]?.candidates).toEqual([matchingChild, matchingParent]);
    expect(
      groups.some((group) => group.candidates.includes(otherDocument))
    ).toBe(false);
  });

  it("gates new conclusions while preserving Cancelled cleanup resolution", () => {
    const decision = pendingCandidateDecision();
    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({ decision }),
        ...base,
        canUpdate: false
      })
    ).toEqual({
      assess: false,
      reassess: false,
      resolve: false,
      resolveBlock: null
    });

    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({ decision }),
        ...base,
        changeNoticeStatus: "Cancelled"
      })
    ).toMatchObject({
      assess: false,
      reassess: false,
      resolve: true,
      resolveBlock: null
    });

    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate(),
        ...base,
        changeNoticeStatus: "Cancelled"
      })
    ).toEqual({
      assess: false,
      reassess: false,
      resolve: false,
      resolveBlock: null
    });

    expect(
      getChangeNoticeImpactDecisionControls({
        candidate: candidate({ sourceAvailability: "Restricted", decision }),
        ...base
      })
    ).toEqual({
      assess: false,
      reassess: false,
      resolve: false,
      resolveBlock: null
    });
  });
});

function pendingCandidateDecision() {
  return {
    status: "Action required" as const,
    decisionStatus: "Action required" as const,
    noActionReasonCode: null,
    rationale: "Follow-up",
    resolutionNote: null,
    id: "decision-1",
    revision: 1,
    snapshotVersion: 1,
    persistedSnapshot: null
  };
}

function workspaceData(
  rows: ChangeNoticeImpactWorkspaceReadModel["candidates"]
): ChangeNoticeImpactWorkspaceReadModel {
  const coverage = (
    targetType: ChangeNoticeImpactWorkspaceReadModel["candidates"][number]["targetType"]
  ): ChangeNoticeImpactWorkspaceReadModel["coverage"]["job"] => ({
    targetType,
    status: "complete",
    currentExposureCount: 2,
    historicalReferenceCount: 0,
    unassessedCount: 1,
    nextCursor: { current: null, historical: null }
  });
  return {
    changeNoticeId: "cn-1",
    changeNoticeStatus: "Draft",
    candidates: rows,
    coverage: {
      purchaseOrderLine: coverage("purchaseOrderLine"),
      job: coverage("job"),
      jobMaterial: coverage("jobMaterial")
    },
    taskCoverage: { status: "complete" }
  };
}

function renderWorkspace(data: ChangeNoticeImpactWorkspaceReadModel) {
  return renderToStaticMarkup(
    createElement(ChangeNoticeImpactWorkspace, {
      id: "cn-1",
      changeNotice: null,
      data,
      actions: []
    })
  );
}

function workspaceText(markup: string) {
  return markup
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

describe("Change Notice Impact scan presentation", () => {
  beforeEach(() => {
    presentation.params = new URLSearchParams();
  });

  it("keeps rich evidence collapsed and uses readable identities with one next action", () => {
    const markup = renderWorkspace(
      workspaceData([
        candidate({
          item: { readableId: "BAT-48", readableIdWithRevision: "BAT-48.A" },
          parent: {
            type: "purchaseOrder",
            id: "opaque-parent",
            readableId: "PO001",
            status: "Draft",
            supplierName: "Supplier"
          },
          targetId: "opaque-target",
          decision: {
            status: "Action required",
            rationale: "LONG_PRIVATE_RATIONALE"
          }
        })
      ])
    );
    const text = workspaceText(markup);
    expect(text).toContain("BAT-48.A");
    expect(text).toContain("PO001");
    expect(text).toContain("Resolve");
    expect(text).not.toContain("Reassess");
    expect(text).not.toContain("opaque-target");
    expect(text).not.toContain("LONG_PRIVATE_RATIONALE");
    expect(text).not.toContain("Historical References");
    expect(text).not.toContain("Unavailable Source Rows");
    expect(text).not.toContain("Informational context only");
    expect(text).not.toContain("Receipts, inspections, sales, shipments");
  });

  it("keeps source-deleted references historical without new assessment controls", () => {
    const text = workspaceText(
      renderWorkspace(
        workspaceData([
          candidate({
            sourceAvailability: "Source deleted",
            exposureClassification: "Historical reference",
            currentSnapshot: null
          })
        ])
      )
    );
    expect(text).toContain("Historical References");
    expect(text).toContain("Source deleted");
    expect(text).not.toContain("Unavailable Source Rows");
    expect(text).not.toContain("Resolve");
    expect(text).not.toContain("Reassess");
  });

  it("does not expose malformed Restricted identities and does not present missing counts as zero", () => {
    const data = workspaceData([
      candidate({
        sourceAvailability: "Restricted",
        item: { readableId: "SECRET_ITEM" },
        parent: { type: "job", id: "secret", readableId: "SECRET_JOB" }
      })
    ]);
    data.coverage.job = {
      ...data.coverage.job,
      status: "restricted",
      currentExposureCount: null,
      unassessedCount: null,
      errorMessage: "SECRET_ERROR"
    };
    const text = workspaceText(renderWorkspace(data));
    expect(text).not.toContain("SECRET");
    expect(text).toContain("Restricted");
    expect(text).toContain("To AssessUnavailable");
    expect(text.match(/Source coverage needs attention/g)).toHaveLength(1);
    expect(text).toContain("No complete current result is available.");
  });

  it("retains authoritative counts when display filters match no loaded row", () => {
    presentation.params = new URLSearchParams({ search: "does-not-match" });
    const text = workspaceText(renderWorkspace(workspaceData([candidate()])));
    expect(text).toContain("To Assess3");
    expect(text).toContain(
      "No Impact rows match the current search and filters."
    );
  });

  it("keeps Done reassessment available and Cancelled assessment locked", () => {
    const data = workspaceData([
      candidate({
        decision: { status: "No action required" },
        freshness: "Current"
      })
    ]);
    data.changeNoticeStatus = "Done";
    expect(workspaceText(renderWorkspace(data))).toContain("Reassess");
    expect(workspaceText(renderWorkspace(data))).not.toContain(
      "Assessment locked"
    );
    data.changeNoticeStatus = "Cancelled";
    const text = workspaceText(renderWorkspace(data));
    expect(text).toContain("Assessment locked");
    expect(text).not.toContain("Reassess");
  });
});
