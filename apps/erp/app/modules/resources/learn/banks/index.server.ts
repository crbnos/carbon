/**
 * Question bank registry. SERVER ONLY — importing this from a client component
 * would ship every answer key to the browser.
 */

import { seededShuffle } from "../gamify";
import type {
  LearnQuestion,
  LearnServedQuestion,
  LearnTrackSlug
} from "../types";
import { questions as fundamentals } from "./fundamentals.server";
import { questions as purchasing } from "./purchasing.server";

export const banks: Record<LearnTrackSlug, LearnQuestion[]> = {
  fundamentals,
  purchasing,
  accounting: [],
  sales: [],
  inventory: [],
  production: [],
  planning: [],
  quality: [],
  admin: []
};

export function bankForTrack(slug: LearnTrackSlug): LearnQuestion[] {
  return banks[slug] ?? [];
}

export function questionsForUnit(
  trackSlug: LearnTrackSlug,
  unitSlug: string
): LearnQuestion[] {
  return bankForTrack(trackSlug).filter((q) => q.unitSlug === unitSlug);
}

export function questionBySlug(
  trackSlug: LearnTrackSlug,
  questionSlug: string
): LearnQuestion | undefined {
  return bankForTrack(trackSlug).find((q) => q.slug === questionSlug);
}

/**
 * The only shape allowed to cross to the browser: prompt and options, with the
 * options shuffled per attempt so a screenshot of "the answer is B" is useless.
 */
export function toServed(
  question: LearnQuestion,
  shuffleSeed: string
): LearnServedQuestion {
  return {
    slug: question.slug,
    kind: question.kind,
    prompt: question.prompt,
    options: seededShuffle(question.options, `${shuffleSeed}:${question.slug}`)
  };
}

export function isCorrect(
  question: LearnQuestion,
  selected: string | string[]
): boolean {
  if (question.kind === "multi") {
    const expected = Array.isArray(question.answer)
      ? question.answer
      : [question.answer];
    const got = Array.isArray(selected) ? selected : [selected];
    if (got.length !== expected.length) return false;
    const gotSet = new Set(got);
    if (gotSet.size !== expected.length) return false;
    return expected.every((id) => gotSet.has(id));
  }
  const answer = Array.isArray(question.answer)
    ? question.answer[0]
    : question.answer;
  const got = Array.isArray(selected) ? selected[0] : selected;
  return got === answer;
}
