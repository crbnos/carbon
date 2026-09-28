// Shared payload types: what the widget API returns per kind, consumed by the
// service (server) and the widget components (client).

export type StatPayload = {
  kind: "stat";
  value: number;
  /** Same measure over the previous window; absent for "as of now" stats. */
  previous?: number;
  /** A secondary count shown under the value (e.g. past-due backlog lines). */
  detail?: number;
  /** True when the denominator was empty, so 0 means "no data" not "0%". */
  empty?: boolean;
};

export type TrendPayload = {
  kind: "trend";
  points: { key: string; label: string; value: number }[];
};

export type BreakdownPayload = {
  kind: "breakdown";
  rows: { name: string; value: number; to?: string }[];
};

/** Which record a list row is, so the widget renders that entity's Status wrapper. */
export type ListRowEntity =
  | "salesOrder"
  | "quote"
  | "salesRfq"
  | "purchaseOrder"
  | "job";

export type ListPayload = {
  kind: "list";
  rows: {
    id: string;
    entity: ListRowEntity;
    title: string;
    subtitle?: string;
    status?: string;
    date?: string;
    to: string;
  }[];
};

export type WidgetPayload =
  | StatPayload
  | TrendPayload
  | BreakdownPayload
  | ListPayload;
