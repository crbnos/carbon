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

export const contactsValidator = z.object({
  pocUserId: z.string().optional(),
  owner: z.string().optional(),
  champion: z.string().optional()
});

// The /x/get-started/state.toggle action payload, discriminated by intent.
export const stateActionValidator = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("setCheck"),
    itemKey: z.string().min(1),
    kind: stateKindValidator,
    value: z.string().min(1)
  }),
  z.object({
    intent: z.literal("setField"),
    fieldKey: z.string().min(1),
    value: z.string()
  }),
  z.object({
    intent: z.literal("addRow"),
    collection: z.string().min(1),
    payload: z.string() // JSON-encoded cells
  }),
  z.object({
    intent: z.literal("updateRow"),
    rowId: z.string().min(1),
    payload: z.string()
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
  })
]);

export type StateAction = z.infer<typeof stateActionValidator>;
