// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Who reaches the Implementation Hub. Carbon staff reach it in every company
// they belong to, enrolled or not, so they can set it up before anyone else
// sees it. The company's own people reach it only once the company is
// enrolled: enrolment is the moment the hub becomes visible to them.

import { DEFAULT_EXCLUSIONS } from "../content/registry";
import type { StateAction } from "../models";
import type { HubContacts, HubExclusions, HubStatus, Tier } from "../types";

export type HubAccess =
  // Enrolled: everyone in the company reaches the hub.
  | "enrolled"
  // Not enrolled, and the viewer is Carbon staff: only staff reach it.
  | "staffOnly"
  // Not enrolled, and the viewer is not Carbon staff: no hub.
  | "none";

export function hubAccess(enrolled: boolean, isInternal: boolean): HubAccess {
  if (enrolled) return "enrolled";
  return isInternal ? "staffOnly" : "none";
}

// The hub settings a company has before it is enrolled, as enrolment would
// create them: what Carbon staff see while they set up an unenrolled hub.
export const UNENROLLED_HUB: {
  tier: Tier;
  status: HubStatus;
  exclusions: HubExclusions;
  contacts: HubContacts;
} = {
  tier: "self_serve",
  status: "tailoring",
  exclusions: DEFAULT_EXCLUSIONS,
  contacts: {}
};

// The writes that touch only Implementation Hub 2.0 records: page files, their
// assignments and the priority set's own field values. Every other write
// changes records Implementation Hub 1.0 also reads (ticks, fill-in fields,
// rows, the hub row), so it is refused until the company uses 2.0, and a
// company on 1.0 keeps exactly the Implementation Hub it had.
const HUB_2_ONLY_INTENTS: ReadonlySet<StateAction["intent"]> = new Set<
  StateAction["intent"]
>(["setMemberPage", "deleteMemberPage", "setAssignee", "setPriority"]);

export function changesImplementationHub1(
  intent: StateAction["intent"]
): boolean {
  return !HUB_2_ONLY_INTENTS.has(intent);
}
