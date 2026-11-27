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
  | "priority"
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
  priority: msg`Priority set`,
  custom: msg`Task`
};

// What a card asks of its person, the only type a page shows: something to do,
// a question to answer, a decision (in or out of scope), or something to
// learn. The kinds above stay for staff, in the catalogue picker and its
// export, where they tell apart cards with the same title.
export type PageCardType = "todo" | "question" | "decision" | "learn";

export const PAGE_CARD_TYPE: Record<PageCardKind, PageCardType> = {
  setup: "todo",
  task: "todo",
  step: "todo",
  data: "todo",
  training: "learn",
  cutover: "todo",
  requirement: "decision",
  objective: "todo",
  question: "question",
  customization: "todo",
  priority: "question",
  custom: "todo"
};

export const PAGE_CARD_TYPE_LABEL: Record<PageCardType, MessageDescriptor> = {
  todo: msg`To-do`,
  question: msg`Question`,
  decision: msg`Decision`,
  learn: msg`Learn`
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

// The priority set questionnaire as a card: answered on its own page, ticked
// done by hand like every other card.
export const PRIORITY_CARD = {
  item: "priority:questionnaire",
  title: msg`Answer the priority set questionnaire`,
  detail: msg`Which Carbon features your company needs before go-live, and which can wait.`,
  // The hub resolves this to the questionnaire page (resolveScreenUrl).
  screenKey: "get-started:priority-set"
};

// The evidence label next to a setup item's count ("4 in Carbon").
export const SETUP_EVIDENCE_LABEL = msg`in Carbon`;
// The evidence label next to an objective event's count ("2 so far").
export const OBJECTIVE_EVIDENCE_LABEL = msg`so far`;
