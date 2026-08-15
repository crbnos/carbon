/**
 * Pure Factory OS semantic contracts.
 *
 * These types preserve source truth while providing a stable experience-layer
 * vocabulary for adapters, FIDS components and future governance surfaces.
 */

export type SourceSystem = "erpnext" | "carbon-mes" | "factory-os" | string;

export interface SourceReference {
  system: SourceSystem;
  objectType?: string;
  recordId?: string;
  field?: string;
  url?: string;
}

export type CanonicalStatus =
  | "normal"
  | "in-progress"
  | "completed"
  | "warning"
  | "blocked"
  | "critical"
  | "cancelled"
  | "unknown";

/** Backward-compatible runtime component name for the canonical status type. */
export type CanonicalStatusState = CanonicalStatus;

export type RiskLevel = "high" | "medium" | "low" | "none" | "unknown";

export type FactoryObjectType =
  | "production-order"
  | "operation"
  | "material"
  | "equipment"
  | "quality-event"
  | "sales-order"
  | "purchase-order"
  | "supplier"
  | "customer"
  | "unknown";

export interface FactoryObjectRef {
  id: string;
  type: FactoryObjectType;
}

export type RelationshipType =
  | "requests"
  | "requires"
  | "contains"
  | "executes-on"
  | "affects"
  | "supplied-by"
  | "unknown";

export interface FactoryObjectRelationship {
  type: RelationshipType;
  target: FactoryObjectRef;
  source?: SourceReference;
  confidence?: "confirmed" | "inferred" | "unknown";
}

export interface FactoryObject {
  /** Factory OS identity. This is not a source-system record ID. */
  id: string;
  type: FactoryObjectType;
  displayName?: string;
  sourceRefs: readonly SourceReference[];
  sourceState?: string;
  status?: CanonicalStatusState;
  risk?: RiskLevel;
  relationships?: readonly FactoryObjectRelationship[];
  metadata?: Readonly<Record<string, unknown>>;
  evidenceRefs?: readonly string[];
  actionRefs?: readonly string[];
}

export type EvidenceFreshness = "fresh" | "aging" | "stale" | "unknown";
export type EvidenceConfidence = "high" | "medium" | "low" | "unknown";

export interface EvidenceFact {
  label: string;
  value?: unknown;
  unit?: string;
  description?: string;
}

export interface EvidenceProvenance {
  sourceField?: string;
  version?: string;
  retrievalMechanism?: string;
  rule?: string;
  model?: string;
  tool?: string;
}

export interface EvidenceRecord {
  id: string;
  source: SourceReference;
  subject?: FactoryObjectRef;
  fact: EvidenceFact;
  observedAt?: string;
  retrievedAt?: string;
  freshness: EvidenceFreshness;
  version?: string;
  provenance?: EvidenceProvenance;
  confidence?: EvidenceConfidence;
}

/** A missing observation timestamp cannot be presented as fresh evidence. */
export function enforceEvidenceFreshness(
  record: EvidenceRecord
): EvidenceRecord {
  if (record.observedAt || record.retrievedAt) {
    return record;
  }

  return { ...record, freshness: "unknown" };
}

export type ExceptionType =
  | "material-shortage"
  | "production-delay"
  | "equipment"
  | "quality"
  | "safety"
  | "unknown";

export type ExceptionSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "unknown";

export type ExceptionLifecycle =
  | "open"
  | "acknowledged"
  | "investigating"
  | "decision-required"
  | "action-pending"
  | "resolved"
  | "dismissed"
  | "unknown";

export interface ExceptionFact {
  label: string;
  value?: unknown;
  unit?: string;
  description?: string;
}

export interface ExceptionInference {
  label: string;
  text: string;
  confidence?: EvidenceConfidence;
}

export interface ExceptionImpact {
  summary: string;
  affectedQuantity?: number;
  unit?: string;
}

export interface ExceptionOwner {
  id?: string;
  label: string;
}

export interface ExceptionRecommendation {
  id: string;
  text: string;
}

export interface FactoryException {
  id: string;
  type: ExceptionType;
  severity: ExceptionSeverity;
  subject: FactoryObjectRef;
  affectedObjects?: readonly FactoryObjectRef[];
  summary: string;
  facts: readonly ExceptionFact[];
  inferredCause?: ExceptionInference;
  impact?: ExceptionImpact;
  owner?: ExceptionOwner;
  evidenceRefs: readonly string[];
  recommendationRefs?: readonly string[];
  recommendations?: readonly ExceptionRecommendation[];
  actionRefs?: readonly string[];
  lifecycle: ExceptionLifecycle;
  createdAt?: string;
  updatedAt?: string;
}

export interface ErpJobSource {
  recordId: string;
  displayName?: string;
  status?: string;
}

export interface CarbonOperationSource {
  recordId: string;
  displayName?: string;
  status?: string;
  workCenterId?: string;
}

function factoryObjectId(type: FactoryObjectType, source: SourceReference) {
  return `${type}:${source.system}:${source.recordId ?? "unknown"}`;
}

function mapErpJobStatus(status?: string): CanonicalStatusState {
  if (status === "In Progress") return "in-progress";
  if (status === "Completed") return "completed";
  if (status === "Cancelled") return "cancelled";
  return "unknown";
}

function mapCarbonOperationStatus(status?: string): CanonicalStatusState {
  if (status === "In Progress") return "in-progress";
  if (status === "Done") return "completed";
  if (status === "Canceled") return "cancelled";
  return "unknown";
}

export function adaptErpJobToFactoryObject(input: ErpJobSource): FactoryObject {
  const source: SourceReference = {
    system: "erpnext",
    objectType: "Job",
    recordId: input.recordId
  };

  return {
    id: factoryObjectId("production-order", source),
    type: "production-order",
    displayName: input.displayName,
    sourceRefs: [source],
    sourceState: input.status,
    status: mapErpJobStatus(input.status)
  };
}

export function adaptCarbonOperationToFactoryObject(
  input: CarbonOperationSource
): FactoryObject {
  const operationSource: SourceReference = {
    system: "carbon-mes",
    objectType: "Operation",
    recordId: input.recordId
  };
  const sourceRefs: SourceReference[] = [operationSource];

  if (input.workCenterId) {
    sourceRefs.push({
      system: "carbon-mes",
      objectType: "WorkCenter",
      recordId: input.workCenterId
    });
  }

  const relationships = input.workCenterId
    ? [
        {
          type: "executes-on" as const,
          target: {
            id: `equipment:carbon-mes:${input.workCenterId}`,
            type: "equipment" as const
          },
          source: sourceRefs[1],
          confidence: "confirmed" as const
        }
      ]
    : undefined;

  return {
    id: factoryObjectId("operation", operationSource),
    type: "operation",
    displayName: input.displayName,
    sourceRefs,
    sourceState: input.status,
    status: mapCarbonOperationStatus(input.status),
    relationships
  };
}
