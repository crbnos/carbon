import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  ChangeNoticeImpactWorkspaceCandidate,
  ChangeNoticeImpactWorkspaceSnapshot
} from "~/modules/items";

vi.mock("@carbon/utils", () => ({
  formatDate: (value: string) => value,
  formatQuantity: (value: number) => String(value)
}));
vi.mock("@lingui/react/macro", () => ({
  Trans: (props: { children?: unknown }) => props.children
}));
vi.mock("@react-aria/i18n", () => ({
  useLocale: () => ({ locale: "en-US" })
}));

const { SnapshotFacts, displayJobStatus } = await import(
  "./ChangeNoticeImpactSnapshotFacts"
);

const snapshot: ChangeNoticeImpactWorkspaceSnapshot = {
  schema: "JOB_SNAPSHOT_V1",
  itemRevision: null,
  status: "Ready",
  plannedQuantity: 1,
  completedQuantity: 0,
  remainingQuantity: 1,
  quantityShipped: 0,
  quantityReceivedToInventory: 0,
  dueDate: null,
  effectiveMethodVersion: 1,
  unitOfMeasureCode: "EA",
  eligibilityBasis: "activeProducingJob"
};

const candidate = {
  targetType: "job",
  sourceAvailability: "Present",
  currentSnapshot: snapshot
} satisfies Pick<
  ChangeNoticeImpactWorkspaceCandidate,
  "targetType" | "sourceAvailability" | "currentSnapshot"
>;

function text(markup: string) {
  return markup
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

describe("ChangeNoticeImpactSnapshotFacts presentation", () => {
  it("displays Ready as Released without changing the canonical snapshot", () => {
    const rendered = text(
      renderToStaticMarkup(
        createElement(SnapshotFacts, { candidate, snapshot })
      )
    );

    expect(rendered).toContain("Job status:Released");
    expect(snapshot.status).toBe("Ready");
    expect(displayJobStatus("Planned")).toBe("Planned");
  });
});
