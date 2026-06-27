import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export interface VsPoint {
  lead: MessageDescriptor;
  body: MessageDescriptor;
}

// Internal positioning reference (Carbon-only page).
export const OTHER_STRENGTHS: VsPoint[] = [
  {
    lead: msg`Rigor and reassurance`,
    body: msg`A heavy, structured methodology that big, cautious buyers expect.`
  },
  {
    lead: msg`Breadth of legacy modules`,
    body: msg`Decades of niche features for edge-case industries.`
  },
  {
    lead: msg`Brand safety`,
    body: msg`"Nobody got fired for buying it." An incumbent comfort factor.`
  }
];

export const CARBON_STRENGTHS: VsPoint[] = [
  {
    lead: msg`Simplicity and speed`,
    body: msg`Live in weeks, not quarters. Most of the product is already built.`
  },
  {
    lead: msg`Ownership`,
    body: msg`Open source and extensible; you're not locked in.`
  },
  {
    lead: msg`Modern, connected core`,
    body: msg`One database from quote to cash, with AI-assisted setup and migration.`
  }
];
