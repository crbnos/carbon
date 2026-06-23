/* Single source of truth for status enum → UI color across Carbon. The ERP renders
 * these via `@carbon/react`'s <Status color> (and Badge variants); the docs site renders
 * a colored dot from the same map, so the documentation can't drift from the app.
 *
 * Colors are the 7 semantic names the Status/Badge components accept — framework-agnostic,
 * so the standalone docs site can consume them too. `STATUS_COLOR_HEX` gives a representative
 * solid hex per name (matching the Status/Badge hues) for a dot/indicator.
 *
 * Each entity's map is grounded in its ERP `*Status.tsx` component; that component imports its
 * map from here (keeping its own icon / display-text / conditional logic). */

export type StatusColor =
  | "green"
  | "orange"
  | "red"
  | "yellow"
  | "blue"
  | "gray"
  | "purple";

export const STATUS_COLOR_HEX: Record<StatusColor, string> = {
  green: "#10b981",
  orange: "#f97316",
  red: "#ef4444",
  yellow: "#eab308",
  blue: "#3b82f6",
  gray: "#8b8985",
  purple: "#8b5cf6"
};

export const JOB_STATUS_COLOR_MAP = {
  Draft: "gray",
  Planned: "yellow",
  Ready: "blue",
  "In Progress": "orange",
  Paused: "orange",
  "Due Today": "orange",
  Completed: "green",
  Closed: "gray",
  Overdue: "red",
  Cancelled: "red"
} as const satisfies Record<string, StatusColor>;

export const QUOTE_STATUS_COLOR_MAP = {
  Draft: "gray",
  Sent: "blue",
  Ordered: "green",
  Partial: "green",
  Cancelled: "red",
  Expired: "red",
  Lost: "orange"
} as const satisfies Record<string, StatusColor>;

// salesOrderStatus — kept named SALES_STATUS_COLOR_MAP to match the existing ERP export.
export const SALES_STATUS_COLOR_MAP = {
  Draft: "gray",
  Cancelled: "red",
  Closed: "red",
  "To Ship and Invoice": "orange",
  "To Ship": "orange",
  "To Invoice": "blue",
  Confirmed: "blue",
  "Needs Approval": "yellow",
  "In Progress": "yellow",
  Invoiced: "gray",
  Completed: "green"
} as const satisfies Record<string, StatusColor>;

export const PURCHASE_ORDER_STATUS_COLOR_MAP = {
  Draft: "gray",
  Planned: "yellow",
  "To Review": "yellow",
  "Needs Approval": "yellow",
  "To Receive": "orange",
  "To Receive and Invoice": "orange",
  "To Invoice": "blue",
  Completed: "green",
  Closed: "red",
  Rejected: "red"
} as const satisfies Record<string, StatusColor>;

export const RECEIPT_STATUS_COLOR_MAP = {
  Draft: "gray",
  Pending: "orange",
  Posted: "green",
  Voided: "red"
} as const satisfies Record<string, StatusColor>;

// Shipment adds a conditional "Invoiced" (blue) the component derives from a flag.
export const SHIPMENT_STATUS_COLOR_MAP = {
  Draft: "gray",
  Pending: "orange",
  Posted: "green",
  Voided: "red",
  Invoiced: "blue"
} as const satisfies Record<string, StatusColor>;

export const MAINTENANCE_DISPATCH_STATUS_COLOR_MAP = {
  Open: "gray",
  Assigned: "yellow",
  "In Progress": "blue",
  Completed: "green",
  Cancelled: "red"
} as const satisfies Record<string, StatusColor>;

export const FIXED_ASSET_STATUS_COLOR_MAP = {
  Draft: "gray",
  Active: "green",
  "Fully Depreciated": "yellow",
  Disposed: "red"
} as const satisfies Record<string, StatusColor>;

export const TRACKED_ENTITY_STATUS_COLOR_MAP = {
  Available: "green",
  Reserved: "gray",
  "On Hold": "orange",
  Rejected: "red",
  Consumed: "blue"
} as const satisfies Record<string, StatusColor>;

export const SALES_INVOICE_STATUS_COLOR_MAP = {
  Draft: "gray",
  Return: "gray",
  Submitted: "blue",
  Pending: "yellow",
  "Partially Paid": "yellow",
  Voided: "red",
  Overdue: "orange",
  "Credit Note Issued": "green",
  Paid: "green"
} as const satisfies Record<string, StatusColor>;

export const PURCHASE_INVOICE_STATUS_COLOR_MAP = {
  Draft: "gray",
  Open: "blue",
  Pending: "orange",
  "Partially Paid": "orange",
  Overdue: "red",
  Voided: "red",
  "Debit Note Issued": "green",
  Paid: "green"
} as const satisfies Record<string, StatusColor>;

export const SALES_RFQ_STATUS_COLOR_MAP = {
  Draft: "gray",
  "Ready for Quote": "green",
  Quoted: "blue",
  Closed: "red"
} as const satisfies Record<string, StatusColor>;

export const SUPPLIER_QUOTE_STATUS_COLOR_MAP = {
  Active: "green",
  Draft: "gray",
  Declined: "orange",
  Expired: "red",
  Cancelled: "red"
} as const satisfies Record<string, StatusColor>;

export const PURCHASING_RFQ_STATUS_COLOR_MAP = {
  Draft: "gray",
  Requested: "green",
  Closed: "red"
} as const satisfies Record<string, StatusColor>;

export const ISSUE_STATUS_COLOR_MAP = {
  Registered: "gray",
  "In Progress": "blue",
  Closed: "green"
} as const satisfies Record<string, StatusColor>;

export const JOURNAL_ENTRY_STATUS_COLOR_MAP = {
  Draft: "gray",
  Posted: "green",
  Reversed: "red"
} as const satisfies Record<string, StatusColor>;

export const RISK_STATUS_COLOR_MAP = {
  Open: "gray",
  "In Review": "blue",
  Mitigating: "orange",
  Accepted: "green",
  Closed: "red"
} as const satisfies Record<string, StatusColor>;

export const STOCK_TRANSFER_STATUS_COLOR_MAP = {
  Draft: "gray",
  Released: "orange",
  "In Progress": "blue",
  Completed: "green"
} as const satisfies Record<string, StatusColor>;

export const GAUGE_STATUS_COLOR_MAP = {
  Active: "gray",
  Inactive: "red"
} as const satisfies Record<string, StatusColor>;

export const GAUGE_CALIBRATION_STATUS_COLOR_MAP = {
  Pending: "orange",
  "In-Calibration": "green",
  "Out-of-Calibration": "red"
} as const satisfies Record<string, StatusColor>;

export const GAUGE_ROLE_COLOR_MAP = {
  Master: "blue",
  Standard: "gray"
} as const satisfies Record<string, StatusColor>;

/* Registry keyed by a short entity id — lets a generic consumer (e.g. the docs StatusFlow)
 * resolve a status name to its color without importing each map by hand. */
export const statusColorMaps = {
  job: JOB_STATUS_COLOR_MAP,
  quote: QUOTE_STATUS_COLOR_MAP,
  salesOrder: SALES_STATUS_COLOR_MAP,
  purchaseOrder: PURCHASE_ORDER_STATUS_COLOR_MAP,
  receipt: RECEIPT_STATUS_COLOR_MAP,
  shipment: SHIPMENT_STATUS_COLOR_MAP,
  maintenanceDispatch: MAINTENANCE_DISPATCH_STATUS_COLOR_MAP,
  fixedAsset: FIXED_ASSET_STATUS_COLOR_MAP,
  trackedEntity: TRACKED_ENTITY_STATUS_COLOR_MAP
} as const;

export type StatusEntity = keyof typeof statusColorMaps;

/** The semantic color for a status, or undefined if the status isn't in the entity's map. */
export function statusColor(
  entity: StatusEntity,
  status: string
): StatusColor | undefined {
  return (statusColorMaps[entity] as Record<string, StatusColor>)[status];
}

/** The solid hex for a status's dot/indicator, or undefined if unknown. */
export function statusColorHex(
  entity: StatusEntity,
  status: string
): string | undefined {
  const color = statusColor(entity, status);
  return color ? STATUS_COLOR_HEX[color] : undefined;
}
