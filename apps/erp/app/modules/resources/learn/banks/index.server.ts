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
import { questions as accounting } from "./accounting.server";
import { questions as admin } from "./admin.server";
import { questions as fundamentals } from "./fundamentals.server";
import { questions as inventory } from "./inventory.server";
import { questions as planning } from "./planning.server";
import { questions as production } from "./production.server";
import { questions as purchasing } from "./purchasing.server";
import { questions as quality } from "./quality.server";
import { questions as sales } from "./sales.server";

export const banks: Record<LearnTrackSlug, LearnQuestion[]> = {
  fundamentals,
  purchasing,
  accounting,
  sales,
  inventory,
  production,
  planning,
  quality,
  admin
};

export function bankForTrack(slug: LearnTrackSlug): LearnQuestion[] {
  return banks[slug] ?? [];
}

export type LearnQuestionMeta = {
  trackSlug: LearnTrackSlug;
  unitSlug: string;
  topic: string;
  prompt: string;
  docsUrl: string;
};

/**
 * What an ADMIN may see about a question: where it lives and which docs page it
 * is drawn from. Deliberately no answer and no explanation — the analytics
 * report is a signal about the DOCS, and a manager who can read the answer key
 * is a manager who can coach somebody through an exam.
 */
export function questionMeta(
  questionSlug: string
): LearnQuestionMeta | undefined {
  for (const trackSlug of Object.keys(banks) as LearnTrackSlug[]) {
    const question = banks[trackSlug].find((q) => q.slug === questionSlug);
    if (!question) continue;
    return {
      trackSlug,
      unitSlug: question.unitSlug,
      topic: question.topic,
      prompt: question.prompt,
      docsUrl: question.docsUrl
    };
  }
  return undefined;
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
