// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { OnboardingCountKey } from "../logic/status";

// What kind of thing a card on a person's page is. Every kind but `custom` is
// a hub item, placed by its catalogue key (logic/page.ts).
export type PageCardKind =
  | "setup"
  | "task"
  | "step"
  | "data"
  | "training"
  | "cutover"
  | "requirement"
  | "objective"
  | "question"
  | "customization"
  | "custom";

export type PageItemKind = Exclude<PageCardKind, "custom">;

export const PAGE_CARD_KIND_LABEL: Record<PageCardKind, MessageDescriptor> = {
  setup: msg`Setup`,
  task: msg`Task`,
  step: msg`Product step`,
  data: msg`Data`,
  training: msg`Training`,
  cutover: msg`Cutover`,
  requirement: msg`Requirement`,
  objective: msg`Objective`,
  question: msg`Open question`,
  customization: msg`Customization`,
  custom: msg`Task`
};

// What an operational task waits for, named in the card's "Needs" line. The
// counts are the ones in content/operational.ts readiness rules.
export const READINESS_LABEL: Partial<
  Record<OnboardingCountKey, MessageDescriptor>
> = {
  customers: msg`a customer`,
  items: msg`an item`,
  suppliers: msg`a supplier`,
  purchaseOrdersFinalized: msg`a sent purchase order`,
  routingOperations: msg`an operation in a bill of process`,
  workCenters: msg`a work center`,
  jobsReleased: msg`a released job`
};

// The evidence label next to a setup item's count ("4 in Carbon").
export const SETUP_EVIDENCE_LABEL = msg`in Carbon`;
// The evidence label next to an objective event's count ("2 so far").
export const OBJECTIVE_EVIDENCE_LABEL = msg`so far`;
