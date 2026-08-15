import { describe, expect, it } from "vitest";

import {
  adaptCarbonOperationToFactoryObject,
  adaptErpJobToFactoryObject,
  type EvidenceRecord,
  enforceEvidenceFreshness,
  type FactoryException
} from "./fids";

describe("Factory OS semantic contracts", () => {
  it("keeps Factory OS identity separate from ERP source identity", () => {
    const object = adaptErpJobToFactoryObject({
      recordId: "WO-0815",
      displayName: "Pump housing batch",
      status: "Completed"
    });

    expect(object.id).toBe("production-order:erpnext:WO-0815");
    expect(object.sourceRefs).toEqual([
      { system: "erpnext", objectType: "Job", recordId: "WO-0815" }
    ]);
    expect(object.status).toBe("completed");
    expect(object.sourceState).toBe("Completed");
  });

  it("keeps unknown source states unknown without mutating input", () => {
    const input = { recordId: "WO-1", status: "Paused" };
    const object = adaptErpJobToFactoryObject(input);

    expect(object.status).toBe("unknown");
    expect(object.sourceState).toBe("Paused");
    expect(input).toEqual({ recordId: "WO-1", status: "Paused" });
  });

  it("allows an explicit unknown object type without coercion", () => {
    const object = {
      id: "factory-object:unknown:1",
      type: "unknown" as const,
      sourceRefs: [],
      status: "unknown" as const
    };

    expect(object.type).toBe("unknown");
    expect(object.status).toBe("unknown");
  });

  it("supports multiple source references for a Carbon operation", () => {
    const object = adaptCarbonOperationToFactoryObject({
      recordId: "OP-30",
      status: "In Progress",
      workCenterId: "CNC-2"
    });

    expect(object.status).toBe("in-progress");
    expect(object.sourceRefs).toHaveLength(2);
    expect(object.sourceRefs[1]).toMatchObject({
      objectType: "WorkCenter",
      recordId: "CNC-2"
    });
    expect(object.relationships).toEqual([
      {
        type: "executes-on",
        target: { id: "equipment:carbon-mes:CNC-2", type: "equipment" },
        source: {
          system: "carbon-mes",
          objectType: "WorkCenter",
          recordId: "CNC-2"
        },
        confidence: "confirmed"
      }
    ]);
  });

  it("forces unknown freshness when neither observation nor retrieval exists", () => {
    const record: EvidenceRecord = {
      id: "evidence-1",
      source: { system: "erpnext", recordId: "WO-1" },
      fact: { label: "Quantity", value: 10, unit: "EA" },
      freshness: "fresh"
    };

    expect(enforceEvidenceFreshness(record).freshness).toBe("unknown");
    expect(
      enforceEvidenceFreshness({
        ...record,
        observedAt: "2026-08-15T10:00:00Z"
      }).freshness
    ).toBe("fresh");
  });

  it("keeps exception severity, risk and lifecycle as different fields", () => {
    const exception: FactoryException = {
      id: "EX-1",
      type: "material-shortage",
      severity: "critical",
      subject: {
        id: "production-order:erpnext:WO-1",
        type: "production-order"
      },
      summary: "Material allocation incomplete",
      facts: [{ label: "Shortage", value: 2, unit: "EA" }],
      inferredCause: {
        label: "Likely cause",
        text: "Supplier confirmation is late",
        confidence: "medium"
      },
      evidenceRefs: ["evidence-1"],
      lifecycle: "open"
    };

    expect(exception.severity).toBe("critical");
    expect(exception.subject.type).toBe("production-order");
    expect(exception.lifecycle).toBe("open");
    expect(exception.inferredCause?.confidence).toBe("medium");
  });

  it("preserves retrieved time as distinct from observed time", () => {
    const record: EvidenceRecord = {
      id: "retrieved-only",
      source: { system: "carbon-mes", recordId: "OP-1" },
      fact: { label: "State", value: "Ready" },
      retrievedAt: "2026-08-15T10:00:00Z",
      freshness: "aging"
    };

    const normalized = enforceEvidenceFreshness(record);
    expect(normalized.observedAt).toBeUndefined();
    expect(normalized.retrievedAt).toBe("2026-08-15T10:00:00Z");
    expect(normalized.freshness).toBe("aging");
  });
});
