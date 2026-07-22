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
  ownerEmail: z.string().optional(),
  champion: z.string().optional()
});

// ---------------------------------------------------------------------------
// Intake ("Tell Us How You Run") — answers + persisted row payloads.
// Answers live as versioned snapshot rows in implementationRow (collection
// "intake"); transcripts as rows in collection "intakeTranscript". Everything
// optional: the wizard saves drafts as it goes and skip logic hides questions.
// ---------------------------------------------------------------------------

export const intakeAnswersValidator = z
  .object({
    product: z.string().max(500),
    people: z.enum(["1-10", "11-30", "31-100", "100+"]),
    sites: z.enum(["one", "2-3", "4+"]),
    workIntake: z.array(z.enum(["quote", "catalog", "configured", "forecast"])),
    customers: z.enum(["under-25", "25-250", "over-250"]),
    fulfillment: z.enum(["mto", "mts", "both"]),
    jobsPerMonth: z.enum(["under-20", "20-100", "over-100"]),
    tracking: z.enum(["none", "lots", "serials", "both"]),
    trackingRequired: z.boolean(),
    quality: z.enum(["informal", "inspect", "iso", "regulated"]),
    systems: z.array(
      z.enum(["spreadsheets", "books-app", "legacy-erp", "homegrown", "paper"])
    ),
    legacyErpName: z.string().max(200),
    books: z.enum(["keep", "move", "not-sure"]),
    items: z.enum(["under-100", "100-1k", "1k-10k", "over-10k"]),
    boms: z.enum(["spreadsheets", "cad", "old-erp", "heads"]),
    ownerName: z.string().max(200),
    ownerEmail: z.string().max(320),
    goLiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    weeklyHours: z.enum(["few-hours", "half-day", "day-plus"]),
    uploadPath: z.string().max(1000),
    uploadName: z.string().max(500)
  })
  .partial();

// An implementationRow payload in collection "intake" — one row per version;
// the latest completed row is the current truth, a draft row is the wizard's
// resumable in-progress state, and every completed row is a permanent snapshot.
export const intakeRowValidator = z.object({
  version: z.number().int().min(1),
  status: z.enum(["draft", "completed"]),
  answers: intakeAnswersValidator,
  band: z.enum(["simple", "standard", "complex"]).optional(),
  flags: z.array(z.string()).optional(),
  completedAt: z.string().optional()
});

// An implementationRow payload in collection "intakeTranscript" — every voice
// utterance and AI-clarifier exchange, persisted for Carbon's sales review.
export const intakeTranscriptRowValidator = z.object({
  intakeVersion: z.number().int().min(1),
  questionKey: z.string().min(1),
  source: z.enum(["voice", "clarifier"]),
  transcript: z.string().min(1)
});

export type IntakeRowPayload = z.infer<typeof intakeRowValidator>;
export type IntakeTranscriptRowPayload = z.infer<
  typeof intakeTranscriptRowValidator
>;

// The /x/get-started/intake action payload, discriminated by intent.
export const intakeActionValidator = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("saveDraft"),
    answers: z.string() // JSON-encoded IntakeAnswers
  }),
  z.object({
    intent: z.literal("complete"),
    answers: z.string() // JSON-encoded IntakeAnswers
  }),
  z.object({
    intent: z.literal("addTranscript"),
    questionKey: z.string().min(1),
    source: z.enum(["voice", "clarifier"]),
    transcript: z.string().min(1)
  })
]);

export type IntakeAction = z.infer<typeof intakeActionValidator>;

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
