// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The sales handover: what sales learned before the deal closed, as questions
// Carbon staff answer on the Handover page. Each answer is stored as the field
// `handover.<question key>`. A question with a destination is copied into the
// hub once by "Apply to hub" (see logic/handover.ts).
//
// The question set mirrors the handover questionnaire maintained outside this
// repo. Keep the two in step: a question added, renamed or dropped there is
// changed here too. Question keys are stored, so never reuse or rename one.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { gateDateKey, PLAN_START_KEY } from "../logic/timeline";
import type { Tier } from "../types";
import { SCOPE_GOAL_KEY } from "./scope";

// "list" is one item per line; a list with a rows destination becomes one row
// per line.
export type HandoverQuestionType =
  | "text"
  | "longText"
  | "date"
  | "tier"
  | "list";

export type HandoverRowCollection =
  | "requirement"
  | "data"
  | "question"
  | "objective";

export type HandoverContact = "owner" | "champion";

export type HandoverDestination =
  | { kind: "tier" }
  | { kind: "field"; fieldKey: string; label: MessageDescriptor }
  | { kind: "contact"; contact: HandoverContact }
  | { kind: "rows"; collection: HandoverRowCollection };

export interface HandoverQuestion {
  key: string; // stable, e.g. "deal.goLive"
  label: MessageDescriptor;
  help?: MessageDescriptor;
  type: HandoverQuestionType;
  destination?: HandoverDestination;
}

export interface HandoverSection {
  key: string;
  title: MessageDescriptor;
  questions: HandoverQuestion[];
}

export const TIER_OPTIONS: { value: Tier; label: MessageDescriptor }[] = [
  { value: "self_serve", label: msg`Self-serve` },
  { value: "guided", label: msg`Guided` },
  { value: "enterprise", label: msg`Enterprise` }
];

const CONTACT_LABEL: Record<HandoverContact, MessageDescriptor> = {
  owner: msg`Contacts: Project owner`,
  champion: msg`Contacts: Champion(s)`
};

const ROWS_LABEL: Record<HandoverRowCollection, MessageDescriptor> = {
  requirement: msg`Requirements, one per line`,
  data: msg`Data Migration Map, one per line`,
  question: msg`Open questions, one per line`,
  objective: msg`Objectives, one per line`
};

// Where an answer goes, as the Handover page shows it ("→ Scope: Goal").
export function destinationLabel(
  destination: HandoverDestination
): MessageDescriptor {
  switch (destination.kind) {
    case "tier":
      return msg`Setup & Controls: Engagement tier`;
    case "field":
      return destination.label;
    case "contact":
      return CONTACT_LABEL[destination.contact];
    case "rows":
      return ROWS_LABEL[destination.collection];
  }
}

export const HANDOVER_SECTIONS: HandoverSection[] = [
  {
    key: "deal",
    title: msg`Deal facts`,
    questions: [
      {
        key: "deal.tier",
        label: msg`Engagement tier`,
        type: "tier",
        destination: { kind: "tier" }
      },
      {
        key: "deal.fde",
        label: msg`Forward-deployed engineer included`,
        help: msg`Yes or no, and for how long.`,
        type: "text"
      },
      {
        key: "deal.contractStart",
        label: msg`Contract start date`,
        type: "date"
      },
      {
        key: "deal.planStart",
        label: msg`Planned project start`,
        help: msg`Usually the kickoff date. It anchors the Plan timeline.`,
        type: "date",
        destination: {
          kind: "field",
          fieldKey: PLAN_START_KEY,
          label: msg`Plan: Project start`
        }
      },
      {
        key: "deal.goLive",
        label: msg`Target go-live date`,
        type: "date",
        destination: {
          kind: "field",
          fieldKey: gateDateKey("gate:golive"),
          label: msg`Plan: Target go-live`
        }
      },
      {
        key: "deal.access",
        label: msg`Licence or source access`,
        help: msg`A cloud subscription, a commercial licence, or source access.`,
        type: "text"
      },
      {
        key: "deal.hosting",
        label: msg`Hosting needs`,
        help: msg`Cloud region, data residency, self-hosting, a government cloud.`,
        type: "text"
      }
    ]
  },
  {
    key: "promises",
    title: msg`What sales promised`,
    questions: [
      {
        key: "promises.features",
        label: msg`Features`,
        help: msg`One promise per line, in plain words.`,
        type: "list",
        destination: { kind: "rows", collection: "requirement" }
      },
      {
        key: "promises.integrations",
        label: msg`Integrations`,
        type: "list",
        destination: { kind: "rows", collection: "requirement" }
      },
      {
        key: "promises.dates",
        label: msg`Dates`,
        help: msg`For example: quoting live before the trade show.`,
        type: "list",
        destination: { kind: "rows", collection: "requirement" }
      },
      {
        key: "promises.services",
        label: msg`Services`,
        help: msg`For example: Carbon loads the item master.`,
        type: "list",
        destination: { kind: "rows", collection: "requirement" }
      }
    ]
  },
  {
    key: "company",
    title: msg`The company`,
    questions: [
      { key: "company.makes", label: msg`What they make`, type: "longText" },
      {
        key: "company.productionMode",
        label: msg`Production mode`,
        help: msg`Make-to-stock, make-to-order or engineer-to-order; high or low mix.`,
        type: "text"
      },
      { key: "company.headcount", label: msg`Headcount`, type: "text" },
      {
        key: "company.sites",
        label: msg`Sites`,
        help: msg`One site per line, with what happens there.`,
        type: "list"
      },
      { key: "company.funding", label: msg`Funding stage`, type: "text" }
    ]
  },
  {
    key: "why",
    title: msg`Why Carbon and why now`,
    questions: [
      {
        key: "why.trigger",
        label: msg`What triggered the search`,
        type: "longText"
      },
      { key: "why.pain", label: msg`The pain today`, type: "longText" },
      {
        key: "why.success",
        label: msg`Success, in their own words`,
        help: msg`One outcome per line, as they said it.`,
        type: "list",
        destination: { kind: "rows", collection: "objective" }
      },
      {
        key: "why.hardDates",
        label: msg`Hard dates`,
        help: msg`Audits, trade shows, the end of a contract on the current system.`,
        type: "list"
      }
    ]
  },
  {
    key: "people",
    title: msg`People`,
    questions: [
      { key: "people.decisionMaker", label: msg`Decision maker`, type: "text" },
      {
        key: "people.owner",
        label: msg`Day-to-day owner`,
        type: "text",
        destination: { kind: "contact", contact: "owner" }
      },
      {
        key: "people.leads",
        label: msg`Functional leads`,
        help: msg`Names and their areas, such as production, quality and finance.`,
        type: "text",
        destination: { kind: "contact", contact: "champion" }
      },
      {
        key: "people.salesCalls",
        label: msg`Who joined the sales calls`,
        type: "list"
      },
      {
        key: "people.sceptics",
        label: msg`Who is sceptical, and why`,
        type: "longText"
      }
    ]
  },
  {
    key: "systems",
    title: msg`Current systems`,
    questions: [
      {
        key: "systems.erp",
        label: msg`ERP or accounting system`,
        type: "text"
      },
      { key: "systems.cad", label: msg`CAD and PLM`, type: "text" },
      { key: "systems.qms", label: msg`Quality system`, type: "text" },
      {
        key: "systems.spreadsheets",
        label: msg`Spreadsheets they run on`,
        help: msg`One spreadsheet per line.`,
        type: "list",
        destination: { kind: "rows", collection: "data" }
      },
      {
        key: "systems.migrate",
        label: msg`Data that must migrate`,
        help: msg`One data set per line, such as open purchase orders.`,
        type: "list",
        destination: { kind: "rows", collection: "data" }
      },
      {
        key: "systems.integrations",
        label: msg`Integrations they expect`,
        help: msg`Integrations sales promised go under What sales promised.`,
        type: "list"
      }
    ]
  },
  {
    key: "product",
    title: msg`Product and process`,
    questions: [
      {
        key: "product.pilot",
        label: msg`Pilot product candidate`,
        help: msg`A real product to run end to end first.`,
        type: "text"
      },
      { key: "product.lines", label: msg`Product lines`, type: "list" },
      {
        key: "product.makeBuy",
        label: msg`Make versus buy`,
        type: "longText"
      },
      {
        key: "product.traceability",
        label: msg`Traceability`,
        help: msg`Lot or serial tracking, and how deep it goes.`,
        type: "longText"
      },
      {
        key: "product.compliance",
        label: msg`Compliance`,
        help: msg`Standards and certifications, such as ISO 9001.`,
        type: "longText"
      }
    ]
  },
  {
    key: "scope",
    title: msg`Scope`,
    questions: [
      {
        key: "scope.projectGoal",
        label: msg`Project goal`,
        help: msg`One or two sentences, shown as the goal on the Scope page.`,
        type: "longText",
        destination: {
          kind: "field",
          fieldKey: SCOPE_GOAL_KEY,
          label: msg`Scope: Goal`
        }
      },
      { key: "scope.modulesIn", label: msg`Modules in`, type: "text" },
      { key: "scope.modulesOut", label: msg`Modules out`, type: "text" },
      {
        key: "scope.replacing",
        label: msg`System being replaced`,
        type: "text"
      }
    ]
  },
  {
    key: "risks",
    title: msg`Risks`,
    questions: [
      { key: "risks.seen", label: msg`Risks sales saw`, type: "longText" },
      {
        key: "risks.openPoints",
        label: msg`Open points`,
        help: msg`Anything still to settle with the customer, one per line.`,
        type: "list",
        destination: { kind: "rows", collection: "question" }
      }
    ]
  },
  {
    key: "logistics",
    title: msg`Logistics`,
    questions: [
      {
        key: "logistics.kickoff",
        label: msg`Kickoff attendees`,
        type: "list"
      },
      { key: "logistics.timeZones", label: msg`Time zones`, type: "text" },
      { key: "logistics.language", label: msg`Language`, type: "text" },
      {
        key: "logistics.channel",
        label: msg`Channel`,
        help: msg`A shared chat channel, email, or both.`,
        type: "text"
      },
      { key: "logistics.cadence", label: msg`Meeting cadence`, type: "text" }
    ]
  },
  {
    key: "attachments",
    title: msg`Attachments`,
    questions: [
      {
        key: "attachments.links",
        label: msg`Links`,
        help: msg`The proposal, the order form, call recordings. One link per line.`,
        type: "list"
      }
    ]
  }
];

export const HANDOVER_QUESTIONS: HandoverQuestion[] = HANDOVER_SECTIONS.flatMap(
  (section) => section.questions
);
