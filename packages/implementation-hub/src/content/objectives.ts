// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { OnboardingCountKey } from "../logic/status";
import type { ObjectiveEvent } from "../types";

// The detectable events an objective can be tied to. The count is the
// objective's evidence: it shows that the event happened, but the objective is
// still ticked by a person.
export const OBJECTIVE_EVENTS: Record<
  ObjectiveEvent,
  { label: MessageDescriptor; countKey: OnboardingCountKey }
> = {
  quoteSent: { label: msg`First quote sent`, countKey: "quotesSent" },
  salesOrderConfirmed: {
    label: msg`First sales order confirmed`,
    countKey: "salesOrders"
  },
  purchaseOrderFinalized: {
    label: msg`First purchase order sent`,
    countKey: "purchaseOrdersFinalized"
  },
  receiptPosted: {
    label: msg`First goods received`,
    countKey: "postedReceipts"
  },
  jobReleased: {
    label: msg`First production job released`,
    countKey: "jobsReleased"
  },
  jobCompleted: {
    label: msg`First production job completed`,
    countKey: "completedJobs"
  }
};

export const OBJECTIVE_EVENT_KEYS = Object.keys(
  OBJECTIVE_EVENTS
) as ObjectiveEvent[];
