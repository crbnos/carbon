/**
 * Structural guard for every question bank.
 *
 * These tests are the contract each new track has to satisfy: real unit slugs,
 * real docs links, enough questions per topic to draw a fresh exam form, and no
 * answer key leaking through `toServed`. A bank that cannot fail these is a
 * bank nobody can trust to score a certificate.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getTrack, liveTracks, trackUnits } from "../curriculum";
import { DOCS_URL } from "../docs";
import type { LearnTrackSlug } from "../types";
import { banks, isCorrect, questionsForUnit, toServed } from "./index.server";

const SLUG_RE = /^[a-z]+\.[a-z0-9-]+\.\d{2}$/;

/** Tests run with cwd = apps/erp; the docs content is two levels up. */
function docsFileFor(url: string): string | null {
  if (!url.startsWith(DOCS_URL)) return null;
  const path = url.slice(DOCS_URL.length).split("#")[0];
  const root = resolve(process.cwd(), "../../docs/content");
  if (path === "/docs") return resolve(root, "docs/index.mdx");
  if (path.startsWith("/docs/"))
    return resolve(root, `docs/${path.slice(6)}.mdx`);
  if (path.startsWith("/guides/"))
    return resolve(root, `guides/${path.slice(8)}.mdx`);
  return null;
}

const liveSlugs = liveTracks().map((t) => t.slug);

describe("question banks", () => {
  it("ships a populated bank for every live track", () => {
    expect(liveSlugs.length).toBeGreaterThanOrEqual(2);
    for (const slug of liveSlugs) {
      expect(banks[slug].length, `${slug} bank is empty`).toBeGreaterThan(0);
    }
  });

  for (const trackSlug of liveSlugs) {
    describe(trackSlug, () => {
      const track = getTrack(trackSlug)!;
      const bank = banks[trackSlug];

      it("uses well-formed, unique slugs prefixed with the track", () => {
        for (const q of bank) {
          expect(q.slug, `${q.slug} is malformed`).toMatch(SLUG_RE);
          expect(q.slug.startsWith(`${trackSlug}.`)).toBe(true);
        }
        expect(new Set(bank.map((q) => q.slug)).size).toBe(bank.length);
      });

      it("references only real unit slugs", () => {
        const unitSlugs = new Set(trackUnits(track).map((u) => u.slug));
        for (const q of bank) {
          expect(unitSlugs.has(q.unitSlug), `unknown unit ${q.unitSlug}`).toBe(
            true
          );
        }
      });

      it("gives every quiz unit at least 8 questions to draw from", () => {
        for (const unit of trackUnits(track)) {
          if (unit.assessment.kind !== "quiz") continue;
          const pool = questionsForUnit(trackSlug as LearnTrackSlug, unit.slug);
          expect(
            pool.length,
            `${unit.slug} has only ${pool.length} questions`
          ).toBeGreaterThanOrEqual(8);
          expect(pool.length).toBeGreaterThanOrEqual(
            unit.assessment.questionCount
          );
        }
      });

      it("answers reference real option ids", () => {
        for (const q of bank) {
          const ids = new Set(q.options.map((o) => o.id));
          const answers = Array.isArray(q.answer) ? q.answer : [q.answer];
          expect(answers.length, `${q.slug} has no answer`).toBeGreaterThan(0);
          if (q.kind === "multi") {
            expect(
              answers.length,
              `${q.slug} multi needs 2+`
            ).toBeGreaterThanOrEqual(2);
          }
          for (const a of answers) {
            expect(ids.has(a), `${q.slug} answer ${a} is not an option`).toBe(
              true
            );
          }
        }
      });

      it("carries a topic pool at least 3x the exam blueprint", () => {
        const topics = new Set(track.exam.topics.map((t) => t.topic));
        for (const q of bank) {
          expect(
            topics.has(q.topic),
            `${q.slug} has stray topic ${q.topic}`
          ).toBe(true);
        }
        for (const { topic, count } of track.exam.topics) {
          const pool = bank.filter((q) => q.topic === topic).length;
          expect(
            pool,
            `${topic} pool is ${pool}, needs ${count * 3}`
          ).toBeGreaterThanOrEqual(count * 3);
        }
      });

      it("keeps recall questions under 40%", () => {
        const remember = bank.filter((q) => q.bloom === "remember").length;
        expect(remember / bank.length).toBeLessThanOrEqual(0.4);
      });

      it("links every question to a docs page that exists", () => {
        for (const q of bank) {
          const file = docsFileFor(q.docsUrl);
          expect(
            file,
            `${q.slug} has an unrecognised docs url ${q.docsUrl}`
          ).not.toBeNull();
          expect(existsSync(file!), `${q.slug} points at missing ${file}`).toBe(
            true
          );
        }
      });

      it("explains every answer", () => {
        for (const q of bank) {
          expect(
            q.explanation.length,
            `${q.slug} has no explanation`
          ).toBeGreaterThan(20);
        }
      });
    });
  }
});

describe("toServed", () => {
  it("never leaks the answer or the explanation", () => {
    const q = banks.purchasing[0];
    const served = toServed(q, "seed") as Record<string, unknown>;
    expect(served.answer).toBeUndefined();
    expect(served.explanation).toBeUndefined();
    expect(served.docsUrl).toBeUndefined();
    expect(served.topic).toBeUndefined();
    expect(Object.keys(served).sort()).toEqual([
      "kind",
      "options",
      "prompt",
      "slug"
    ]);
  });

  it("shuffles deterministically and keeps every option", () => {
    const q = banks.purchasing[0];
    const a = toServed(q, "seed-1");
    const b = toServed(q, "seed-1");
    expect(a.options).toEqual(b.options);
    expect(a.options.map((o) => o.id).sort()).toEqual(
      q.options.map((o) => o.id).sort()
    );
  });
});

describe("isCorrect", () => {
  const single = banks.fundamentals.find((q) => q.kind === "single")!;
  const multi = banks.fundamentals.find((q) => q.kind === "multi")!;

  it("grades a single-answer question", () => {
    expect(isCorrect(single, single.answer as string)).toBe(true);
    const wrong = single.options.find((o) => o.id !== single.answer)!.id;
    expect(isCorrect(single, wrong)).toBe(false);
  });

  it("grades a multi-answer question regardless of order", () => {
    const answer = multi.answer as string[];
    expect(isCorrect(multi, [...answer].reverse())).toBe(true);
  });

  it("rejects a partial or padded multi-answer", () => {
    const answer = multi.answer as string[];
    expect(isCorrect(multi, answer.slice(0, 1))).toBe(false);
    const extra = multi.options.find((o) => !answer.includes(o.id))!.id;
    expect(isCorrect(multi, [...answer, extra])).toBe(false);
  });

  it("rejects duplicate selections that would fake the right length", () => {
    const answer = multi.answer as string[];
    expect(isCorrect(multi, [answer[0], answer[0]])).toBe(false);
  });
});
