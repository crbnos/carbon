import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  ChangeNoticeImpactHistoryEntry,
  ChangeNoticeImpactWorkspaceCandidate
} from "~/modules/items";

const fetcherData = vi.hoisted(() => ({
  current: null as { entries: ChangeNoticeImpactHistoryEntry[] } | null
}));

vi.mock("@carbon/react", () => {
  const passthrough = (props: { children?: unknown }) => props.children;
  return {
    Badge: passthrough,
    Drawer: passthrough,
    DrawerBody: passthrough,
    DrawerContent: passthrough,
    DrawerHeader: passthrough,
    DrawerTitle: passthrough,
    Skeleton: () => null,
    VStack: passthrough
  };
});
vi.mock("@lingui/react/macro", () => ({
  Trans: (props: { children?: unknown }) => props.children
}));
vi.mock("react-icons/lu", () => ({ LuHistory: () => null }));
vi.mock("react-router", () => ({
  useFetcher: () => ({
    data: fetcherData.current,
    load: vi.fn(),
    state: "idle"
  })
}));
vi.mock("~/components", () => ({
  DateTime: () => null,
  EmployeeAvatar: () => null
}));
vi.mock("~/utils/path", () => ({
  path: { to: { changeNoticeImpactHistory: () => "/impact/history" } }
}));
vi.mock("./ChangeNoticeImpactSnapshotFacts", () => ({
  SnapshotFacts: (props: { emptyMessage?: unknown }) =>
    props.emptyMessage ?? "snapshot facts"
}));

const { ChangeNoticeImpactHistory } = await import(
  "./ChangeNoticeImpactHistory"
);

type Decision = NonNullable<ChangeNoticeImpactWorkspaceCandidate["decision"]>;

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "decision-1",
    status: "Action required",
    decisionStatus: "Action required",
    noActionReasonCode: null,
    rationale: null,
    resolutionNote: null,
    revision: 1,
    snapshotVersion: 1,
    persistedSnapshot: null,
    ...overrides
  };
}

function makeCandidate(
  overrides: Partial<ChangeNoticeImpactWorkspaceCandidate> = {}
): ChangeNoticeImpactWorkspaceCandidate {
  return {
    targetType: "purchaseOrderLine",
    targetId: "po-line-1",
    parent: null,
    item: null,
    currentSnapshot: null,
    currentProvenance: [],
    historicalProvenance: [],
    provenance: [],
    exposureClassification: "Current operational exposure",
    sourceAvailability: "Present",
    unavailableReason: null,
    decision: makeDecision(),
    previewFingerprint: null,
    freshness: "Current",
    taskLinks: [],
    ...overrides
  };
}

function makeEntry(
  overrides: Partial<ChangeNoticeImpactHistoryEntry> = {}
): ChangeNoticeImpactHistoryEntry {
  return {
    id: "history-1",
    eventType: "Decision reassessed",
    previousStatus: null,
    newStatus: null,
    previousReasonCode: null,
    newReasonCode: null,
    previousSnapshot: null,
    previousSnapshotStatus: "absent",
    newSnapshot: null,
    newSnapshotStatus: "absent",
    rationale: null,
    resolutionNote: null,
    priorAssessmentWasChanged: false,
    relatedActionTaskId: null,
    provenance: null,
    createdBy: "employee-1",
    createdAt: "2026-09-07T10:00:00.000Z",
    ...overrides
  };
}

function renderHistory(
  entry: ChangeNoticeImpactHistoryEntry,
  candidateOverrides: Partial<ChangeNoticeImpactWorkspaceCandidate> = {}
) {
  fetcherData.current = { entries: [entry] };
  return renderToStaticMarkup(
    createElement(ChangeNoticeImpactHistory, {
      actions: [],
      candidate: makeCandidate(candidateOverrides),
      changeNoticeId: "change-notice-1",
      onClose: vi.fn()
    })
  );
}

function text(markup: string) {
  return markup
    .replace(/<[^>]+>/g, "")
    .replace(/\s*→\s*/g, " → ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("ChangeNoticeImpactHistory presentation", () => {
  it("renders an initial decision as a conclusion, not an Unassessed transition", () => {
    const rendered = text(
      renderHistory(
        makeEntry({
          eventType: "Decision created",
          newStatus: "Action required"
        })
      )
    );

    expect(rendered).toContain("Conclusion: Action required");
    expect(rendered).not.toContain("Unassessed");
  });

  it("renders a same-state reassessment conclusion once without an arrow", () => {
    const rendered = text(
      renderHistory(
        makeEntry({
          eventType: "Decision reassessed",
          previousStatus: "Action required",
          newStatus: "Action required"
        }),
        { decision: null }
      )
    );

    expect(rendered.match(/Action required/g)).toHaveLength(1);
    expect(rendered).not.toContain("→");
  });

  it("renders an introduced no-action reason once", () => {
    const rendered = text(
      renderHistory(
        makeEntry({
          previousStatus: "Action required",
          newStatus: "No action required",
          newReasonCode: "Not affected after review"
        }),
        {
          decision: makeDecision({
            status: "No action required",
            decisionStatus: "No action required"
          })
        }
      )
    );

    expect(rendered.match(/Not affected after review/g)).toHaveLength(1);
    expect(rendered).not.toContain(
      "Not affected after review → Not affected after review"
    );
  });

  it("renders a changed no-action reason as a reason transition", () => {
    const rendered = text(
      renderHistory(
        makeEntry({
          previousReasonCode: "Outside effectivity",
          newReasonCode: "Not affected after review"
        }),
        { decision: null }
      )
    );

    expect(rendered).toContain(
      "No-action reason: Outside effectivity → Not affected after review"
    );
  });

  it("keeps correction and resolution event semantics distinct", () => {
    const correction = text(
      renderHistory(
        makeEntry({
          eventType: "Conclusion corrected",
          previousStatus: "Action required",
          newStatus: "No action required"
        })
      )
    );
    const resolution = text(
      renderHistory(
        makeEntry({
          eventType: "Decision resolved",
          previousStatus: "Action required",
          newStatus: "Resolved",
          resolutionNote: "Supplier confirmed the cut-in."
        })
      )
    );

    expect(correction).toContain("Conclusion corrected");
    expect(correction).toContain("Action required → No action required");
    expect(resolution).toContain("Assessment resolved");
    expect(resolution).toContain("Action required → Resolved");
    expect(resolution).toContain(
      "Resolution note: Supplier confirmed the cut-in."
    );
  });

  it("labels a first captured snapshot without a fake After panel", () => {
    const rendered = text(
      renderHistory(
        makeEntry({
          eventType: "Decision created",
          newStatus: "Action required",
          newSnapshot: { schema: "PO_LINE_SNAPSHOT_V1" } as never,
          newSnapshotStatus: "present"
        })
      )
    );

    expect(rendered).toContain("Captured snapshot");
    expect(rendered).not.toContain("After");
  });

  it("shows the current no-action reason and changed-since-assessment indication", () => {
    const rendered = text(
      renderHistory(makeEntry({ eventType: "Decision reassessed" }), {
        decision: makeDecision({
          status: "No action required",
          decisionStatus: "No action required",
          noActionReasonCode: "No purchasing intervention remains"
        }),
        freshness: "Changed since assessment"
      })
    );

    expect(rendered).toContain(
      "No-action reason: No purchasing intervention remains"
    );
    expect(rendered).toContain("Changed since assessment");
  });

  it("keeps provenance events separate from conclusion transitions", () => {
    const rendered = text(
      renderHistory(
        makeEntry({
          eventType: "Provenance ended",
          previousStatus: "Action required",
          newStatus: "Action required",
          provenance: {
            affectedItemLabel: "PART-1 Rev A",
            endedAt: "2026-09-07T10:00:00.000Z",
            endedReason: "Affected item was removed"
          }
        }),
        { decision: null }
      )
    );

    expect(rendered).toContain("Provenance ended");
    expect(rendered).toContain("Affected item: PART-1 Rev A");
    expect(rendered).not.toContain("→");
  });
});
