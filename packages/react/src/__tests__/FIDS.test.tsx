import {
  adaptErpJobToFactoryObject,
  type EvidenceRecord,
  type FactoryException
} from "@carbon/utils";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EvidencePanel } from "../EvidencePanel";
import { ExceptionCard } from "../ExceptionCard";
import { ObjectHeader } from "../ObjectHeader";
import { RiskIndicator } from "../RiskIndicator";
import { StatusBadge } from "../StatusBadge";

const object = adaptErpJobToFactoryObject({
  recordId: "WO-1042",
  displayName: "Pump housing batch",
  status: "In Progress"
});

describe("FIDS contract-aligned components", () => {
  it("renders FactoryObject identity with status and risk kept separate", () => {
    const html = renderToStaticMarkup(
      <ObjectHeader
        object={{ ...object, risk: "high" }}
        metadata={[
          { label: "Customer", value: "Acme Industrial" },
          { label: "Due", value: "18 Aug 2026" }
        ]}
        actions={<button type="button">Review plan</button>}
      />
    );

    expect(html).toContain("production-order:erpnext:WO-1042");
    expect(html).toContain("Pump housing batch");
    expect(html).toContain("Acme Industrial");
    expect(html).toContain("Review plan");
    expect(html).toContain('aria-label="Status: In progress"');
    expect(html).toContain('aria-label="Risk: High risk"');
    expect(html).toContain("Source references");
  });

  it("keeps unknown status and risk visibly unknown", () => {
    const statusHtml = renderToStaticMarkup(<StatusBadge state="unknown" />);
    const labelledStatusHtml = renderToStaticMarkup(
      <StatusBadge state="unknown" label="Paused" />
    );
    const riskHtml = renderToStaticMarkup(<RiskIndicator level="unknown" />);

    expect(statusHtml).toContain("Unknown");
    expect(statusHtml).toContain('aria-label="Status: Unknown"');
    expect(labelledStatusHtml).toContain("Unknown · Paused");
    expect(riskHtml).toContain("Unknown risk");
    expect(riskHtml).toContain('aria-label="Risk: Unknown risk"');
  });

  it("renders exception facts, inference, recommendation and lifecycle separately", () => {
    const exception: FactoryException = {
      id: "EX-30",
      type: "equipment",
      severity: "critical",
      subject: { id: object.id, type: object.type },
      summary: "Operation is blocked",
      facts: [{ label: "Observed", value: "Machining stopped at OP-30." }],
      inferredCause: {
        label: "Likely cause",
        text: "Tool wear is the most likely cause.",
        confidence: "medium"
      },
      impact: { summary: "Shipment may be delayed by one shift." },
      owner: { label: "Production supervisor" },
      evidenceRefs: ["evidence-1"],
      recommendations: [
        { id: "rec-1", text: "Inspect the tool before rescheduling." }
      ],
      lifecycle: "open"
    };

    const html = renderToStaticMarkup(
      <ExceptionCard
        exception={exception}
        action={<button type="button">Open exception</button>}
      />
    );

    expect(html).toContain("Facts");
    expect(html).toContain("Inference");
    expect(html).toContain("Recommendations");
    expect(html).toContain("Lifecycle");
    expect(html).toContain("Production supervisor");
    expect(html).toContain("Open exception");
    expect(html).toContain('aria-label="Exception severity: Critical"');
  });

  it("does not fabricate optional exception details", () => {
    const html = renderToStaticMarkup(
      <ExceptionCard
        exception={{
          id: "EX-unknown",
          type: "unknown",
          severity: "unknown",
          subject: { id: "unknown", type: "unknown" },
          summary: "Material allocation incomplete",
          facts: [
            { label: "Observed", description: "Two lines are unavailable." }
          ],
          evidenceRefs: [],
          lifecycle: "unknown"
        }}
      />
    );

    expect(html).toContain("Material allocation incomplete");
    expect(html).toContain("Unknown severity");
    expect(html).not.toContain("Inference");
    expect(html).not.toContain("Recommendations");
  });

  it("renders contract evidence freshness and provenance", () => {
    const records: EvidenceRecord[] = [
      {
        id: "fresh",
        source: {
          system: "carbon-mes",
          objectType: "Operation",
          recordId: "OP-30"
        },
        subject: { id: "operation:carbon-mes:OP-30", type: "operation" },
        fact: { label: "Cycle time", value: 42, unit: "minutes" },
        observedAt: "2026-08-15T10:30:00Z",
        freshness: "fresh",
        version: "Event 1842"
      },
      {
        id: "stale",
        source: { system: "factory-os", objectType: "Risk", recordId: "RA-17" },
        fact: { label: "Delivery risk", value: "High" },
        observedAt: "2026-08-10T08:00:00Z",
        freshness: "stale",
        provenance: { model: "Planning model v3" }
      },
      {
        id: "unknown",
        source: {
          system: "erpnext",
          objectType: "Purchase Order",
          recordId: "PO-812"
        },
        fact: { label: "Supplier confirmation", description: "Unavailable" },
        freshness: "fresh"
      }
    ];
    const html = renderToStaticMarkup(<EvidencePanel records={records} />);

    expect(html).toContain("Fresh");
    expect(html).toContain("Stale");
    expect(html).toContain("Unknown freshness");
    expect(html).toContain("Event 1842");
    expect(html).toContain("Planning model v3");
    expect(html).toContain(
      'aria-label="Evidence freshness: Unknown freshness"'
    );
  });

  it("adds wrapping classes for long contract IDs", () => {
    const html = renderToStaticMarkup(
      <ObjectHeader
        object={{
          ...object,
          id: "production-order:erpnext:UNBROKEN-12345678901234567890"
        }}
      />
    );

    expect(html).toContain("break-all");
    expect(html).toContain("break-words");
  });
});
