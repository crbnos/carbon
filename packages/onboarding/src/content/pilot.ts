import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { IntakeAnswers } from "./intake";
import type { DetectSignal } from "../types";

// Prove It Works — never "UAT", never "acceptance testing". One real order,
// start to finish; every document the run creates checks itself off as it
// appears. This is the confidence event that breaks habit inertia: nobody
// abandons the old system on faith — they abandon it after watching the
// replacement handle their actual work.

export interface PilotStage {
  key: string; // stable; manual fallback check is check:pilot.<key>
  label: MessageDescriptor;
  detail: MessageDescriptor;
  // Self-verification: the stage checks itself when this signal fires. Manual
  // tick stays available (the product can't see everything).
  detect: DetectSignal | null;
  // The setup-row/screen key its deep link resolves through (same mapping as
  // the Setup Map), when one applies.
  screenKey?: string;
  // Stage applies only when this returns true for the factory's answers.
  appliesTo?: (answers: IntakeAnswers) => boolean;
}

export const PILOT_STAGES: PilotStage[] = [
  {
    key: "quote",
    label: msg`Quote it`,
    detail: msg`Price the order the way you actually would. Skip if this customer doesn't get quotes.`,
    detect: "hasQuote",
    appliesTo: (answers) => (answers.workIntake ?? []).includes("quote")
  },
  {
    key: "order",
    label: msg`Enter the sales order`,
    detail: msg`The real order, the real customer, the real quantities.`,
    detect: "hasSalesOrder"
  },
  {
    key: "job",
    label: msg`Make it a job with material demand`,
    detail: msg`The job carries the BOM — Carbon now knows what to buy and what to build.`,
    detect: "hasJob"
  },
  {
    key: "purchase",
    label: msg`Cut the purchase order`,
    detail: msg`To your real supplier — previewed, not sent. Nothing leaves the building.`,
    detect: "hasPurchaseOrder"
  },
  {
    key: "receive",
    label: msg`Receive the material`,
    detail: msg`Book it in the door; watch the stock appear.`,
    detect: "hasReceipt"
  },
  {
    key: "floor",
    label: msg`Run it at one floor station`,
    detail: msg`The shop-floor app, one work center, your floor champion pressing the buttons — the floor first sees Carbon working, not being trained on it.`,
    detect: "hasProductionEvent"
  },
  {
    key: "ship",
    label: msg`Ship it`,
    detail: msg`The shipment that closes the loop on the floor's work.`,
    detect: "hasShipment"
  },
  {
    key: "invoice",
    label: msg`Invoice it`,
    detail: msg`Previewed, never sent. The last document in the trace carries your numbers.`,
    detect: "hasInvoice"
  }
];

export const PILOT_COPY = {
  setupLead: msg`Pick one real, recently completed order — the bread-and-butter one, explicitly not the weird one. The trace below is every document this run will create, waiting to fill in.`,
  lapTwo: msg`Now your gnarliest one: the configured product, the serialized part. Recommended for standard and complex factories — skippable for simple ones.`,
  graduation: msg`When the next real order arrives, run it in Carbon in parallel with the old system — one order, both systems, compare at the end. Parallel is a bridge for one order, not a lifestyle.`,
  done: msg`This is what every order will look like.`
};
