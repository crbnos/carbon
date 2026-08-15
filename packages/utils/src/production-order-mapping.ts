import type {
  CanonicalStatusState,
  FactoryObjectType,
  SourceReference
} from "./fids";

export type ProductionOrderLinkStatus =
  | "confirmed"
  | "unlinked"
  | "conflict"
  | "unknown";

export type ProductionOrderConfidence =
  | "CONFIRMED"
  | "HIGH_CONFIDENCE"
  | "PARTIAL"
  | "REQUIRES_DOMAIN_CONFIRMATION";

export type ProductionOrderAuthority =
  | "planning"
  | "execution"
  | "quality"
  | "unknown";

export type ProductionOrderRelation =
  | "released-to"
  | "derived-from"
  | "executes"
  | "contains";

export interface QuantityValue {
  value: number;
  unit?: string;
}

export interface ProductionReleaseOperation {
  sourceId: string;
  sequence?: number;
  plannedQuantity?: QuantityValue;
  operationQuantity?: QuantityValue;
}

export interface ProductionRelease {
  id: string;
  factoryObjectId: string;
  source: SourceReference;
  productionOrder: {
    sourceId: string;
    itemRef?: string;
    plannedQuantity?: QuantityValue;
  };
  operations?: readonly ProductionReleaseOperation[];
  plannedStart?: string;
  plannedFinish?: string;
  issuedAt?: string;
  version: "1.0" | "1";
}

export type ProductionOrderMappingStatus =
  | "active"
  | "requires-domain-confirmation"
  | "unknown";

export type ProductionOrderTransform =
  | "identity"
  | "source-state"
  | "source-reference"
  | "not-defined";

export interface ProductionOrderMetric {
  value: number;
  unit?: string;
  source: SourceReference;
  semantic: string;
  aggregationLevel: "order" | "operation";
  authority: ProductionOrderAuthority;
  confidence: ProductionOrderConfidence;
}

export interface ErpNextWorkOrderOperationSource {
  recordId: string;
  sequence?: number;
  status?: string;
  plannedQuantity?: number;
  workCenterRef?: string;
}

export interface CarbonMesJobOperationSource {
  recordId: string;
  sequence?: number;
  status?: string;
  operationQuantity?: number;
  quantityComplete?: number;
  workCenterRef?: string;
}

export interface ErpNextWorkOrderSource {
  recordId: string;
  displayName?: string;
  itemRef?: string;
  status?: string;
  plannedQuantity?: number;
  producedQuantity?: number;
  unit?: string;
  plannedStart?: string;
  plannedFinish?: string;
  requiredDate?: string;
  operations?: readonly ErpNextWorkOrderOperationSource[];
}

export interface CarbonMesJobSource {
  recordId: string;
  displayName?: string;
  itemRef?: string;
  status?: string;
  plannedQuantity?: number;
  executionQuantity?: number;
  productionAggregate?: number;
  quantityComplete?: number;
  quantityScrapped?: number;
  unit?: string;
  actualStart?: string;
  actualFinish?: string;
  operations?: readonly CarbonMesJobOperationSource[];
}

export interface ProductionOrderOperationProjection {
  factoryId: string;
  sourceRefs: readonly SourceReference[];
  sourceState?: string;
  canonicalStatus: CanonicalStatusState;
  lineageStatus: ProductionOrderLinkStatus;
  sequence?: number;
  metrics: {
    plannedQuantity?: ProductionOrderMetric;
    operationQuantity?: ProductionOrderMetric;
    operationCompletedQuantity?: ProductionOrderMetric;
  };
  workCenterRefs: readonly SourceReference[];
}

export interface ProductionOrderProjection {
  factoryId: string;
  type: Extract<FactoryObjectType, "production-order">;
  displayName?: string;
  sourceRefs: readonly SourceReference[];
  sourceSystem: "erpnext" | "carbon-mes";
  sourceState?: string;
  canonicalStatus: CanonicalStatusState;
  authority: ProductionOrderAuthority;
  linkStatus: ProductionOrderLinkStatus;
  itemRef?: SourceReference;
  dates: {
    plannedStart?: string;
    plannedFinish?: string;
    actualStart?: string;
    actualFinish?: string;
    requiredDate?: string;
  };
  metrics: {
    plannedQuantity?: ProductionOrderMetric;
    producedQuantity?: ProductionOrderMetric;
    executionQuantity?: ProductionOrderMetric;
    productionAggregate?: ProductionOrderMetric;
    jobQuantityComplete?: ProductionOrderMetric;
    scrapQuantity?: ProductionOrderMetric;
  };
  operations: readonly ProductionOrderOperationProjection[];
}

export interface ProductionOrderLineage {
  status: ProductionOrderLinkStatus;
  erpSourceId?: string;
  mesSourceId?: string;
  evidenceRefs?: readonly string[];
  relation?: ProductionOrderRelation;
  establishedBy?: string;
  establishedAt?: string;
  version?: string;
}

export interface FactoryProductionOrder {
  factoryId: string;
  type: Extract<FactoryObjectType, "production-order">;
  displayName?: string;
  sourceRefs: readonly SourceReference[];
  itemRef?: SourceReference;
  sourceStates: {
    planning?: string;
    execution?: string;
  };
  authorities: {
    planning: boolean;
    execution: boolean;
  };
  lineage: ProductionOrderLineage;
  evidenceRefs: readonly string[];
  canonicalStatus?: CanonicalStatusState;
  dates: ProductionOrderProjection["dates"];
  metrics: ProductionOrderProjection["metrics"];
  operations: readonly ProductionOrderOperationProjection[];
}

export type ProductionOrderMergeResult =
  | {
      status: "merged";
      order: FactoryProductionOrder;
      lineage: ProductionOrderLineage;
    }
  | {
      status: "unlinked" | "unknown" | "conflict";
      erp: ProductionOrderProjection;
      mes: ProductionOrderProjection;
      lineage: ProductionOrderLineage;
    };

export interface ProductionReleaseValidation {
  isValid: boolean;
  errors: readonly string[];
}

export interface SourceLineageValidation {
  isValid: boolean;
  errors: readonly string[];
}

export interface ProductionOrderContractValidation {
  productionRelease: ProductionReleaseValidation;
  sourceLineage: SourceLineageValidation;
}

const ERP_SOURCE = "erpnext" as const;
const MES_SOURCE = "carbon-mes" as const;

function factoryId(system: string, recordId: string) {
  return `production-order:factory-os:${system}:${recordId}`;
}

function mergedFactoryId(erpRecordId: string, mesRecordId: string) {
  return `production-order:factory-os:linked:${erpRecordId}:${mesRecordId}`;
}

function sourceRef(
  system: "erpnext" | "carbon-mes",
  objectType: string,
  recordId: string,
  field?: string
): SourceReference {
  return { system, objectType, recordId, ...(field ? { field } : {}) };
}

function isFiniteNonNegative(value?: number) {
  return value === undefined || (Number.isFinite(value) && value >= 0);
}

export function validateProductionRelease(
  release: ProductionRelease
): ProductionReleaseValidation {
  const errors: string[] = [];
  const supportedVersions = ["1", "1.0"] as const;

  if (!release.id) {
    errors.push("release id is required");
  }
  if (!release.factoryObjectId) {
    errors.push("factoryObjectId is required");
  }
  if (!release.source.recordId) {
    errors.push("release source recordId is required");
  }
  if (!release.productionOrder.sourceId) {
    errors.push("productionOrder sourceId is required");
  }
  if (
    release.productionOrder.plannedQuantity &&
    !isFiniteNonNegative(release.productionOrder.plannedQuantity.value)
  ) {
    errors.push(
      "productionOrder plannedQuantity must be finite and non-negative"
    );
  }
  if (release.operations) {
    for (const operation of release.operations) {
      if (!operation.sourceId) {
        errors.push("operation sourceId is required");
      }
      if (
        operation.plannedQuantity &&
        !isFiniteNonNegative(operation.plannedQuantity.value)
      ) {
        errors.push(
          `operation plannedQuantity must be finite and non-negative (${operation.sourceId})`
        );
      }
      if (
        operation.operationQuantity &&
        !isFiniteNonNegative(operation.operationQuantity.value)
      ) {
        errors.push(
          `operation operationQuantity must be finite and non-negative (${operation.sourceId})`
        );
      }
    }
  }

  if (!supportedVersions.includes(release.version)) {
    errors.push("productionRelease version is unsupported");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export function validateProductionOrderSourceLineage(
  lineage: ProductionOrderLineage
): SourceLineageValidation {
  const errors: string[] = [];

  const status = lineage.status;
  if (
    status === "confirmed" &&
    (!lineage.erpSourceId || !lineage.mesSourceId)
  ) {
    errors.push("confirmed lineage requires both erpSourceId and mesSourceId");
  }
  if (
    lineage.relation &&
    !["released-to", "derived-from", "executes", "contains"].includes(
      lineage.relation
    )
  ) {
    errors.push("lineage relation is invalid");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export function validateProductionOrderContract(
  release: ProductionRelease,
  lineage: ProductionOrderLineage
): ProductionOrderContractValidation {
  const productionRelease = validateProductionRelease(release);
  const sourceLineage = validateProductionOrderSourceLineage(lineage);

  return {
    productionRelease,
    sourceLineage
  };
}

function mapErpStatus(status?: string): CanonicalStatusState {
  if (status === "Completed") return "completed";
  if (status === "Cancelled") return "cancelled";
  if (status === "In Process" || status === "In Progress") return "in-progress";
  return "unknown";
}

function mapMesStatus(status?: string): CanonicalStatusState {
  if (status === "Done" || status === "Completed") return "completed";
  if (status === "Canceled" || status === "Cancelled") return "cancelled";
  if (status === "In Progress") return "in-progress";
  return "unknown";
}

function metric(
  value: number | undefined,
  source: SourceReference,
  semantic: string,
  authority: ProductionOrderAuthority,
  aggregationLevel: "order" | "operation",
  unit?: string
): ProductionOrderMetric | undefined {
  if (value === undefined) return undefined;
  return {
    value,
    unit,
    source,
    semantic,
    authority,
    aggregationLevel,
    confidence: "CONFIRMED"
  };
}

function operationFactoryId(system: string, recordId: string) {
  return `operation:factory-os:${system}:${recordId}`;
}

function projectErpOperation(
  operation: ErpNextWorkOrderOperationSource,
  unit?: string
): ProductionOrderOperationProjection {
  const operationSource = sourceRef(
    ERP_SOURCE,
    "WorkOrderOperation",
    operation.recordId
  );
  const workCenterRefs = operation.workCenterRef
    ? [sourceRef(ERP_SOURCE, "Workstation", operation.workCenterRef)]
    : [];

  return {
    factoryId: operationFactoryId(ERP_SOURCE, operation.recordId),
    sourceRefs: [operationSource],
    sourceState: operation.status,
    canonicalStatus: mapErpStatus(operation.status),
    lineageStatus: "unknown",
    sequence: operation.sequence,
    metrics: {
      plannedQuantity: metric(
        operation.plannedQuantity,
        { ...operationSource, field: "plannedQuantity" },
        "planned quantity",
        "planning",
        "operation",
        unit
      )
    },
    workCenterRefs
  };
}

function projectMesOperation(
  operation: CarbonMesJobOperationSource,
  unit?: string
): ProductionOrderOperationProjection {
  const operationSource = sourceRef(
    MES_SOURCE,
    "JobOperation",
    operation.recordId
  );
  const workCenterRefs = operation.workCenterRef
    ? [sourceRef(MES_SOURCE, "WorkCenter", operation.workCenterRef)]
    : [];

  return {
    factoryId: operationFactoryId(MES_SOURCE, operation.recordId),
    sourceRefs: [operationSource],
    sourceState: operation.status,
    canonicalStatus: mapMesStatus(operation.status),
    lineageStatus: "unknown",
    sequence: operation.sequence,
    metrics: {
      operationQuantity: metric(
        operation.operationQuantity,
        { ...operationSource, field: "operationQuantity" },
        "operation quantity",
        "execution",
        "operation",
        unit
      ),
      operationCompletedQuantity: metric(
        operation.quantityComplete,
        { ...operationSource, field: "quantityComplete" },
        "operation completed quantity",
        "execution",
        "operation",
        unit
      )
    },
    workCenterRefs
  };
}

export function projectErpNextWorkOrder(
  input: ErpNextWorkOrderSource
): ProductionOrderProjection {
  const source = sourceRef(ERP_SOURCE, "WorkOrder", input.recordId);

  return {
    factoryId: factoryId(ERP_SOURCE, input.recordId),
    type: "production-order",
    displayName: input.displayName,
    sourceRefs: [source],
    sourceSystem: ERP_SOURCE,
    sourceState: input.status,
    canonicalStatus: mapErpStatus(input.status),
    authority: "planning",
    linkStatus: "unlinked",
    itemRef: input.itemRef
      ? sourceRef(ERP_SOURCE, "Item", input.itemRef, "production_item")
      : undefined,
    dates: {
      plannedStart: input.plannedStart,
      plannedFinish: input.plannedFinish,
      requiredDate: input.requiredDate
    },
    metrics: {
      plannedQuantity: metric(
        input.plannedQuantity,
        { ...source, field: "qty" },
        "planned quantity",
        "planning",
        "order",
        input.unit
      ),
      producedQuantity: metric(
        input.producedQuantity,
        { ...source, field: "produced_qty" },
        "ERPNext produced quantity source fact",
        "planning",
        "order",
        input.unit
      )
    },
    operations: (input.operations ?? []).map((operation) =>
      projectErpOperation(operation, input.unit)
    )
  };
}

export function projectCarbonMesJob(
  input: CarbonMesJobSource
): ProductionOrderProjection {
  const source = sourceRef(MES_SOURCE, "Job", input.recordId);

  return {
    factoryId: factoryId(MES_SOURCE, input.recordId),
    type: "production-order",
    displayName: input.displayName,
    sourceRefs: [source],
    sourceSystem: MES_SOURCE,
    sourceState: input.status,
    canonicalStatus: mapMesStatus(input.status),
    authority: "execution",
    linkStatus: "unlinked",
    itemRef: input.itemRef
      ? sourceRef(MES_SOURCE, "Item", input.itemRef, "itemId")
      : undefined,
    dates: {
      actualStart: input.actualStart,
      actualFinish: input.actualFinish
    },
    metrics: {
      plannedQuantity: metric(
        input.plannedQuantity,
        { ...source, field: "quantity" },
        "planned quantity copied into Carbon Job",
        "planning",
        "order",
        input.unit
      ),
      executionQuantity: metric(
        input.executionQuantity,
        { ...source, field: "executionQuantity" },
        "execution quantity",
        "execution",
        "order",
        input.unit
      ),
      productionAggregate: metric(
        input.productionAggregate,
        { ...source, field: "productionAggregate" },
        "production aggregate",
        "execution",
        "order",
        input.unit
      ),
      jobQuantityComplete: metric(
        input.quantityComplete,
        { ...source, field: "quantityComplete" },
        "Carbon Job quantity complete",
        "execution",
        "order",
        input.unit
      ),
      scrapQuantity: metric(
        input.quantityScrapped,
        { ...source, field: "quantityScrapped" },
        "scrap quantity",
        "execution",
        "order",
        input.unit
      )
    },
    operations: (input.operations ?? []).map((operation) =>
      projectMesOperation(operation, input.unit)
    )
  };
}

function sourceRecordId(projection: ProductionOrderProjection) {
  return projection.sourceRefs[0]?.recordId;
}

export function mergeProductionOrderProjections(
  erp: ProductionOrderProjection,
  mes: ProductionOrderProjection,
  lineage?: ProductionOrderLineage
): ProductionOrderMergeResult {
  const resolvedLineage: ProductionOrderLineage = {
    relation: "derived-from",
    version: "1.0",
    status: lineage?.status ?? "unlinked",
    ...lineage,
    erpSourceId: lineage?.erpSourceId ?? sourceRecordId(erp),
    mesSourceId: lineage?.mesSourceId ?? sourceRecordId(mes)
  };
  const idsMatch =
    resolvedLineage.erpSourceId === sourceRecordId(erp) &&
    resolvedLineage.mesSourceId === sourceRecordId(mes);

  if (resolvedLineage.status === "confirmed" && !idsMatch) {
    return { status: "conflict", erp, mes, lineage: resolvedLineage };
  }

  if (erp.sourceSystem !== ERP_SOURCE || mes.sourceSystem !== MES_SOURCE) {
    return { status: "conflict", erp, mes, lineage: resolvedLineage };
  }

  if (resolvedLineage.status !== "confirmed") {
    return {
      status: resolvedLineage.status,
      erp,
      mes,
      lineage: resolvedLineage
    };
  }

  const order: FactoryProductionOrder = {
    factoryId: mergedFactoryId(
      resolvedLineage.erpSourceId ?? "unknown",
      resolvedLineage.mesSourceId ?? "unknown"
    ),
    type: "production-order",
    displayName: erp.displayName ?? mes.displayName,
    sourceRefs: [...erp.sourceRefs, ...mes.sourceRefs],
    sourceStates: {
      planning: erp.sourceState,
      execution: mes.sourceState
    },
    authorities: { planning: true, execution: true },
    lineage: resolvedLineage,
    evidenceRefs: resolvedLineage.evidenceRefs ?? [],
    itemRef: erp.itemRef ?? mes.itemRef,
    dates: {
      plannedStart: erp.dates.plannedStart,
      plannedFinish: erp.dates.plannedFinish,
      actualStart: mes.dates.actualStart,
      actualFinish: mes.dates.actualFinish,
      requiredDate: erp.dates.requiredDate
    },
    metrics: {
      plannedQuantity:
        erp.metrics.plannedQuantity ?? mes.metrics.plannedQuantity,
      producedQuantity: erp.metrics.producedQuantity,
      executionQuantity: mes.metrics.executionQuantity,
      productionAggregate: mes.metrics.productionAggregate,
      jobQuantityComplete: mes.metrics.jobQuantityComplete,
      scrapQuantity: mes.metrics.scrapQuantity
    },
    operations: [...erp.operations, ...mes.operations]
  };

  return { status: "merged", order, lineage: resolvedLineage };
}

export interface ProductionOrderMappingDefinition {
  source: {
    system: "erpnext" | "carbon-mes";
    entity: string;
    field: string;
  };
  target: { entity: "ProductionOrder" | "Operation"; field: string };
  authority: ProductionOrderAuthority;
  transform: ProductionOrderTransform;
  confidence: ProductionOrderConfidence;
  status: ProductionOrderMappingStatus;
}

export const productionOrderMappingRegistry: readonly ProductionOrderMappingDefinition[] =
  [
    {
      source: { system: ERP_SOURCE, entity: "WorkOrder", field: "name" },
      target: { entity: "ProductionOrder", field: "sourceRefs" },
      authority: "planning",
      transform: "source-reference",
      confidence: "CONFIRMED",
      status: "active"
    },
    {
      source: { system: MES_SOURCE, entity: "Job", field: "id" },
      target: { entity: "ProductionOrder", field: "sourceRefs" },
      authority: "execution",
      transform: "source-reference",
      confidence: "CONFIRMED",
      status: "active"
    },
    {
      source: { system: ERP_SOURCE, entity: "WorkOrder", field: "qty" },
      target: { entity: "ProductionOrder", field: "plannedQuantity" },
      authority: "planning",
      transform: "identity",
      confidence: "CONFIRMED",
      status: "active"
    },
    {
      source: { system: MES_SOURCE, entity: "Job", field: "quantityComplete" },
      target: { entity: "ProductionOrder", field: "jobQuantityComplete" },
      authority: "execution",
      transform: "identity",
      confidence: "REQUIRES_DOMAIN_CONFIRMATION",
      status: "requires-domain-confirmation"
    },
    {
      source: {
        system: MES_SOURCE,
        entity: "JobOperation",
        field: "quantityComplete"
      },
      target: { entity: "Operation", field: "operationCompletedQuantity" },
      authority: "execution",
      transform: "identity",
      confidence: "CONFIRMED",
      status: "active"
    },
    {
      source: { system: ERP_SOURCE, entity: "WorkOrder", field: "status" },
      target: { entity: "ProductionOrder", field: "sourceState" },
      authority: "planning",
      transform: "source-state",
      confidence: "CONFIRMED",
      status: "active"
    },
    {
      source: { system: MES_SOURCE, entity: "Job", field: "status" },
      target: { entity: "ProductionOrder", field: "sourceState" },
      authority: "execution",
      transform: "source-state",
      confidence: "CONFIRMED",
      status: "active"
    }
  ] as const;

export interface ProductionOrderMappingValidation {
  active: boolean;
  sourceTargetDefined: boolean;
  authorityDefined: boolean;
  transformDefined: boolean;
  confidenceKnown: boolean;
  errors: readonly string[];
}

export interface ProductionOrderSafetyValidation {
  lineageConfirmed: boolean;
  conflictPresent: boolean;
}

export function validateProductionOrderMerge(
  result: ProductionOrderMergeResult
): ProductionOrderSafetyValidation {
  return {
    lineageConfirmed:
      result.status === "merged" && result.lineage.status === "confirmed",
    conflictPresent:
      result.status === "conflict" || result.lineage.status === "conflict"
  };
}

export function validateProductionOrderMappings(
  mappings: readonly ProductionOrderMappingDefinition[]
): ProductionOrderMappingValidation {
  const errors: string[] = [];
  const validAuthorities: readonly ProductionOrderAuthority[] = [
    "planning",
    "execution",
    "quality",
    "unknown"
  ];
  const validTransforms: readonly ProductionOrderTransform[] = [
    "identity",
    "source-state",
    "source-reference",
    "not-defined"
  ];
  const validConfidences: readonly ProductionOrderConfidence[] = [
    "CONFIRMED",
    "HIGH_CONFIDENCE",
    "PARTIAL",
    "REQUIRES_DOMAIN_CONFIRMATION"
  ];
  const active = mappings.some((mapping) => mapping.status === "active");
  const sourceTargetDefined = mappings.every(
    (mapping) =>
      Boolean(
        mapping.source.system && mapping.source.entity && mapping.source.field
      ) && Boolean(mapping.target.entity && mapping.target.field)
  );
  const authorityDefined = mappings.every((mapping) =>
    validAuthorities.includes(mapping.authority)
  );
  const transformDefined = mappings.every(
    (mapping) =>
      validTransforms.includes(mapping.transform) &&
      mapping.transform !== "not-defined"
  );
  const confidenceKnown = mappings.every((mapping) =>
    validConfidences.includes(mapping.confidence)
  );

  if (!active) errors.push("no active mapping");
  if (!sourceTargetDefined)
    errors.push("mapping source or target is undefined");
  if (!authorityDefined) errors.push("mapping authority is undefined");
  if (!transformDefined) errors.push("mapping transform is undefined");
  if (!confidenceKnown) errors.push("mapping confidence is unknown");

  return {
    active,
    sourceTargetDefined,
    authorityDefined,
    transformDefined,
    confidenceKnown,
    errors
  };
}
