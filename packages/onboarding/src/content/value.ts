// value content

// Headline numbers Carbon fills in per deal (fieldKey-backed, customer-locked).
// Default text reads as a prompt until staff set a real figure.
export interface ValueMetric {
  key: string; // base fieldKey; ".value" + ".label" are the two fill-ins
  value: string;
  label: string;
}

export const VALUE_METRICS: ValueMetric[] = [
  { key: "value.metric1", value: "Set a target", label: "Lead time" },
  { key: "value.metric2", value: "Set a target", label: "On-time delivery" },
  { key: "value.metric3", value: "Set a target", label: "Inventory accuracy" }
];

export const VALUE_PROBLEMS: string[] = [
  "Data scattered across spreadsheets and disconnected tools",
  "No single, trusted number for inventory or job status",
  "Re-keying between quoting, the floor, and finance",
  "Hard to see true cost or margin on a job"
];

export const VALUE_GOALS: string[] = [
  "One system from quote to cash",
  "Real-time inventory and shop-floor visibility",
  "Less manual work, fewer errors",
  "Room to grow without bolting on more tools"
];

export interface ValuePoint {
  title: string;
  body: string;
}

export const VALUE_POINTS: ValuePoint[] = [
  {
    title: "Less manual work",
    body: "Data flows through once instead of being re-keyed and reconciled across tools."
  },
  {
    title: "One set of numbers",
    body: "The floor and the office read the same inventory and cost figures."
  },
  {
    title: "Easier to extend",
    body: "Add the next capability on the same system instead of buying another tool."
  }
];
