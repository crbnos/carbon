// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { z } from "zod";

// Validators for the editable layer. Plain zod (no zod-form-data) so the package
// stays framework-agnostic; ERP route actions wrap these with `validator(...)`.

export const tierValidator = z.enum(["self_serve", "guided", "enterprise"]);

export const hubStatusValidator = z.enum([
  "tailoring",
  "shared",
  "active",
  "complete",
  "archived"
]);

export const stateKindValidator = z.enum([
  "gate",
  "task",
  "check",
  "scopeFlag",
  "productStep",
  "fmt"
]);

export const moduleValidator = z.enum([
  "sal",
  "pur",
  "inv",
  "itm",
  "prd",
  "qms",
  "acc"
]);

export const exclusionsValidator = z.object({
  modules: z.array(moduleValidator).default([]),
  pages: z.array(z.string()).default([]),
  sections: z.array(z.string()).default([])
});

// Who wrote a tick or a row (implementationSource). Ticks use the first three.
export const sourceValidator = z.enum([
  "customer",
  "staff",
  "mcp",
  "handover",
  "interview"
]);

export const contactsValidator = z.object({
  pocUserId: z.string().optional(),
  owner: z.string().optional(),
  champion: z.string().optional()
});

// A person's hub page, as Carbon staff write it: a JSON file, loaded in the app
// or over MCP. Sections of cards, each card either a hub item by its catalogue
// key (`setup:locations`, `task:first-quote`, see logic/page.ts) or a custom
// card. Unknown keys are refused by `pageProblems`, not here: the catalogue
// includes the company's own rows, which a schema cannot know.
const pageText = z.string().trim().min(1);
const pageDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in the form YYYY-MM-DD");
const pageLink = z
  .string()
  .refine(
    (link) => link.startsWith("/x/") || /^https:\/\/\S+$/.test(link),
    "Use a Carbon path starting with /x/, or an https link"
  );

export const memberPageCustomCardValidator = z.strictObject({
  // Stable per page: a person's tick on a custom card is stored under it.
  key: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, digits and hyphens"),
  title: pageText.max(200),
  text: pageText.max(2000).optional(),
  link: pageLink.optional()
});

export const memberPageCardValidator = z
  .strictObject({
    item: pageText.optional(),
    custom: memberPageCustomCardValidator.optional(),
    // Overrides the hub item's own title. Custom cards carry their own.
    title: pageText.max(200).optional(),
    note: pageText.max(2000).optional(),
    due: pageDay.optional()
  })
  .superRefine((card, ctx) => {
    if (!card.item === !card.custom) {
      ctx.addIssue({
        code: "custom",
        message: "A card needs either an item or a custom card, not both"
      });
    }
    if (card.custom && card.title) {
      ctx.addIssue({
        code: "custom",
        path: ["title"],
        message: "A custom card takes its title inside custom"
      });
    }
  });

export const memberPageValidator = z.strictObject({
  version: z.literal(1),
  // The person's email. They must be an employee of the company.
  user: z.string().trim().toLowerCase().pipe(z.email()),
  title: pageText.max(200).optional(),
  intro: pageText.max(2000).optional(),
  sections: z
    .array(
      z.strictObject({
        title: pageText.max(200),
        intro: pageText.max(2000).optional(),
        cards: z.array(memberPageCardValidator).min(1)
      })
    )
    .min(1)
});

export type MemberPage = z.infer<typeof memberPageValidator>;
export type MemberPageCard = z.infer<typeof memberPageCardValidator>;

// The /x/get-started/state.toggle action payload, discriminated by intent.
export const stateActionValidator = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("setCheck"),
    itemKey: z.string().min(1),
    kind: stateKindValidator,
    value: z.string().min(1)
  }),
  z.object({
    intent: z.literal("setChecks"),
    itemKeys: z.string(), // JSON-encoded string[]
    kind: stateKindValidator,
    value: z.string().min(1)
  }),
  z.object({
    intent: z.literal("setField"),
    fieldKey: z.string().min(1),
    value: z.string()
  }),
  // Removes a fill-in field's value, so it reads as never filled in again.
  z.object({ intent: z.literal("clearField"), fieldKey: z.string().min(1) }),
  z.object({
    intent: z.literal("addRow"),
    collection: z.string().min(1),
    payload: z.string(), // JSON-encoded cells
    // Where the row came from, for discovery output. Only Carbon staff may set
    // a source other than their own (a handover answer, an interview finding).
    source: sourceValidator.optional(),
    sourceRef: z.string().optional()
  }),
  z.object({
    intent: z.literal("updateRow"),
    rowId: z.string().min(1),
    payload: z.string()
  }),
  // One answer to an open question: a typed answer, or the chosen options
  // (JSON-encoded string[]). The server sets the question's tick from it.
  z.object({
    intent: z.literal("answerQuestion"),
    rowId: z.string().min(1),
    answer: z.string().optional(),
    selected: z.string().optional()
  }),
  z.object({ intent: z.literal("deleteRow"), rowId: z.string().min(1) }),
  z.object({
    intent: z.literal("setExclusions"),
    exclusions: z.string() // JSON-encoded HubExclusions
  }),
  z.object({ intent: z.literal("setTier"), tier: tierValidator }),
  z.object({ intent: z.literal("setStatus"), status: hubStatusValidator }),
  z.object({
    intent: z.literal("setContacts"),
    contacts: z.string() // JSON-encoded HubContacts
  }),
  // Carbon staff verify (or un-verify) every tick of one gate at once.
  z.object({
    intent: z.literal("verifyGate"),
    gateKey: z.string().min(1),
    itemKeys: z.string() // JSON-encoded string[]: the gate's ticked items
  }),
  z.object({
    intent: z.literal("unverifyGate"),
    gateKey: z.string().min(1),
    itemKeys: z.string() // JSON-encoded string[]
  }),
  // One assignee per hub item. An empty assigneeId removes the assignment.
  z.object({
    intent: z.literal("setAssignee"),
    itemKey: z.string().min(1),
    assigneeId: z.string()
  }),
  // Carbon staff copy the sales handover's answers into the hub, once.
  z.object({ intent: z.literal("applyHandover") }),
  // Carbon staff load or replace a person's page (JSON-encoded MemberPage).
  z.object({ intent: z.literal("setMemberPage"), page: z.string().min(1) }),
  // Carbon staff remove a person's page; that person then sees an empty hub.
  z.object({
    intent: z.literal("deleteMemberPage"),
    userId: z.string().min(1)
  })
]);

export type StateAction = z.infer<typeof stateActionValidator>;
