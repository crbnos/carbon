// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// "Apply to hub" for the sales handover, as a pure plan: the answers, read
// against what the hub already holds, become the list of writes to make. The
// server runs the plan (apply-handover.ts); the Handover page runs the same
// plan to show what is still waiting to be applied.
//
// Each answer is copied to its destination once. A write is skipped when its
// destination already holds a value (someone set it, by hand or by an earlier
// apply), when its row already exists, or when an earlier apply already made
// it. The last rule is what keeps a deleted row deleted and a changed tier
// changed: the hub records the key of every write an apply made.

import {
  HANDOVER_QUESTIONS,
  type HandoverContact,
  type HandoverQuestion,
  type HandoverRowCollection
} from "../content/handover";
import { tierValidator } from "../models";
import type { HubContacts, Tier } from "../types";

// The field an answer is stored in.
export const handoverFieldKey = (questionKey: string) =>
  `handover.${questionKey}`;

// The field that records the key of every write an apply made, as a JSON list.
export const HANDOVER_APPLIED_KEY = "handover.applied";

// The reference a handover row records: the question and the answer's line.
export const handoverSourceRef = (questionKey: string, lineIndex: number) =>
  `handover:${questionKey}:${lineIndex}`;

type WriteBase = {
  // The question whose answer this write copies.
  questionKey: string;
  // Stable identity of the write, recorded once it is made.
  key: string;
};

export type HandoverWrite = WriteBase &
  (
    | { kind: "setTier"; tier: Tier }
    | { kind: "setField"; fieldKey: string; value: string }
    | { kind: "setContacts"; contacts: HubContacts }
    | {
        kind: "addRow";
        collection: HandoverRowCollection;
        payload: Record<string, unknown>;
        sourceRef: string;
      }
  );

export interface HandoverInput {
  // Question key -> answer.
  answers: ReadonlyMap<string, string>;
  // Every field value of the hub, the handover's own included.
  fields: ReadonlyMap<string, string>;
  contacts: HubContacts;
  tier: Tier;
  rows: { sourceRef?: string | null }[];
  // Defaults to the handover content; narrowed to plan one question.
  questions?: HandoverQuestion[];
}

// Question key -> answer, read from the hub's field values.
export function handoverAnswers(
  fields: ReadonlyMap<string, string>,
  questions: HandoverQuestion[] = HANDOVER_QUESTIONS
): Map<string, string> {
  const answers = new Map<string, string>();
  for (const question of questions) {
    const answer = fields.get(handoverFieldKey(question.key));
    if (answer !== undefined) answers.set(question.key, answer);
  }
  return answers;
}

// A list answer's items: one per line, trimmed, blank lines and a leading
// bullet ("- ", "* ", "• ") dropped.
export function answerLines(answer: string): string[] {
  return answer
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s+/, "").trim())
    .filter((line) => line.length > 0);
}

// The keys of the writes earlier applies made.
export function appliedHandoverKeys(
  fields: ReadonlyMap<string, string>
): Set<string> {
  const raw = fields.get(HANDOVER_APPLIED_KEY);
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(value)
        ? value.filter((key): key is string => typeof key === "string")
        : []
    );
  } catch {
    return new Set();
  }
}

// The applied record after the given writes are made.
export function appliedHandoverValue(
  fields: ReadonlyMap<string, string>,
  writes: HandoverWrite[]
): string {
  const keys = appliedHandoverKeys(fields);
  for (const write of writes) keys.add(write.key);
  return JSON.stringify(Array.from(keys).sort());
}

// The payload of a row made from one line of an answer.
export function handoverRowPayload(
  collection: HandoverRowCollection,
  line: string
): Record<string, unknown> {
  switch (collection) {
    case "requirement":
      return { requirement: line };
    case "data":
      return { object: line, today: "" };
    case "question":
      return { question: line };
    case "objective":
      return { title: line };
  }
}

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const isBlank = (value: string | null | undefined) => !value?.trim();

export function planHandover({
  answers,
  fields,
  contacts,
  tier,
  rows,
  questions = HANDOVER_QUESTIONS
}: HandoverInput): HandoverWrite[] {
  const applied = appliedHandoverKeys(fields);
  const existingRefs = new Set(
    rows.map((row) => row.sourceRef).filter((ref): ref is string => !!ref)
  );
  const writes: HandoverWrite[] = [];
  // Contacts are one object; each write carries the contacts so far.
  let nextContacts: HubContacts = contacts;

  for (const question of questions) {
    const { destination } = question;
    const answer = (answers.get(question.key) ?? "").trim();
    if (!destination || !answer) continue;

    switch (destination.kind) {
      case "tier": {
        const parsed = tierValidator.safeParse(answer);
        const key = "tier";
        if (parsed.success && parsed.data !== tier && !applied.has(key)) {
          writes.push({
            kind: "setTier",
            tier: parsed.data,
            questionKey: question.key,
            key
          });
        }
        break;
      }
      case "field": {
        const key = `field:${destination.fieldKey}`;
        if (question.type === "date" && !isIsoDate(answer)) break;
        if (isBlank(fields.get(destination.fieldKey)) && !applied.has(key)) {
          writes.push({
            kind: "setField",
            fieldKey: destination.fieldKey,
            value: answer,
            questionKey: question.key,
            key
          });
        }
        break;
      }
      case "contact": {
        const contact: HandoverContact = destination.contact;
        const key = `contact:${contact}`;
        if (isBlank(nextContacts[contact]) && !applied.has(key)) {
          nextContacts = { ...nextContacts, [contact]: answer };
          writes.push({
            kind: "setContacts",
            contacts: nextContacts,
            questionKey: question.key,
            key
          });
        }
        break;
      }
      case "rows": {
        answerLines(answer).forEach((line, lineIndex) => {
          const sourceRef = handoverSourceRef(question.key, lineIndex);
          if (existingRefs.has(sourceRef) || applied.has(sourceRef)) return;
          writes.push({
            kind: "addRow",
            collection: destination.collection,
            payload: handoverRowPayload(destination.collection, line),
            sourceRef,
            questionKey: question.key,
            key: sourceRef
          });
        });
        break;
      }
    }
  }

  return writes;
}
