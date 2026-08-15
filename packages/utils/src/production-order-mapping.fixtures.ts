import {
  type FactoryProductionOrder,
  mergeProductionOrderProjections,
  type ProductionOrderMergeResult,
  projectCarbonMesJob,
  projectErpNextWorkOrder
} from "./production-order-mapping";

export interface ProductionOrderGoldenPathFixture {
  label: "SCHEMA_VALIDATED_FIXTURE";
  notProductionRecord: true;
  scenario: "normal-linked" | "partial-completion" | "quantity-regression";
  sources: {
    productionAggregate: number;
    operationQuantityComplete: number;
    jobQuantityComplete: number;
  };
  projection: FactoryProductionOrder;
}

function merged(result: ProductionOrderMergeResult): FactoryProductionOrder {
  if (result.status !== "merged") {
    throw new Error(
      `Fixture requires confirmed lineage, received ${result.status}`
    );
  }
  return result.order;
}

const erpNormalSource = {
  recordId: "WO-MVP-FIXTURE-A",
  displayName: "Schema fixture normal order",
  itemRef: "ITEM-MVP-001",
  status: "Submitted",
  plannedQuantity: 10,
  unit: "EA",
  plannedStart: "2026-08-15T08:00:00Z",
  plannedFinish: "2026-08-15T16:00:00Z",
  requiredDate: "2026-08-16",
  operations: [
    {
      recordId: "WO-OP-MVP-A",
      sequence: 10,
      status: "Pending",
      plannedQuantity: 10
    }
  ]
} as const;
const erpNormal = projectErpNextWorkOrder(erpNormalSource);

const mesNormalSource = {
  recordId: "JOB-MVP-FIXTURE-A",
  displayName: "Schema fixture normal order",
  itemRef: "ITEM-MVP-001",
  status: "In Progress",
  plannedQuantity: 10,
  executionQuantity: 10,
  quantityComplete: 10,
  productionAggregate: 10,
  unit: "EA",
  operations: [
    {
      recordId: "JOB-OP-MVP-A",
      sequence: 10,
      status: "Done",
      operationQuantity: 10,
      quantityComplete: 10
    }
  ]
} as const;
const mesNormal = projectCarbonMesJob(mesNormalSource);

const erpPartialSource = {
  ...erpNormalSource,
  recordId: "WO-MVP-FIXTURE-B",
  plannedQuantity: 10
} as const;
const erpPartial = projectErpNextWorkOrder(erpPartialSource);

const mesPartialSource = {
  ...mesNormalSource,
  recordId: "JOB-MVP-FIXTURE-B",
  executionQuantity: 4,
  quantityComplete: 4,
  productionAggregate: 4
} as const;
const mesPartial = projectCarbonMesJob(mesPartialSource);

const erpRegressionSource = {
  ...erpNormalSource,
  recordId: "WO-MVP-FIXTURE-C",
  plannedQuantity: 1
} as const;
const erpRegression = projectErpNextWorkOrder(erpRegressionSource);

const mesRegressionSource = {
  ...mesNormalSource,
  recordId: "JOB-MVP-FIXTURE-C",
  plannedQuantity: 1,
  executionQuantity: 1,
  productionAggregate: 1,
  quantityComplete: 0,
  operations: [
    {
      recordId: "JOB-OP-MVP-C",
      sequence: 10,
      status: "In Progress",
      operationQuantity: 1,
      quantityComplete: 1
    }
  ]
} as const;
const mesRegression = projectCarbonMesJob(mesRegressionSource);

export const productionOrderGoldenPathFixtures = {
  normalLinked: {
    label: "SCHEMA_VALIDATED_FIXTURE",
    notProductionRecord: true,
    scenario: "normal-linked",
    sources: {
      productionAggregate: 10,
      operationQuantityComplete: 10,
      jobQuantityComplete: 10
    },
    projection: merged(
      mergeProductionOrderProjections(erpNormal, mesNormal, {
        status: "confirmed",
        erpSourceId: "WO-MVP-FIXTURE-A",
        mesSourceId: "JOB-MVP-FIXTURE-A",
        evidenceRefs: ["schema-fixture-lineage-a"]
      })
    )
  },
  partialCompletion: {
    label: "SCHEMA_VALIDATED_FIXTURE",
    notProductionRecord: true,
    scenario: "partial-completion",
    sources: {
      productionAggregate: 4,
      operationQuantityComplete: 4,
      jobQuantityComplete: 4
    },
    projection: merged(
      mergeProductionOrderProjections(erpPartial, mesPartial, {
        status: "confirmed",
        erpSourceId: "WO-MVP-FIXTURE-B",
        mesSourceId: "JOB-MVP-FIXTURE-B",
        evidenceRefs: ["schema-fixture-lineage-b"]
      })
    )
  },
  quantityRegression: {
    label: "SCHEMA_VALIDATED_FIXTURE",
    notProductionRecord: true,
    scenario: "quantity-regression",
    sources: {
      productionAggregate: 1,
      operationQuantityComplete: 1,
      jobQuantityComplete: 0
    },
    projection: merged(
      mergeProductionOrderProjections(erpRegression, mesRegression, {
        status: "confirmed",
        erpSourceId: "WO-MVP-FIXTURE-C",
        mesSourceId: "JOB-MVP-FIXTURE-C",
        evidenceRefs: ["schema-fixture-lineage-c"]
      })
    )
  }
} as const satisfies Record<string, ProductionOrderGoldenPathFixture>;
