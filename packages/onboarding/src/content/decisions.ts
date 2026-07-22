import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { IntakeAnswers } from "./intake";

// The Decisions Log — the five decisions that cause expensive rework when they
// get made silently and wrong. Each takes about two minutes, has a recommended
// default, and one line on why it matters later. Every decision records who
// decided and when, and stays visible from then on: a factory that later asks
// "why are part numbers like this?" gets an answer instead of an argument.
//
// Decisions confirm intake answers where they overlap (authority order:
// a recorded decision outranks the raw answer).

export interface DecisionOption {
  value: string;
  label: MessageDescriptor;
  recommended?: boolean;
}

export interface DecisionDef {
  key: string; // stable, persisted in the decision row payload
  title: MessageDescriptor;
  why: MessageDescriptor;
  options: DecisionOption[];
  // Pre-select from the intake answer this decision confirms, when there is one.
  intakeDefault?: (answers: IntakeAnswers) => string | undefined;
}

export const DECISIONS: DecisionDef[] = [
  {
    key: "part-numbering",
    title: msg`Part numbering`,
    why: msg`Renumbering later touches every document, label, and spreadsheet you print. Keeping your existing numbers is almost always right.`,
    options: [
      {
        value: "keep",
        label: msg`Keep our existing part numbers`,
        recommended: true
      },
      { value: "new-scheme", label: msg`Adopt a new numbering scheme` }
    ]
  },
  {
    key: "costing",
    title: msg`How you cost your parts`,
    why: msg`Costing drives your quotes and margins. Start simple; refine once real jobs are flowing through Carbon.`,
    options: [
      {
        value: "standard",
        label: msg`Standard costs to start — refine as we go`,
        recommended: true
      },
      { value: "review", label: msg`We'll review with our accountant first` }
    ]
  },
  {
    key: "books",
    title: msg`Where the books live`,
    why: msg`Moving accounting mid-implementation is the single biggest scope change there is. Keeping your books where they are for day one is the safe start.`,
    options: [
      {
        value: "keep",
        label: msg`Keep them where they are, alongside Carbon`,
        recommended: true
      },
      { value: "move", label: msg`Run accounting in Carbon from day one` }
    ],
    intakeDefault: (answers) =>
      answers.books === "move" ? "move" : answers.books ? "keep" : undefined
  },
  {
    key: "tracking",
    title: msg`Lot and serial policy`,
    why: msg`Turning tracking on later means untracked history; turning it off later means wasted labels. Decide once, on purpose.`,
    options: [
      { value: "none", label: msg`No lot or serial tracking` },
      { value: "lots", label: msg`Track lots (batches)` },
      { value: "serials", label: msg`Track serial numbers` },
      { value: "both", label: msg`Track both` }
    ],
    intakeDefault: (answers) => answers.tracking
  },
  {
    key: "purchase-approvals",
    title: msg`Who approves purchases`,
    why: msg`An approval rule you never wrote down becomes a bottleneck you can't explain. Most factories start without one and add a threshold later.`,
    options: [
      {
        value: "none",
        label: msg`No approvals to start — anyone can buy`,
        recommended: true
      },
      { value: "owner", label: msg`The owner approves over a threshold` }
    ]
  }
];
