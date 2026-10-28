// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// An open question's row, read safely from its stored payload, and what an
// answer writes back. A person answers by typing, or, when the row lists
// options, by choosing one of them (several when the row allows it) or Not sure.

import type { QuestionPayload } from "../types";

// The stored choice for Not sure. It stands alone and leaves the question open.
export const QUESTION_NOT_SURE = "?";
export const QUESTION_MAX_OPTIONS = 12;

// One answer: a typed answer, or the chosen options.
export type QuestionChange = { answer: string } | { selected: string[] };

const text = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

function readOptions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = Array.from(
    new Set(
      value
        .filter((option): option is string => typeof option === "string")
        .map((option) => option.trim())
        .filter((option) => option.length > 0 && option !== QUESTION_NOT_SURE)
    )
  ).slice(0, QUESTION_MAX_OPTIONS);
  return options.length ? options : undefined;
}

// A stored payload as a QuestionPayload. A choice that is not one of the
// options drops; a single-choice question keeps its first choice only.
export function readQuestion(
  payload: Record<string, unknown>
): QuestionPayload {
  const options = readOptions(payload.options);
  const multiple = Boolean(options) && payload.multiple === true;
  const picked = Array.isArray(payload.selected)
    ? payload.selected.filter(
        (choice): choice is string =>
          typeof choice === "string" &&
          (choice === QUESTION_NOT_SURE || Boolean(options?.includes(choice)))
      )
    : [];
  const selected = picked.includes(QUESTION_NOT_SURE)
    ? [QUESTION_NOT_SURE]
    : multiple
      ? Array.from(new Set(picked))
      : picked.slice(0, 1);
  const answer = text(payload.answer);
  return {
    question: typeof payload.question === "string" ? payload.question : "",
    ...(answer ? { answer } : {}),
    ...(options ? { options } : {}),
    ...(multiple ? { multiple } : {}),
    ...(options && selected.length ? { selected } : {})
  };
}

// Answered: a typed answer, or a chosen option other than Not sure.
export function questionAnswered(question: QuestionPayload): boolean {
  return (
    Boolean(question.answer) ||
    Boolean(question.selected?.some((choice) => choice !== QUESTION_NOT_SURE))
  );
}

// The choices after a pick-all question's change: Not sure stands alone, so
// picking it clears the options, and picking an option clears it.
export function nextQuestionSelection(
  current: string[],
  next: string[]
): string[] {
  const added = next.find((choice) => !current.includes(choice));
  if (added === QUESTION_NOT_SURE) return [QUESTION_NOT_SURE];
  if (added) return next.filter((choice) => choice !== QUESTION_NOT_SURE);
  return next;
}

// The payload with a new typed answer or new choices. Every other key the row
// holds is kept; an empty answer or no choice removes the key.
export function withQuestionAnswer(
  payload: Record<string, unknown>,
  change: QuestionChange
): Record<string, unknown> {
  const { answer: _answer, selected: _selected, ...rest } = payload;
  const answer =
    "answer" in change ? change.answer.trim() : text(payload.answer);
  const selected =
    "selected" in change
      ? change.selected
      : Array.isArray(payload.selected)
        ? payload.selected
        : [];
  return {
    ...rest,
    ...(answer ? { answer } : {}),
    ...(selected.length ? { selected } : {})
  };
}

// What an answer writes: the question's new payload, its choices checked
// against its options, and whether the question is now answered. The page and
// an agent both answer through this, so the stored payload and the question's
// tick never disagree.
export function answerQuestionPayload(
  payload: Record<string, unknown>,
  change: QuestionChange
): { payload: Record<string, unknown>; answered: boolean } {
  const merged = withQuestionAnswer(payload, change);
  const read = readQuestion(merged);
  const { selected: _selected, ...rest } = merged;
  return {
    payload: { ...rest, ...(read.selected ? { selected: read.selected } : {}) },
    answered: questionAnswered(read)
  };
}

// True when the payload already holds this answer, so a pending answer can be
// released once the server reports it.
export function questionHolds(
  payload: Record<string, unknown>,
  change: QuestionChange
): boolean {
  const now = readQuestion(payload);
  const next = readQuestion(answerQuestionPayload(payload, change).payload);
  return (
    now.answer === next.answer &&
    JSON.stringify(now.selected ?? []) === JSON.stringify(next.selected ?? [])
  );
}

// The rows with each pending answer applied, and the answers still pending:
// one the rows already hold is dropped.
export function withPendingAnswers<
  Row extends { id: string; payload: Record<string, unknown> }
>(
  rows: Row[],
  pending: Map<string, QuestionChange>
): { rows: Row[]; pending: Map<string, QuestionChange> } {
  if (pending.size === 0) return { rows, pending };
  const left = new Map(pending);
  const next = rows.map((row) => {
    const change = left.get(row.id);
    if (!change) return row;
    if (questionHolds(row.payload, change)) {
      left.delete(row.id);
      return row;
    }
    return {
      ...row,
      payload: answerQuestionPayload(row.payload, change).payload
    };
  });
  return { rows: next, pending: left };
}
