import { describe, expect, it } from "vitest";

import {
  type CarbonMesJobSource,
  type ErpNextWorkOrderSource,
  mergeProductionOrderProjections,
  productionOrderMappingRegistry,
  projectCarbonMesJob,
  projectErpNextWorkOrder,
  validateProductionOrderMappings,
  validateProductionOrderMerge
} from "./production-order-mapping";
import { productionOrderGoldenPathFixtures } from "./production-order-mapping.fixtures";

const erpWorkOrder: ErpNextWorkOrderSource = {
  recordId: "WO-MVP-001",
  displayName: "Pump housing batch",
  itemRef: "ITEM-PUMP-001",
  status: "Submitted",
  plannedQuantity: 10,
  producedQuantity: 2,
  unit: "EA",
  plannedStart: "2026-08-15T08:00:00Z",
  plannedFinish: "2026-08-15T16:00:00Z",
  requiredDate: "2026-08-16",
  operations: [
    {
      recordId: "WO-OP-001",
      sequence: 10,
      status: "Pending",
      plannedQuantity: 10,
      workCenterRef: "WS-CNC-01"
    }
  ]
};

const carbonJob: CarbonMesJobSource = {
  recordId: "JOB-MVP-001",
  displayName: "Pump housing batch",
  itemRef: "ITEM-PUMP-001",
  status: "In Progress",
  plannedQuantity: 10,
  executionQuantity: 4,
  quantityComplete: 4,
  quantityScrapped: 0,
  unit: "EA",
  actualStart: "2026-08-15T09:00:00Z",
  operations: [
    {
      recordId: "JOB-OP-001",
      sequence: 10,
      status: "In Progress",
      operationQuantity: 4,
      quantityComplete: 4,
      workCenterRef: "WC-CNC-01"
    }
  ]
};

describe("Production Order Mapping MVP", () => {
  it("projects ERP-only planning facts without inferring execution", () => {
    const input = structuredClone(erpWorkOrder);
    const projection = projectErpNextWorkOrder(input);

    expect(projection.factoryId).not.toBe(erpWorkOrder.recordId);
    expect(projection.sourceRefs).toEqual([
      { system: "erpnext", objectType: "WorkOrder", recordId: "WO-MVP-001" }
    ]);
    expect(projection.authority).toBe("planning");
    expect(projection.metrics.plannedQuantity?.value).toBe(10);
    expect(projection.metrics.producedQuantity?.value).toBe(2);
    expect(projection.metrics.executionQuantity).toBeUndefined();
    expect(projection.metrics.canonicalCompletedQuantity).toBeUndefined();
    expect(input).toEqual(erpWorkOrder);
  });

  it("projects an unlinked MES Job without inferring an ERP source", () => {
    const projection = projectCarbonMesJob(carbonJob);

    expect(projection.authority).toBe("execution");
    expect(projection.linkStatus).toBe("unlinked");
    expect(projection.sourceRefs).toEqual([
      { system: "carbon-mes", objectType: "Job", recordId: "JOB-MVP-001" }
    ]);
    expect(projection.metrics.executionQuantity?.value).toBe(4);
    expect(projection.metrics.canonicalCompletedQuantity).toBeUndefined();
  });

  it("merges only an explicitly confirmed lineage", () => {
    const erp = projectErpNextWorkOrder(erpWorkOrder);
    const mes = projectCarbonMesJob(carbonJob);
    const result = mergeProductionOrderProjections(erp, mes, {
      status: "confirmed",
      erpSourceId: "WO-MVP-001",
      mesSourceId: "JOB-MVP-001",
      evidenceRefs: ["evidence-lineage-mvp"]
    });

    expect(result.status).toBe("merged");
    if (result.status !== "merged") return;
    expect(result.order.factoryId).not.toBe(erp.factoryId);
    expect(result.order.sourceRefs).toHaveLength(2);
    expect(result.order.authorities).toEqual({
      planning: true,
      execution: true
    });
    expect(result.order.evidenceRefs).toEqual(["evidence-lineage-mvp"]);
    expect(result.order.metrics.plannedQuantity?.value).toBe(10);
    expect(result.order.metrics.executionQuantity?.value).toBe(4);
    expect(result.order.itemRef?.recordId).toBe("ITEM-PUMP-001");
    expect(result.order.metrics.canonicalCompletedQuantity).toBeUndefined();
  });

  it("keeps unlinked and conflicting sources separate", () => {
    const erp = projectErpNextWorkOrder(erpWorkOrder);
    const mes = projectCarbonMesJob(carbonJob);

    expect(
      mergeProductionOrderProjections(erp, mes, {
        status: "unlinked",
        erpSourceId: "WO-MVP-001",
        mesSourceId: "JOB-MVP-001"
      }).status
    ).toBe("unlinked");

    const conflict = mergeProductionOrderProjections(erp, mes, {
      status: "conflict",
      erpSourceId: "WO-MVP-001",
      mesSourceId: "JOB-MVP-001"
    });
    expect(conflict.status).toBe("conflict");
    if (conflict.status === "conflict") {
      expect(conflict.erp.sourceRefs[0]?.recordId).toBe("WO-MVP-001");
      expect(conflict.mes.sourceRefs[0]?.recordId).toBe("JOB-MVP-001");
    }
  });

  it("does not merge a confirmed lineage with mismatched source IDs", () => {
    const result = mergeProductionOrderProjections(
      projectErpNextWorkOrder(erpWorkOrder),
      projectCarbonMesJob(carbonJob),
      {
        status: "confirmed",
        erpSourceId: "WO-OTHER",
        mesSourceId: "JOB-MVP-001"
      }
    );

    expect(result.status).toBe("conflict");
  });

  it("keeps mapping validation explicit", () => {
    const validation = validateProductionOrderMappings(
      productionOrderMappingRegistry
    );

    expect(validation.active).toBe(true);
    expect(validation.sourceTargetDefined).toBe(true);
    expect(validation.authorityDefined).toBe(true);
    expect(validation.transformDefined).toBe(true);
    expect(validation.confidenceKnown).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(
      productionOrderMappingRegistry.some(
        (mapping) => mapping.status !== "active"
      )
    ).toBe(true);

    const firstMapping = productionOrderMappingRegistry[0];
    if (!firstMapping) throw new Error("registry fixture is empty");
    const invalid = validateProductionOrderMappings([
      {
        ...firstMapping,
        source: { ...firstMapping.source, field: "" }
      }
    ]);
    expect(invalid.sourceTargetDefined).toBe(false);
    expect(invalid.errors).toContain("mapping source or target is undefined");
  });

  it("validates lineage and conflict states without resolving them", () => {
    const erp = projectErpNextWorkOrder(erpWorkOrder);
    const mes = projectCarbonMesJob(carbonJob);
    const merged = mergeProductionOrderProjections(erp, mes, {
      status: "confirmed",
      erpSourceId: "WO-MVP-001",
      mesSourceId: "JOB-MVP-001"
    });
    const conflict = mergeProductionOrderProjections(erp, mes, {
      status: "conflict",
      erpSourceId: "WO-MVP-001",
      mesSourceId: "JOB-MVP-001"
    });

    expect(validateProductionOrderMerge(merged)).toEqual({
      lineageConfirmed: true,
      conflictPresent: false
    });
    expect(validateProductionOrderMerge(conflict)).toEqual({
      lineageConfirmed: false,
      conflictPresent: true
    });
  });

  it("keeps unknown source states unknown and operations lineage-safe", () => {
    const projection = projectErpNextWorkOrder({
      ...erpWorkOrder,
      status: "Paused",
      operations: [
        {
          ...erpWorkOrder.operations?.[0],
          recordId: "WO-OP-001",
          status: "Not mapped"
        }
      ]
    });

    expect(projection.canonicalStatus).toBe("unknown");
    expect(projection.operations[0]?.lineageStatus).toBe("unknown");
    expect(projection.operations[0]?.canonicalStatus).toBe("unknown");
  });

  it("preserves the 1/1/0 quantity regression without fabricating progress", () => {
    const fixture = productionOrderGoldenPathFixtures.quantityRegression;
    expect(fixture.label).toBe("SCHEMA_VALIDATED_FIXTURE");
    expect(fixture.notProductionRecord).toBe(true);
    expect(fixture.sources.productionAggregate).toBe(1);
    expect(fixture.sources.operationQuantityComplete).toBe(1);
    expect(fixture.sources.jobQuantityComplete).toBe(0);
    expect(
      fixture.projection.metrics.canonicalCompletedQuantity
    ).toBeUndefined();
    expect(fixture.projection.canonicalProgress).toBeUndefined();
  });

  it("ships exactly three sanitized golden path fixtures", () => {
    expect(Object.keys(productionOrderGoldenPathFixtures)).toHaveLength(3);
    expect(
      Object.values(productionOrderGoldenPathFixtures).every(
        (fixture) => fixture.notProductionRecord
      )
    ).toBe(true);
  });
});
