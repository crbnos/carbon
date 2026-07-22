import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type {
  IntakeAnswers,
  IntakeFlag
} from "../content/intake";
import { intakeFlag } from "../content/intake";
import { SETUP_GROUPS } from "../content/setup";
import type { Mod } from "../types";

// The tailoring engine: pure answers → what the plan shows, hides, and says.
// Computed at read time from the latest completed intake — never stored — so
// the plan can't drift from the answers. Two hard rules govern everything here:
//
// 1. Receipts are part of the contract. Anything hidden carries a one-line
//    "because you said…" wherever it would have appeared. If a hidden thing
//    can't explain itself, it isn't hidden — it's marked Later instead.
// 2. Authority order: observed product state > confirmed decision > intake
//    answer. A hide rule is suppressed when reality contradicts it (e.g. the
//    company runs accounting in Carbon), surfacing a conflict instead.

export type ComplexityBand = "simple" | "standard" | "complex";

export type SetupChip = "required" | "recommended" | "later";

export interface TailorReason {
  reason: MessageDescriptor;
}

export interface Tailoring {
  band: ComplexityBand;
  // Suggested end-to-end timeline in weeks for this band (books move adds time).
  suggestedWeeks: number;
  weeklyEffort: MessageDescriptor;
  flags: IntakeFlag[];
  // Modules the answers rule out entirely (pages, data rows, and tagged setup
  // rows all follow via the existing visibility layer).
  excludeModules: { mod: Mod; reason: MessageDescriptor }[];
  // Row-level hides beyond module exclusion, keyed by SetupRow.key.
  hiddenSetup: Map<string, MessageDescriptor>;
  // Rows that stay visible but collect into the do-it-later backlog.
  laterSetup: Map<string, MessageDescriptor>;
  // Rows the plan treats as required for activation.
  requiredSetup: Set<string>;
  // Payoff-screen receipt lines ("We hid the accounting group — your books
  // stay where they are").
  receipts: MessageDescriptor[];
  // Authority-order conflicts: a hide the answers wanted but reality overruled.
  conflicts: MessageDescriptor[];
}

export interface TailorContext {
  // Observed product state that outranks answers (authority order).
  accountingEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Complexity flags (intake template §4) — outreach signals, never blockers.
// ---------------------------------------------------------------------------

export function complexityFlags(answers: IntakeAnswers): IntakeFlag[] {
  const flags: IntakeFlag[] = [];
  if (answers.people === "100+") flags.push(intakeFlag("people-100"));
  if (answers.sites === "4+") flags.push(intakeFlag("sites-4"));
  if (
    (answers.tracking === "serials" ||
      answers.tracking === "lots" ||
      answers.tracking === "both") &&
    answers.trackingRequired
  ) {
    flags.push(intakeFlag("regulated-tracking"));
  }
  if (answers.quality === "regulated") {
    flags.push(intakeFlag("regulated-quality"));
  }
  if (answers.systems?.includes("legacy-erp")) {
    flags.push(intakeFlag("legacy-erp"));
    if (answers.books === "move") flags.push(intakeFlag("erp-and-books"));
  }
  if (answers.items === "over-10k") flags.push(intakeFlag("items-10k"));
  if (
    answers.weeklyHours === "few-hours" &&
    complexityBand(answers) === "complex"
  ) {
    flags.push(intakeFlag("effort-mismatch"));
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Complexity band → timeline + weekly effort (blueprint §14).
// ---------------------------------------------------------------------------

export function complexityBand(answers: IntakeAnswers): ComplexityBand {
  const complexSignals = [
    answers.systems?.includes("legacy-erp") ?? false,
    answers.sites === "4+",
    answers.quality === "regulated",
    answers.items === "1k-10k" || answers.items === "over-10k",
    (answers.tracking === "serials" || answers.tracking === "both") &&
      (answers.trackingRequired ?? false)
  ];
  if (complexSignals.some(Boolean)) return "complex";

  const simple =
    (answers.people === "1-10" || answers.people === undefined) &&
    (answers.sites === "one" || answers.sites === undefined) &&
    !(answers.systems ?? []).includes("legacy-erp") &&
    (answers.items === "under-100" || answers.items === undefined) &&
    (answers.quality === "informal" || answers.quality === undefined) &&
    answers.books !== "move";
  return simple ? "simple" : "standard";
}

// ~30 / ~60 / ~90 days, in weeks; moving the books at day one adds real weeks.
export function suggestedWeeks(answers: IntakeAnswers): number {
  const base = { simple: 5, standard: 9, complex: 13 }[complexityBand(answers)];
  return answers.books === "move" ? base + 3 : base;
}

const WEEKLY_EFFORT: Record<ComplexityBand, MessageDescriptor> = {
  simple: msg`2–3 hours a week`,
  standard: msg`3–5 hours a week`,
  complex: msg`5+ hours a week, plus champion time`
};

// ---------------------------------------------------------------------------
// The tailoring itself.
// ---------------------------------------------------------------------------

// Rows the plan treats as required regardless of answers — a factory can't
// activate without them.
const REQUIRED_BASE = [
  "company",
  "locations",
  "work-centers",
  "processes",
  "employees",
  "units",
  "parts",
  "customers",
  "suppliers"
];

const LATER_SMALL_TEAM = ["departments", "employee-types", "groups", "attributes"];
const LATER_FEW_ITEMS = [
  "material-substances",
  "material-shapes",
  "material-grades",
  "material-finishes",
  "material-dimensions",
  "material-types"
];
const LATER_ALWAYS = [
  "custom-fields",
  "approval-rules",
  "maintenance-schedules",
  "storage-rules"
];

export function tailorPlan(
  answers: IntakeAnswers,
  context: TailorContext = {}
): Tailoring {
  const excludeModules: Tailoring["excludeModules"] = [];
  const hiddenSetup = new Map<string, MessageDescriptor>();
  const laterSetup = new Map<string, MessageDescriptor>();
  const receipts: MessageDescriptor[] = [];
  const conflicts: MessageDescriptor[] = [];

  // Books stay put → the whole accounting group goes, with its receipt. The
  // observed product state outranks the answer: a company already running
  // accounting in Carbon keeps the group and gets a conflict card instead.
  if (answers.books !== "move") {
    if (context.accountingEnabled) {
      conflicts.push(
        msg`You said your books stay where they are, but accounting is already turned on in Carbon — so we kept the accounting setup visible. Confirm which way you want it.`
      );
    } else {
      excludeModules.push({
        mod: "acc",
        reason: msg`Hidden — your books stay where they are today. Moving them into Carbon is on your after-you're-live list.`
      });
      receipts.push(
        msg`No accounting setup — your books stay where they are today.`
      );
    }
  }

  // Informal quality → the quality module waits until after activation.
  if (answers.quality === "informal") {
    excludeModules.push({
      mod: "qms",
      reason: msg`Hidden — you told us quality is informal today. Turning on inspections is on your after-you're-live list.`
    });
    hiddenSetup.set(
      "failure-modes",
      msg`Hidden — you told us quality is informal today.`
    );
    receipts.push(msg`No quality setup — you run informal quality today.`);
  }

  // No custom quoting → no reasons-for-not-quoting to configure.
  const intake = answers.workIntake ?? [];
  if (intake.length > 0 && !intake.includes("quote")) {
    hiddenSetup.set(
      "no-quote-reasons",
      msg`Hidden — you don't quote custom work.`
    );
    receipts.push(msg`No quoting setup — work doesn't come in as quotes.`);
  }

  // No catalog / repeat business → price lists can wait for a first catalog.
  if (intake.length > 0 && !intake.includes("catalog")) {
    hiddenSetup.set(
      "price-lists",
      msg`Hidden — you don't sell repeat catalog orders.`
    );
    hiddenSetup.set(
      "pricing-rules",
      msg`Hidden — you don't sell repeat catalog orders.`
    );
    receipts.push(msg`No catalog pricing — you quote work fresh.`);
  }

  // Later markers — visible, deferred on purpose, never a failure.
  for (const key of LATER_ALWAYS) {
    laterSetup.set(key, msg`Later — useful, never a blocker for going live.`);
  }
  if (answers.people === "1-10") {
    for (const key of LATER_SMALL_TEAM) {
      laterSetup.set(
        key,
        msg`Later — with a team your size, this can wait until after you're live.`
      );
    }
  }
  if (answers.items === "under-100") {
    for (const key of LATER_FEW_ITEMS) {
      laterSetup.set(
        key,
        msg`Later — with under a hundred items, fine-grained material catalogs can wait.`
      );
    }
  }

  // A hidden row can't also be "later", and a required row can't be deferred.
  for (const key of hiddenSetup.keys()) laterSetup.delete(key);
  const requiredSetup = new Set(REQUIRED_BASE);
  for (const key of requiredSetup) laterSetup.delete(key);

  return {
    band: complexityBand(answers),
    suggestedWeeks: suggestedWeeks(answers),
    weeklyEffort: WEEKLY_EFFORT[complexityBand(answers)],
    flags: complexityFlags(answers),
    excludeModules,
    hiddenSetup,
    laterSetup,
    requiredSetup,
    receipts,
    conflicts
  };
}

// Chip for a Setup Map row under this tailoring.
export function chipForSetupRow(key: string, tailoring: Tailoring): SetupChip {
  if (tailoring.requiredSetup.has(key)) return "required";
  if (tailoring.laterSetup.has(key)) return "later";
  return "recommended";
}

// Counts for the payoff receipts line ("Your plan has 34 steps; we hid 21").
export function setupCounts(tailoring: Tailoring): {
  visible: number;
  hidden: number;
} {
  const excluded = new Set(tailoring.excludeModules.map((e) => e.mod));
  let visible = 0;
  let hidden = 0;
  for (const group of SETUP_GROUPS) {
    for (const row of group.rows) {
      const moduleHidden =
        row.moduleTags !== undefined &&
        row.moduleTags.length > 0 &&
        row.moduleTags.every((tag) => excluded.has(tag));
      if (moduleHidden || tailoring.hiddenSetup.has(row.key)) hidden += 1;
      else visible += 1;
    }
  }
  return { visible, hidden };
}
