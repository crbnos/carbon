export type PickPartial<T, K extends keyof T> = Omit<T, K> &
  Partial<Pick<T, K>>;

export interface TrackedEntityAttributes {
  "Batch Number"?: string;
  Customer?: string;
  Job?: string;
  "Job Make Method"?: string;

  "Purchase Order"?: string;
  "Receipt Line Index"?: number;
  "Receipt Line"?: string;
  Receipt?: string;
  Supplier?: string;
  "Serial Number"?: string;
  "Shipment Line Index"?: number;
  "Shipment Line"?: string;
  Shipment?: string;
  "Split Entity ID"?: string;
}

export interface TrackedActivityAttributes {
  "Consumed Quantity"?: number;
  "Job Make Method"?: string;
  "Job Material"?: string;
  "Job Operation"?: string;
  "Production Event"?: string;
  Job?: string;
  "Original Quantity"?: number;
  "Remaining Quantity"?: number;
  Employee?: string;
}
