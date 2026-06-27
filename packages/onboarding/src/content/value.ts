// value content

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

// Headline numbers Carbon fills in per deal (fieldKey-backed, customer-locked).
// Default text reads as a prompt until staff set a real figure.
export interface ValueMetric {
  key: string; // base fieldKey; ".value" + ".label" are the two fill-ins
  value: MessageDescriptor;
  label: MessageDescriptor;
}

export const VALUE_METRICS: ValueMetric[] = [
  { key: "value.metric1", value: msg`Set a target`, label: msg`Lead time` },
  {
    key: "value.metric2",
    value: msg`Set a target`,
    label: msg`On-time delivery`
  },
  {
    key: "value.metric3",
    value: msg`Set a target`,
    label: msg`Inventory accuracy`
  }
];

export const VALUE_PROBLEMS: MessageDescriptor[] = [
  msg`Data scattered across spreadsheets and disconnected tools`,
  msg`No single, trusted number for inventory or job status`,
  msg`Re-keying between quoting, the floor, and finance`,
  msg`Hard to see true cost or margin on a job`
];

export const VALUE_GOALS: MessageDescriptor[] = [
  msg`One system from quote to cash`,
  msg`Real-time inventory and shop-floor visibility`,
  msg`Less manual work, fewer errors`,
  msg`Room to grow without bolting on more tools`
];

export interface ValuePoint {
  title: MessageDescriptor;
  body: MessageDescriptor;
}

export const VALUE_POINTS: ValuePoint[] = [
  {
    title: msg`Less manual work`,
    body: msg`Data flows through once instead of being re-keyed and reconciled across tools.`
  },
  {
    title: msg`One set of numbers`,
    body: msg`The floor and the office read the same inventory and cost figures.`
  },
  {
    title: msg`Easier to extend`,
    body: msg`Add the next capability on the same system instead of buying another tool.`
  }
];
