export type RepairOrderLine = {
  id: string;
  lineNumber: number;
  itemId: string;
  quantity: number;
  status: string;
  underWarranty: boolean;
  warrantyRegistrationId: string | null;
  returnReasonId: string | null;
  closedComplete: boolean;
  item: {
    readableIdWithRevision: string | null;
    name: string | null;
    itemTrackingType: string | null;
  } | null;
  returnReason: { name: string } | null;
  repairOrderLineTrackedEntity: {
    trackedEntityId: string;
    quantity: number;
    trackedEntity: { readableId: string | null; status: string | null } | null;
  }[];
};

export type RepairOrderCharge = {
  id: string;
  repairOrderLineId: string | null;
  chargeType: string;
  itemId: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  billingCode: string;
  issuedAt: string | null;
  item: { readableIdWithRevision: string | null; name: string | null } | null;
};
