import type { RampIntegrationMetadata } from "@carbon/ee/ramp.server";

export type RampInboundFamily =
  | "transactions"
  | "transfers"
  | "cashbacks"
  | "bills"
  | "billPayments"
  | "reimbursements"
  | "repayments";

export function isRampInboundFamilyEnabled(
  family: RampInboundFamily,
  sync: RampIntegrationMetadata["sync"]
): boolean {
  switch (family) {
    case "transactions":
    case "transfers":
    case "cashbacks":
      return sync.pullTransactions;
    case "bills":
    case "billPayments":
      return sync.pullBills;
    case "reimbursements":
    case "repayments":
      return sync.pullReimbursements;
  }
}

export function isRampEntityInScope(
  configuredEntityId: string | undefined,
  rowEntityId: string | null | undefined
): boolean {
  return configuredEntityId === undefined || rowEntityId === configuredEntityId;
}

export function rampEntityQuery(configuredEntityId: string | undefined): {
  entity_id?: string;
} {
  return configuredEntityId ? { entity_id: configuredEntityId } : {};
}
