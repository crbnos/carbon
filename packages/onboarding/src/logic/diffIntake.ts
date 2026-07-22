import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { IntakeAnswers } from "../content/intake";
import { INTAKE_QUESTIONS } from "../content/intake";
import { setupCounts, tailorPlan } from "./tailor";

// Re-tuning must never surprise: before a changed intake applies, the customer
// sees exactly what moves. This is the pure diff between two answer sets —
// per-question changes plus the derived plan deltas — rendered by the confirm
// card. Answers hide, they never delete: nothing here is destructive, which is
// why the summary can be shown calmly.

export interface IntakeAnswerChange {
  key: string;
  ask: MessageDescriptor;
  from: string | undefined;
  to: string | undefined;
}

export interface IntakeDiff {
  answers: IntakeAnswerChange[];
  // Derived plan movement, in plain lines.
  planChanges: MessageDescriptor[];
  // Steps newly hidden / newly shown by the change (counts for the summary).
  newlyHidden: number;
  newlyShown: number;
  hasChanges: boolean;
}

const display = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.length ? value.join(", ") : undefined;
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
};

export function diffIntake(
  prev: IntakeAnswers,
  next: IntakeAnswers
): IntakeDiff {
  const answers: IntakeAnswerChange[] = [];

  // Walk the question template (plus follow-up/detail fields) so the diff
  // always speaks in the questions the customer actually answered.
  const fields: { key: keyof IntakeAnswers; ask: MessageDescriptor }[] = [];
  for (const q of INTAKE_QUESTIONS) {
    if (q.kind === "owner") {
      fields.push({ key: "ownerName", ask: q.ask });
      fields.push({ key: "ownerEmail", ask: q.ask });
      continue;
    }
    if (q.kind === "upload") {
      fields.push({ key: "uploadName", ask: q.ask });
      continue;
    }
    fields.push({ key: q.key as keyof IntakeAnswers, ask: q.ask });
    if (q.followUp) fields.push({ key: q.followUp.key, ask: q.followUp.ask });
    if (q.detailFor) fields.push({ key: q.detailFor.key, ask: q.detailFor.ask });
  }

  for (const field of fields) {
    const from = display(prev[field.key]);
    const to = display(next[field.key]);
    if (from !== to) {
      answers.push({ key: field.key, ask: field.ask, from, to });
    }
  }

  const before = tailorPlan(prev);
  const after = tailorPlan(next);
  const planChanges: MessageDescriptor[] = [];

  if (before.band !== after.band) {
    planChanges.push(
      after.suggestedWeeks > before.suggestedWeeks
        ? msg`Your plan got bigger — the timeline moves out to match.`
        : msg`Your plan got smaller — the timeline pulls in to match.`
    );
  } else if (before.suggestedWeeks !== after.suggestedWeeks) {
    planChanges.push(
      after.suggestedWeeks > before.suggestedWeeks
        ? msg`The suggested timeline moves out.`
        : msg`The suggested timeline pulls in.`
    );
  }

  const beforeCounts = setupCounts(before);
  const afterCounts = setupCounts(after);
  const newlyHidden = Math.max(0, afterCounts.hidden - beforeCounts.hidden);
  const newlyShown = Math.max(0, afterCounts.visible - beforeCounts.visible);
  if (newlyShown > 0) {
    planChanges.push(msg`Some setup steps come back into your plan.`);
  }
  if (newlyHidden > 0) {
    planChanges.push(msg`Some setup steps no longer apply and are hidden.`);
  }

  // Nothing is ever deleted by a re-tune — completed work keeps its record even
  // while hidden, and returns exactly as it was if the answer changes back.

  return {
    answers,
    planChanges,
    newlyHidden,
    newlyShown,
    hasChanges: answers.length > 0
  };
}
