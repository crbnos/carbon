import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

// "Tell Us How You Run" — the tailoring intake. Seventeen questions maximum;
// with skip logic a typical factory answers 13–14. Every answer must visibly
// change the plan the customer sees thirty seconds later — that is the test
// each question has to pass to stay in this file.
//
// Design rules (from the intake template):
// - One question per screen, thumb-sized answers, plain factory language.
// - Never ask what the product can detect; never ask what can safely default.
// - "Not sure" is always a legal answer → recommended default + a decision to
//   confirm later. The customer is never stuck on a screen.
// - Nothing is locked in — the intake is re-runnable forever ("Retune my plan");
//   answers hide steps, they never delete work.
//
// Question keys are FOREVER (persisted in intake answer payloads).

export type PeopleBand = "1-10" | "11-30" | "31-100" | "100+";
export type SitesBand = "one" | "2-3" | "4+";
export type WorkIntake = "quote" | "catalog" | "configured" | "forecast";
export type CustomersBand = "under-25" | "25-250" | "over-250";
export type Fulfillment = "mto" | "mts" | "both";
export type JobsBand = "under-20" | "20-100" | "over-100";
export type Tracking = "none" | "lots" | "serials" | "both";
export type Quality = "informal" | "inspect" | "iso" | "regulated";
export type SystemToday =
  | "spreadsheets"
  | "books-app"
  | "legacy-erp"
  | "homegrown"
  | "paper";
export type BooksPlan = "keep" | "move" | "not-sure";
export type ItemsBand = "under-100" | "100-1k" | "1k-10k" | "over-10k";
export type BomsToday = "spreadsheets" | "cad" | "old-erp" | "heads";
export type WeeklyHours = "few-hours" | "half-day" | "day-plus";

// The full answer set. Everything optional — the wizard saves drafts as it goes
// and skip logic hides questions that don't apply.
export interface IntakeAnswers {
  product?: string;
  people?: PeopleBand;
  sites?: SitesBand;
  workIntake?: WorkIntake[];
  customers?: CustomersBand;
  fulfillment?: Fulfillment;
  jobsPerMonth?: JobsBand;
  tracking?: Tracking;
  trackingRequired?: boolean;
  quality?: Quality;
  systems?: SystemToday[];
  legacyErpName?: string;
  books?: BooksPlan;
  items?: ItemsBand;
  boms?: BomsToday;
  ownerName?: string;
  ownerEmail?: string;
  goLiveDate?: string; // YYYY-MM-DD
  weeklyHours?: WeeklyHours;
  // Storage path of the optional "upload anything you have" file.
  uploadPath?: string;
  uploadName?: string;
}

export type IntakeQuestionKind =
  | "text" // one-line free text
  | "single" // pick one
  | "multi" // pick all that apply
  | "owner" // name + email pair
  | "date" // date picker with a suggested default
  | "upload"; // optional drag-and-drop

export interface IntakeOption {
  value: string;
  label: MessageDescriptor;
  // Shown small under the option where a word of guidance earns its place.
  hint?: MessageDescriptor;
  // The recommended default — what "Not sure" resolves to.
  recommended?: boolean;
}

export interface IntakeQuestion {
  key: keyof IntakeAnswers | "owner" | "upload";
  section: MessageDescriptor;
  ask: MessageDescriptor;
  helper?: MessageDescriptor;
  kind: IntakeQuestionKind;
  options?: IntakeOption[];
  // Answer field for a follow-up toggle rendered on the same screen (Q8's
  // "required by a regulator?" — the only one).
  followUp?: {
    key: keyof IntakeAnswers;
    ask: MessageDescriptor;
  };
  // Free-text field rendered when a given option is selected (Q10's
  // "which one?" for a legacy system).
  detailFor?: { value: string; key: keyof IntakeAnswers; ask: MessageDescriptor };
  // Skip logic: return false to hide the question entirely for these answers.
  appliesTo?: (answers: IntakeAnswers) => boolean;
  // Whether "Not sure" is offered (it maps to the recommended option and is
  // recorded as a decision to confirm later).
  notSure?: boolean;
  optional?: boolean;
}

const SECTION_COMPANY = msg`Your company`;
const SECTION_SELL = msg`How you sell`;
const SECTION_MAKE = msg`How you make`;
const SECTION_TODAY = msg`What you run on today`;
const SECTION_TEAM = msg`Your team and timing`;

export const INTAKE_QUESTIONS: IntakeQuestion[] = [
  {
    key: "product",
    section: SECTION_COMPANY,
    ask: msg`What does your company make?`,
    helper: msg`One line is plenty — e.g. "custom hydraulic power units" or "sheet-metal enclosures."`,
    kind: "text"
  },
  {
    key: "people",
    section: SECTION_COMPANY,
    ask: msg`How many people work at the company?`,
    kind: "single",
    options: [
      { value: "1-10", label: msg`1–10` },
      { value: "11-30", label: msg`11–30` },
      { value: "31-100", label: msg`31–100` },
      { value: "100+", label: msg`More than 100` }
    ]
  },
  {
    key: "sites",
    section: SECTION_COMPANY,
    ask: msg`How many sites will run on Carbon?`,
    kind: "single",
    options: [
      { value: "one", label: msg`One` },
      { value: "2-3", label: msg`2–3` },
      { value: "4+", label: msg`4 or more` }
    ]
  },
  {
    key: "workIntake",
    section: SECTION_SELL,
    ask: msg`How does work come in?`,
    helper: msg`Pick all that apply.`,
    kind: "multi",
    options: [
      { value: "quote", label: msg`We quote custom work` },
      { value: "catalog", label: msg`Repeat orders of our catalog` },
      { value: "configured", label: msg`Configured products — options and variants` },
      { value: "forecast", label: msg`We build to our own plan or forecast` }
    ]
  },
  {
    key: "customers",
    section: SECTION_SELL,
    ask: msg`Roughly how many active customers?`,
    kind: "single",
    options: [
      { value: "under-25", label: msg`Under 25` },
      { value: "25-250", label: msg`25 to 250` },
      { value: "over-250", label: msg`Over 250` }
    ]
  },
  {
    key: "fulfillment",
    section: SECTION_MAKE,
    ask: msg`How do you fulfill most orders?`,
    kind: "single",
    options: [
      { value: "mto", label: msg`Make to order` },
      { value: "mts", label: msg`Make to stock` },
      { value: "both", label: msg`Both`, recommended: true }
    ],
    notSure: true
  },
  {
    key: "jobsPerMonth",
    section: SECTION_MAKE,
    ask: msg`How many jobs run in a typical month?`,
    kind: "single",
    options: [
      { value: "under-20", label: msg`Under 20` },
      { value: "20-100", label: msg`20 to 100` },
      { value: "over-100", label: msg`Over 100` }
    ]
  },
  {
    key: "tracking",
    section: SECTION_MAKE,
    ask: msg`Do you track lots or serial numbers?`,
    kind: "single",
    options: [
      { value: "none", label: msg`No`, recommended: true },
      { value: "lots", label: msg`Lots (batches)` },
      { value: "serials", label: msg`Serial numbers` },
      { value: "both", label: msg`Both` }
    ],
    followUp: {
      key: "trackingRequired",
      ask: msg`Is that required by your customers or a regulator?`
    },
    notSure: true
  },
  {
    key: "quality",
    section: SECTION_MAKE,
    ask: msg`What are your quality requirements?`,
    kind: "single",
    options: [
      { value: "informal", label: msg`Informal` },
      { value: "inspect", label: msg`We inspect, nothing certified` },
      { value: "iso", label: msg`ISO 9001 or similar` },
      { value: "regulated", label: msg`Regulated (AS9100, ISO 13485…)` }
    ]
  },
  {
    key: "systems",
    section: SECTION_TODAY,
    ask: msg`What runs the business today?`,
    helper: msg`Pick all that apply.`,
    kind: "multi",
    options: [
      { value: "spreadsheets", label: msg`Spreadsheets` },
      { value: "books-app", label: msg`An accounting app (QuickBooks, Xero…)` },
      { value: "legacy-erp", label: msg`A legacy ERP or MRP` },
      { value: "homegrown", label: msg`A homegrown system` },
      { value: "paper", label: msg`Mostly paper and memory` }
    ],
    detailFor: {
      value: "legacy-erp",
      key: "legacyErpName",
      ask: msg`Which one?`
    }
  },
  {
    key: "books",
    section: SECTION_TODAY,
    ask: msg`Where should your books live on day one?`,
    kind: "single",
    options: [
      {
        value: "keep",
        label: msg`Keep them where they are, alongside Carbon`,
        hint: msg`Recommended to start — moving the books can come later.`,
        recommended: true
      },
      { value: "move", label: msg`Run accounting in Carbon` },
      { value: "not-sure", label: msg`Not sure — recommend for me` }
    ],
    notSure: false
  },
  {
    key: "items",
    section: SECTION_TODAY,
    ask: msg`Roughly how many active items will live in Carbon?`,
    helper: msg`Active = made, bought, or sold in the last 12 months. Ignore the rest for now.`,
    kind: "single",
    options: [
      { value: "under-100", label: msg`Under 100` },
      { value: "100-1k", label: msg`100 to 1,000` },
      { value: "1k-10k", label: msg`1,000 to 10,000` },
      { value: "over-10k", label: msg`Over 10,000` }
    ]
  },
  {
    key: "boms",
    section: SECTION_TODAY,
    ask: msg`Where do your BOMs and routings live today?`,
    kind: "single",
    options: [
      { value: "spreadsheets", label: msg`Spreadsheets` },
      { value: "cad", label: msg`CAD or PLM (Onshape, SolidWorks…)` },
      { value: "old-erp", label: msg`In the old ERP` },
      { value: "heads", label: msg`Mostly in people's heads` }
    ]
  },
  {
    key: "owner",
    section: SECTION_TEAM,
    ask: msg`Who owns getting Carbon live?`,
    helper: msg`One owner beats a committee. Plan on this person giving it a few hours a week.`,
    kind: "owner"
  },
  {
    key: "goLiveDate",
    section: SECTION_TEAM,
    ask: msg`Pick your target go-live date.`,
    helper: msg`We've suggested a date based on factories like yours. Moving it later is allowed — it just asks why.`,
    kind: "date"
  },
  {
    key: "weeklyHours",
    section: SECTION_TEAM,
    ask: msg`How much time can your team give this per week?`,
    kind: "single",
    options: [
      { value: "few-hours", label: msg`A few hours` },
      { value: "half-day", label: msg`About half a day` },
      { value: "day-plus", label: msg`A day or more` }
    ]
  },
  {
    key: "upload",
    section: SECTION_TEAM,
    ask: msg`Upload anything you already have.`,
    helper: msg`Item list, BOM export, customer list — any spreadsheet, even messy. We'll do the reading. Skipping is fine.`,
    kind: "upload",
    optional: true
  }
];

// Complexity flags accumulate silently during the intake. They never block
// anything and never change the questions — they change what the payoff screen
// says (the honest Guided aside) and they surface to Carbon staff as outreach
// signals.
export type IntakeFlagKey =
  | "people-100"
  | "sites-4"
  | "regulated-tracking"
  | "regulated-quality"
  | "legacy-erp"
  | "erp-and-books"
  | "items-10k"
  | "effort-mismatch";

export interface IntakeFlag {
  key: IntakeFlagKey;
  label: MessageDescriptor;
}

const FLAG_LABELS: Record<IntakeFlagKey, MessageDescriptor> = {
  "people-100": msg`More than 100 people`,
  "sites-4": msg`Four or more sites`,
  "regulated-tracking": msg`Regulator-required tracking`,
  "regulated-quality": msg`Regulated quality (AS9100, ISO 13485…)`,
  "legacy-erp": msg`Leaving a legacy ERP`,
  "erp-and-books": msg`ERP exit and books move at the same time`,
  "items-10k": msg`Over 10,000 items`,
  "effort-mismatch": msg`Complex plan on a few hours a week`
};

export const intakeFlag = (key: IntakeFlagKey): IntakeFlag => ({
  key,
  label: FLAG_LABELS[key]
});
