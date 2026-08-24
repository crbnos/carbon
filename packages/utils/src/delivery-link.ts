export const DELIVERY_REF_SYSTEMS = [
  "sap-erp",
  "mes",
  "wms",
  "srm",
  "qms",
  "factory-os"
] as const;

export type DeliveryRefSystem = (typeof DELIVERY_REF_SYSTEMS)[number];

export interface DeliveryRef {
  system: DeliveryRefSystem;
  entity: string;
  id: string;
}

export type DeliveryLinkConfidence = "high" | "medium" | "low" | "unknown";

export type DeliveryLinkStatus =
  | "confirmed"
  | "inferred"
  | "conflict"
  | "unknown";

export interface DeliveryLink {
  fromRef: DeliveryRef;
  toRef: DeliveryRef;
  relationType: string;
  authority: DeliveryRefSystem;
  observedAt: string;
  confidence: DeliveryLinkConfidence;
  status: DeliveryLinkStatus;
  evidenceRefs: readonly string[];
  validFrom?: string;
  validTo?: string;
}

export interface DeliveryLinkValidation {
  isValid: boolean;
  errors: readonly string[];
}

export interface DeliveryLinkRegistry {
  links: readonly DeliveryLink[];
  find(
    fromRef: DeliveryRef,
    toRef: DeliveryRef,
    relationType: string
  ): DeliveryLink | undefined;
}

const validSystems = new Set<DeliveryRefSystem>(DELIVERY_REF_SYSTEMS);
const validConfidence = new Set<DeliveryLinkConfidence>([
  "high",
  "medium",
  "low",
  "unknown"
]);
const validStatus = new Set<DeliveryLinkStatus>([
  "confirmed",
  "inferred",
  "conflict",
  "unknown"
]);

const refKey = (ref: DeliveryRef): string =>
  `${ref.system}|${ref.entity}|${ref.id}`;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isValidDateTime = (value: unknown): boolean =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

const validateRef = (
  ref: DeliveryRef,
  label: "fromRef" | "toRef"
): string[] => {
  const errors: string[] = [];
  if (!ref || typeof ref !== "object") {
    errors.push(`${label} is required`);
    return errors;
  }
  if (!validSystems.has(ref.system)) {
    errors.push(`${label}.system is invalid`);
  }
  if (!isNonEmptyString(ref.entity)) {
    errors.push(`${label}.entity is required`);
  }
  if (!isNonEmptyString(ref.id)) {
    errors.push(`${label}.id is required`);
  }
  return errors;
};

export function validateDeliveryLink(
  link: DeliveryLink
): DeliveryLinkValidation {
  const errors: string[] = [];

  errors.push(...validateRef(link.fromRef, "fromRef"));
  errors.push(...validateRef(link.toRef, "toRef"));

  if (!isNonEmptyString(link.relationType)) {
    errors.push("relationType is required");
  }
  if (!validSystems.has(link.authority)) {
    errors.push("authority is invalid");
  }
  if (!isValidDateTime(link.observedAt)) {
    errors.push("observedAt is invalid");
  }
  if (!validConfidence.has(link.confidence)) {
    errors.push("confidence is invalid");
  }
  if (!validStatus.has(link.status)) {
    errors.push("status is invalid");
  }
  if (
    link.status === "confirmed" &&
    (!Array.isArray(link.evidenceRefs) || link.evidenceRefs.length === 0)
  ) {
    errors.push("evidenceRefs is required");
  }
  if (link.status === "confirmed" && link.authority === "factory-os") {
    errors.push("confirmed links require a non-Factory OS authority");
  }
  if (link.validFrom !== undefined && !isValidDateTime(link.validFrom)) {
    errors.push("validFrom is invalid");
  }
  if (link.validTo !== undefined && !isValidDateTime(link.validTo)) {
    errors.push("validTo is invalid");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export function buildDeliveryLinkRegistry(
  links: readonly DeliveryLink[]
): DeliveryLinkRegistry {
  const byKey = new Map<string, DeliveryLink>();

  for (const link of links) {
    const validation = validateDeliveryLink(link);
    if (!validation.isValid) {
      throw new Error(validation.errors.join("; "));
    }

    const key = `${refKey(link.fromRef)}|${refKey(link.toRef)}|${link.relationType}`;
    if (byKey.has(key)) {
      throw new Error(`duplicate delivery link: ${key}`);
    }
    byKey.set(key, link);
  }

  return {
    links: [...byKey.values()],
    find(fromRef, toRef, relationType) {
      return byKey.get(`${refKey(fromRef)}|${refKey(toRef)}|${relationType}`);
    }
  };
}
