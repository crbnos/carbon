/**
 * Carbon Learn — the grading and awarding engine. SERVER ONLY.
 *
 * Everything a score depends on happens here, on the service-role client, after
 * the server has decided the answer. The engine tables carry no client write
 * policies at all, so this file is the only way a progress row, an XP event, or
 * a certificate can come into existence.
 *
 * Three invariants worth stating once:
 *
 *  1. Grading is bound to the content version the attempt was SERVED with.
 *     Banks ship in code, so a deploy can change them mid-attempt; an attempt
 *     whose version no longer matches is voided (no score, no cooldown) rather
 *     than graded against questions the learner never saw.
 *  2. XP is an append-only ledger with a unique index per (user, kind, ref).
 *     Awarding twice is a no-op, so a retry can never inflate a total, and a
 *     mis-award is a deletable row rather than a corrupted counter.
 *  3. A hands-on challenge's clock is the SERVER's. `startedAt` is written by
 *     `startChallenge` and read back on every check; the client only ever hands
 *     back an attempt id, which is re-read under the session's company.
 */

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getCompanyTimeZone } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import { parseAbsolute } from "@internationalized/date";
import type { Transaction } from "kysely";
import { sql } from "kysely";
import { getDatabaseClient } from "~/services/database.server";
import {
  bankForTrack,
  isCorrect,
  questionBySlug,
  questionsForUnit,
  toServed
} from "./banks/index.server";
import { getChecker } from "./checkers/index.server";
import { makeSupabaseReader } from "./checkers/reader.server";
import {
  getTrack,
  moduleForUnit,
  trackUnits,
  unitForChallenge
} from "./curriculum";
import {
  CERTIFICATE_VALIDITY_MONTHS,
  CERTIFICATION_XP,
  CHALLENGE_XP,
  drawStratifiedForm,
  EXAM_PASS_RATIO,
  EXAM_TIME_LIMIT_MINUTES,
  examCooldownEnd,
  LEARN_CONTENT_VERSION,
  MODULE_BADGE_XP,
  quizXpForPassAttempt,
  RENEWAL_QUESTION_COUNT,
  RENEWAL_XP
} from "./gamify";
import type {
  LearnCheckResult,
  LearnServedQuestion,
  LearnXpKind
} from "./types";

type Ctx = { companyId: string; userId: string };
type Trx = Transaction<KyselyDatabase>;

// ---------------------------------------------------------------- pure rules
// Extracted so the sequencing, scoring, voiding, and gating rules can be tested
// without a database.

export function shouldVoid(attemptContentVersion: string): boolean {
  return attemptContentVersion !== LEARN_CONTENT_VERSION;
}

/** The exam is one question at a time and strictly forward. */
export function nextExamQuestion(
  questionSlugs: string[],
  answeredSlugs: string[]
): { slug: string; index: number } | null {
  const index = answeredSlugs.length;
  if (index >= questionSlugs.length) return null;
  return { slug: questionSlugs[index], index };
}

export function isExpectedExamQuestion(
  questionSlugs: string[],
  answeredSlugs: string[],
  questionSlug: string
): boolean {
  const next = nextExamQuestion(questionSlugs, answeredSlugs);
  return next !== null && next.slug === questionSlug;
}

export function scoreAttempt(
  correctCount: number,
  questionCount: number
): { ratio: number; passed: boolean } {
  const ratio = questionCount === 0 ? 0 : correctCount / questionCount;
  return { ratio, passed: ratio >= EXAM_PASS_RATIO };
}

export function canStartExam(input: {
  requiredChallengeSlugs: string[];
  passedChallengeSlugs: string[];
  failedExamSubmittedAt: string[];
  now: string;
}):
  | { ok: true }
  | { ok: false; reason: "challenges"; missing: string[] }
  | { ok: false; reason: "cooldown"; until: string } {
  const passed = new Set(input.passedChallengeSlugs);
  const missing = input.requiredChallengeSlugs.filter((s) => !passed.has(s));
  if (missing.length > 0) return { ok: false, reason: "challenges", missing };

  const until = examCooldownEnd(input.failedExamSubmittedAt);
  if (until && until > input.now)
    return { ok: false, reason: "cooldown", until };

  return { ok: true };
}

// ------------------------------------------------------------------- helpers

/**
 * Normalise a value read back from Postgres into an ISO instant string.
 *
 * The `pg` driver decodes `timestamptz` into a JS `Date`, and interpolating one
 * into a PostgREST filter sends `String(date)` — "Sun Sep 06 2026 18:12:37
 * GMT+0530 (India Standard Time)" — which Postgres rejects with
 * `time zone "gmt+0530" not recognized`. Anything that crosses from a Kysely
 * read into a supabase-js filter goes through here first.
 */
function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

async function companyTimeZone(companyId: string): Promise<string> {
  try {
    return await getCompanyTimeZone(getDatabaseClient(), companyId);
  } catch {
    return "UTC";
  }
}

/**
 * Append one XP event and roll it into the day's activity. Idempotent by the
 * `(userId, companyId, kind, refSlug)` unique index: a second award for the
 * same thing inserts nothing and touches no counters.
 */
async function awardXp(
  trx: Trx,
  input: Ctx & {
    amount: number;
    kind: LearnXpKind;
    refSlug: string;
    day: string;
    units?: number;
  }
): Promise<boolean> {
  const now = datetime.timestamp();
  const inserted = await trx
    .insertInto("learnXpEvent")
    .values({
      companyId: input.companyId,
      userId: input.userId,
      amount: input.amount,
      kind: input.kind,
      refSlug: input.refSlug,
      createdBy: input.userId,
      createdAt: now
    })
    .onConflict((oc: any) =>
      oc.columns(["userId", "companyId", "kind", "refSlug"]).doNothing()
    )
    .returning("id")
    .execute();

  if (inserted.length === 0) return false;

  await trx
    .insertInto("learnActivityDay")
    .values({
      userId: input.userId,
      companyId: input.companyId,
      day: input.day,
      xp: input.amount,
      units: input.units ?? 0,
      seconds: 0,
      createdAt: now
    })
    .onConflict((oc: any) =>
      oc.columns(["userId", "day", "companyId"]).doUpdateSet({
        xp: sql`"learnActivityDay"."xp" + excluded."xp"`,
        units: sql`"learnActivityDay"."units" + excluded."units"`,
        updatedAt: now
      })
    )
    .execute();

  return true;
}

/** Award a module badge once every unit in the module is complete. */
async function maybeAwardModuleBadge(
  trx: Trx,
  input: Ctx & { trackSlug: string; unitSlug: string; day: string }
) {
  const module = moduleForUnit(input.trackSlug, input.unitSlug);
  if (!module) return;

  const completed = await trx
    .selectFrom("learnUnitProgress")
    .select("unitSlug")
    .where("userId", "=", input.userId)
    .where("companyId", "=", input.companyId)
    .where("trackSlug", "=", input.trackSlug)
    .where("completedAt", "is not", null)
    .execute();

  const done = new Set(completed.map((r: { unitSlug: string }) => r.unitSlug));
  const allDone = module.units.every((u) => done.has(u.slug));
  if (!allDone) return;

  const now = datetime.timestamp();
  const inserted = await trx
    .insertInto("learnBadgeAward")
    .values({
      companyId: input.companyId,
      userId: input.userId,
      badgeSlug: module.badgeSlug,
      awardedAt: now,
      createdBy: input.userId,
      createdAt: now
    })
    .onConflict((oc: any) =>
      oc.columns(["userId", "badgeSlug", "companyId"]).doNothing()
    )
    .returning("id")
    .execute();

  if (inserted.length > 0) {
    await awardXp(trx, {
      ...input,
      amount: MODULE_BADGE_XP,
      kind: "module_badge",
      refSlug: module.badgeSlug
    });
  }
}

// -------------------------------------------------------------- unit quizzes

export async function startQuizAttempt(
  ctx: Ctx & { trackSlug: string; unitSlug: string }
): Promise<{ attemptId: string; questions: LearnServedQuestion[] }> {
  const track = getTrack(ctx.trackSlug);
  const unit = trackUnits(track!).find((u) => u.slug === ctx.unitSlug);
  if (!track || !unit || unit.assessment.kind !== "quiz") {
    throw new Response("Not found", { status: 404 });
  }

  const pool = questionsForUnit(track.slug, unit.slug);
  const db = getDatabaseClient();
  const now = datetime.timestamp();

  const attempt = await db
    .insertInto("learnAttempt")
    .values({
      companyId: ctx.companyId,
      userId: ctx.userId,
      kind: "Unit Quiz",
      trackSlug: track.slug,
      unitSlug: unit.slug,
      questionSlugs: [],
      questionCount: unit.assessment.questionCount,
      contentVersion: LEARN_CONTENT_VERSION,
      startedAt: now,
      createdBy: ctx.userId,
      createdAt: now
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const drawn = drawStratifiedForm(
    pool.map((q) => ({ slug: q.slug, topic: q.topic })),
    [{ topic: pool[0]?.topic ?? "", count: unit.assessment.questionCount }],
    attempt.id
  );

  await db
    .updateTable("learnAttempt")
    .set({ questionSlugs: drawn })
    .where("id", "=", attempt.id)
    .where("companyId", "=", ctx.companyId)
    .execute();

  const questions = drawn
    .map((slug) => questionBySlug(track.slug, slug))
    .filter((q): q is NonNullable<typeof q> => Boolean(q))
    .map((q) => toServed(q, attempt.id));

  return { attemptId: attempt.id, questions };
}

export type QuizFeedback = {
  questionSlug: string;
  prompt: string;
  correct: boolean;
  explanation: string;
  docsUrl: string;
};

export async function gradeQuizAttempt(
  ctx: Ctx & {
    attemptId: string;
    responses: Array<{ questionSlug: string; selected: string | string[] }>;
  }
): Promise<
  | { voided: true }
  | {
      voided: false;
      passed: boolean;
      correctCount: number;
      questionCount: number;
      xpAwarded: number;
      feedback: QuizFeedback[];
    }
> {
  const db = getDatabaseClient();

  const attempt = await db
    .selectFrom("learnAttempt")
    .selectAll()
    .where("id", "=", ctx.attemptId)
    .where("companyId", "=", ctx.companyId)
    .where("userId", "=", ctx.userId)
    .executeTakeFirst();

  if (!attempt || !attempt.unitSlug)
    throw new Response("Not found", { status: 404 });
  if (attempt.submittedAt)
    throw new Response("Already submitted", { status: 409 });

  if (shouldVoid(attempt.contentVersion)) {
    await db
      .updateTable("learnAttempt")
      .set({ voidedAt: datetime.timestamp() })
      .where("id", "=", attempt.id)
      .where("companyId", "=", ctx.companyId)
      .execute();
    return { voided: true };
  }

  const served = new Set(attempt.questionSlugs ?? []);
  const bySlug = new Map(
    ctx.responses.map((r) => [r.questionSlug, r.selected])
  );

  const graded = (attempt.questionSlugs ?? []).map((slug) => {
    const question = questionBySlug(attempt.trackSlug as never, slug)!;
    const selected = bySlug.get(slug) ?? "";
    return { question, selected, correct: isCorrect(question, selected) };
  });

  const correctCount = graded.filter((g) => g.correct).length;
  const questionCount = served.size;
  // A unit quiz is mastery-style: every question must be right to pass.
  const passed = correctCount === questionCount && questionCount > 0;

  const tz = await companyTimeZone(ctx.companyId);
  const day = datetime.today(tz).toString();
  const now = datetime.timestamp();

  let xpAwarded = 0;

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("learnAttemptAnswer")
      .values(
        graded.map((g) => ({
          companyId: ctx.companyId,
          attemptId: attempt.id,
          questionSlug: g.question.slug,
          selected: JSON.stringify(g.selected),
          correct: g.correct,
          answeredAt: now,
          createdBy: ctx.userId,
          createdAt: now
        }))
      )
      .onConflict((oc: any) =>
        oc.columns(["attemptId", "questionSlug", "companyId"]).doNothing()
      )
      .execute();

    await trx
      .updateTable("learnAttempt")
      .set({
        correctCount,
        passed,
        submittedAt: now,
        updatedBy: ctx.userId,
        updatedAt: now
      })
      .where("id", "=", attempt.id)
      .where("companyId", "=", ctx.companyId)
      .execute();

    const existing = await trx
      .selectFrom("learnUnitProgress")
      .selectAll()
      .where("userId", "=", ctx.userId)
      .where("companyId", "=", ctx.companyId)
      .where("unitSlug", "=", attempt.unitSlug!)
      .executeTakeFirst();

    const attemptNumber = (existing?.quizAttempts ?? 0) + 1;
    const bestScore = Math.max(
      existing?.bestScore ?? 0,
      questionCount === 0 ? 0 : correctCount / questionCount
    );
    const firstPass = passed && !existing?.completedAt;

    if (existing) {
      await trx
        .updateTable("learnUnitProgress")
        .set({
          quizAttempts: attemptNumber,
          bestScore,
          completedAt: existing.completedAt ?? (passed ? now : null),
          updatedBy: ctx.userId,
          updatedAt: now
        })
        .where("id", "=", existing.id)
        .where("companyId", "=", ctx.companyId)
        .execute();
    } else {
      const module = moduleForUnit(attempt.trackSlug, attempt.unitSlug!);
      await trx
        .insertInto("learnUnitProgress")
        .values({
          companyId: ctx.companyId,
          userId: ctx.userId,
          trackSlug: attempt.trackSlug,
          moduleSlug: module?.slug ?? "",
          unitSlug: attempt.unitSlug!,
          quizAttempts: attemptNumber,
          bestScore,
          completedAt: passed ? now : null,
          createdBy: ctx.userId,
          createdAt: now
        })
        .execute();
    }

    if (firstPass) {
      const amount = quizXpForPassAttempt(attemptNumber);
      const awarded = await awardXp(trx, {
        companyId: ctx.companyId,
        userId: ctx.userId,
        amount,
        kind: "unit_quiz",
        refSlug: attempt.unitSlug!,
        day,
        units: 1
      });
      if (awarded) xpAwarded = amount;

      await maybeAwardModuleBadge(trx, {
        companyId: ctx.companyId,
        userId: ctx.userId,
        trackSlug: attempt.trackSlug,
        unitSlug: attempt.unitSlug!,
        day
      });
    }
  });

  return {
    voided: false,
    passed,
    correctCount,
    questionCount,
    xpAwarded,
    feedback: graded.map((g) => ({
      questionSlug: g.question.slug,
      prompt: g.question.prompt,
      correct: g.correct,
      explanation: g.question.explanation,
      docsUrl: g.question.docsUrl
    }))
  };
}

// -------------------------------------------------------------------- exams

export async function startExamAttempt(
  ctx: Ctx & { trackSlug: string; kind?: "Certification Exam" | "Renewal Quiz" }
): Promise<
  | { ok: false; reason: "challenges"; missing: string[] }
  | { ok: false; reason: "cooldown"; until: string }
  | {
      ok: true;
      attemptId: string;
      question: LearnServedQuestion;
      index: number;
      total: number;
      expiresAt: string | null;
    }
> {
  const track = getTrack(ctx.trackSlug);
  if (!track || track.status !== "live")
    throw new Response("Not found", { status: 404 });

  const kind = ctx.kind ?? "Certification Exam";
  const db = getDatabaseClient();
  const now = datetime.timestamp();

  const open = await db
    .selectFrom("learnAttempt")
    .selectAll()
    .where("userId", "=", ctx.userId)
    .where("companyId", "=", ctx.companyId)
    .where("trackSlug", "=", track.slug)
    .where("kind", "=", kind)
    .where("submittedAt", "is", null)
    .where("voidedAt", "is", null)
    .orderBy("startedAt", "desc")
    .executeTakeFirst();

  if (open && !shouldVoid(open.contentVersion)) {
    const answered = await db
      .selectFrom("learnAttemptAnswer")
      .select("questionSlug")
      .where("attemptId", "=", open.id)
      .where("companyId", "=", ctx.companyId)
      .execute();
    const next = nextExamQuestion(
      open.questionSlugs ?? [],
      answered.map((a: { questionSlug: string }) => a.questionSlug)
    );
    if (next) {
      const q = questionBySlug(track.slug, next.slug)!;
      return {
        ok: true,
        attemptId: open.id,
        question: toServed(q, open.id),
        index: next.index,
        total: open.questionCount,
        expiresAt: open.expiresAt
      };
    }
  }

  if (kind === "Certification Exam") {
    const [challenges, exams] = await Promise.all([
      db
        .selectFrom("learnChallengeAttempt")
        .select("challengeSlug")
        .where("userId", "=", ctx.userId)
        .where("companyId", "=", ctx.companyId)
        .where("passed", "=", true)
        .execute(),
      db
        .selectFrom("learnAttempt")
        .select(["passed", "submittedAt"])
        .where("userId", "=", ctx.userId)
        .where("companyId", "=", ctx.companyId)
        .where("trackSlug", "=", track.slug)
        .where("kind", "=", "Certification Exam")
        .where("submittedAt", "is not", null)
        .execute()
    ]);

    const gate = canStartExam({
      requiredChallengeSlugs: track.requiredChallengeSlugs,
      passedChallengeSlugs: challenges.map(
        (c: { challengeSlug: string }) => c.challengeSlug
      ),
      failedExamSubmittedAt: exams.flatMap((e) =>
        e.passed === false && e.submittedAt ? [e.submittedAt] : []
      ),
      now
    });

    if (!gate.ok) return gate;
  }

  const pool = bankForTrack(track.slug).map((q) => ({
    slug: q.slug,
    topic: q.topic
  }));

  const previous = await db
    .selectFrom("learnAttempt")
    .select("questionSlugs")
    .where("userId", "=", ctx.userId)
    .where("companyId", "=", ctx.companyId)
    .where("trackSlug", "=", track.slug)
    .orderBy("startedAt", "desc")
    .limit(1)
    .executeTakeFirst();

  const exclude = new Set<string>(previous?.questionSlugs ?? []);

  const blueprint =
    kind === "Renewal Quiz"
      ? [{ topic: pool[0]?.topic ?? "", count: RENEWAL_QUESTION_COUNT }]
      : track.exam.topics;

  const attemptId = crypto.randomUUID();
  const drawn = drawStratifiedForm(pool, blueprint, attemptId, exclude);

  const expiresAt =
    kind === "Certification Exam"
      ? new Date(
          new Date(now).getTime() + EXAM_TIME_LIMIT_MINUTES * 60 * 1000
        ).toISOString()
      : null;

  const attempt = await db
    .insertInto("learnAttempt")
    .values({
      companyId: ctx.companyId,
      userId: ctx.userId,
      kind,
      trackSlug: track.slug,
      questionSlugs: drawn,
      questionCount: drawn.length,
      contentVersion: LEARN_CONTENT_VERSION,
      startedAt: now,
      expiresAt,
      createdBy: ctx.userId,
      createdAt: now
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const first = questionBySlug(track.slug, drawn[0])!;
  return {
    ok: true,
    attemptId: attempt.id,
    question: toServed(first, attempt.id),
    index: 0,
    total: drawn.length,
    expiresAt
  };
}

export async function answerExamQuestion(
  ctx: Ctx & {
    attemptId: string;
    questionSlug: string;
    selected: string | string[];
  }
): Promise<
  | { voided: true }
  | { done: true }
  | { done: false; question: LearnServedQuestion; index: number; total: number }
> {
  const db = getDatabaseClient();

  const attempt = await db
    .selectFrom("learnAttempt")
    .selectAll()
    .where("id", "=", ctx.attemptId)
    .where("companyId", "=", ctx.companyId)
    .where("userId", "=", ctx.userId)
    .executeTakeFirst();

  if (!attempt) throw new Response("Not found", { status: 404 });
  if (attempt.submittedAt || attempt.voidedAt) return { done: true };

  if (shouldVoid(attempt.contentVersion)) {
    await db
      .updateTable("learnAttempt")
      .set({ voidedAt: datetime.timestamp() })
      .where("id", "=", attempt.id)
      .where("companyId", "=", ctx.companyId)
      .execute();
    return { voided: true };
  }

  const now = datetime.timestamp();
  if (attempt.expiresAt && now > attempt.expiresAt) return { done: true };

  const answered = await db
    .selectFrom("learnAttemptAnswer")
    .select("questionSlug")
    .where("attemptId", "=", attempt.id)
    .where("companyId", "=", ctx.companyId)
    .execute();
  const answeredSlugs = answered.map(
    (a: { questionSlug: string }) => a.questionSlug
  );

  // No skipping and no going back: the only acceptable answer is the next one.
  if (
    !isExpectedExamQuestion(
      attempt.questionSlugs ?? [],
      answeredSlugs,
      ctx.questionSlug
    )
  ) {
    throw new Response("Out of order", { status: 409 });
  }

  const question = questionBySlug(
    attempt.trackSlug as never,
    ctx.questionSlug
  )!;
  await db
    .insertInto("learnAttemptAnswer")
    .values({
      companyId: ctx.companyId,
      attemptId: attempt.id,
      questionSlug: ctx.questionSlug,
      selected: JSON.stringify(ctx.selected),
      correct: isCorrect(question, ctx.selected),
      answeredAt: now,
      createdBy: ctx.userId,
      createdAt: now
    })
    .onConflict((oc: any) =>
      oc.columns(["attemptId", "questionSlug", "companyId"]).doNothing()
    )
    .execute();

  const next = nextExamQuestion(attempt.questionSlugs ?? [], [
    ...answeredSlugs,
    ctx.questionSlug
  ]);
  if (!next) return { done: true };

  const q = questionBySlug(attempt.trackSlug as never, next.slug)!;
  return {
    done: false,
    question: toServed(q, attempt.id),
    index: next.index,
    total: attempt.questionCount
  };
}

export async function finalizeExamAttempt(
  ctx: Ctx & { attemptId: string }
): Promise<{
  passed: boolean;
  correctCount: number;
  questionCount: number;
  perTopic: Array<{ topic: string; correct: number; total: number }>;
  certificateId: string | null;
}> {
  const db = getDatabaseClient();

  const attempt = await db
    .selectFrom("learnAttempt")
    .selectAll()
    .where("id", "=", ctx.attemptId)
    .where("companyId", "=", ctx.companyId)
    .where("userId", "=", ctx.userId)
    .executeTakeFirst();

  if (!attempt) throw new Response("Not found", { status: 404 });

  const answers = await db
    .selectFrom("learnAttemptAnswer")
    .select(["questionSlug", "correct"])
    .where("attemptId", "=", attempt.id)
    .where("companyId", "=", ctx.companyId)
    .execute();

  // Finalize only sums what was graded at submission — it never re-grades.
  const correctCount = answers.filter(
    (a: { correct: boolean }) => a.correct
  ).length;
  const { ratio, passed } = scoreAttempt(correctCount, attempt.questionCount);

  const perTopicMap = new Map<string, { correct: number; total: number }>();
  for (const a of answers) {
    const q = questionBySlug(attempt.trackSlug as never, a.questionSlug);
    if (!q) continue;
    const entry = perTopicMap.get(q.topic) ?? { correct: 0, total: 0 };
    entry.total += 1;
    if (a.correct) entry.correct += 1;
    perTopicMap.set(q.topic, entry);
  }

  const now = datetime.timestamp();
  if (!attempt.submittedAt) {
    await db
      .updateTable("learnAttempt")
      .set({
        correctCount,
        passed,
        submittedAt: now,
        updatedBy: ctx.userId,
        updatedAt: now
      })
      .where("id", "=", attempt.id)
      .where("companyId", "=", ctx.companyId)
      .execute();
  }

  let certificateId: string | null = null;
  if (passed && attempt.kind === "Certification Exam") {
    certificateId = await issueCertificate({
      companyId: ctx.companyId,
      userId: ctx.userId,
      trackSlug: attempt.trackSlug,
      examAttemptId: attempt.id,
      examScore: ratio
    });
  }

  if (passed && attempt.kind === "Renewal Quiz") {
    await extendCertificateForRenewal({
      companyId: ctx.companyId,
      userId: ctx.userId,
      trackSlug: attempt.trackSlug
    });
  }

  return {
    passed,
    correctCount,
    questionCount: attempt.questionCount,
    perTopic: Array.from(perTopicMap.entries()).map(([topic, v]) => ({
      topic,
      ...v
    })),
    certificateId
  };
}

// --------------------------------------------------------------- challenges

export async function startChallenge(
  ctx: Ctx & { trackSlug: string; challengeSlug: string }
): Promise<{ id: string; startedAt: string; passed: boolean }> {
  const db = getDatabaseClient();

  const existing = await db
    .selectFrom("learnChallengeAttempt")
    .selectAll()
    .where("userId", "=", ctx.userId)
    .where("companyId", "=", ctx.companyId)
    .where("challengeSlug", "=", ctx.challengeSlug)
    .orderBy("startedAt", "desc")
    .executeTakeFirst();

  // Idempotent: an open attempt is reused, and a passed one is not restarted.
  if (existing) {
    return {
      id: existing.id,
      startedAt: existing.startedAt,
      passed: existing.passed
    };
  }

  const now = datetime.timestamp();
  const row = await db
    .insertInto("learnChallengeAttempt")
    .values({
      companyId: ctx.companyId,
      userId: ctx.userId,
      trackSlug: ctx.trackSlug,
      challengeSlug: ctx.challengeSlug,
      contentVersion: LEARN_CONTENT_VERSION,
      startedAt: now,
      createdBy: ctx.userId,
      createdAt: now
    })
    .returning(["id", "startedAt", "passed"])
    .executeTakeFirstOrThrow();

  return { id: row.id, startedAt: row.startedAt, passed: row.passed };
}

export async function checkChallenge(
  ctx: Ctx & { attemptId: string }
): Promise<LearnCheckResult & { xpAwarded: number }> {
  const db = getDatabaseClient();

  // Re-read under the SESSION's company: an attempt id from another tenant is
  // a 404, not a check against this company's data.
  const attempt = await db
    .selectFrom("learnChallengeAttempt")
    .selectAll()
    .where("id", "=", ctx.attemptId)
    .where("companyId", "=", ctx.companyId)
    .where("userId", "=", ctx.userId)
    .executeTakeFirst();

  if (!attempt) throw new Response("Not found", { status: 404 });

  const checker = getChecker(attempt.challengeSlug);
  if (!checker) throw new Response("Not found", { status: 404 });

  const serviceRole = await getCarbonServiceRole();
  const result = await checker({
    scope: {
      companyId: ctx.companyId,
      userId: ctx.userId,
      // Kysely hands back timestamptz as a JS Date, and PostgREST rejects
      // `String(date)` ("time zone \"gmt+0530\" not recognized"). Every filter
      // built from a DB timestamp has to be normalised to ISO first.
      since: toIso(attempt.startedAt)
    },
    reader: makeSupabaseReader(serviceRole)
  });

  const now = datetime.timestamp();
  const tz = await companyTimeZone(ctx.companyId);
  const day = datetime.today(tz).toString();
  let xpAwarded = 0;

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("learnChallengeAttempt")
      .set({
        checkCount: attempt.checkCount + 1,
        lastCheckedAt: now,
        passed: result.passed || attempt.passed,
        passedAt: result.passed ? (attempt.passedAt ?? now) : attempt.passedAt,
        failedRequirement: result.passed ? null : result.failedRequirement,
        message: result.passed ? null : result.message,
        evidence: result.passed
          ? JSON.stringify(result.evidence)
          : attempt.evidence,
        updatedBy: ctx.userId,
        updatedAt: now
      })
      .where("id", "=", attempt.id)
      .where("companyId", "=", ctx.companyId)
      .execute();

    if (result.passed && !attempt.passed) {
      const awarded = await awardXp(trx, {
        companyId: ctx.companyId,
        userId: ctx.userId,
        amount: CHALLENGE_XP,
        kind: "challenge",
        refSlug: attempt.challengeSlug,
        day,
        units: 1
      });
      if (awarded) xpAwarded = CHALLENGE_XP;

      const placement = unitForChallenge(attempt.challengeSlug);
      if (placement) {
        const existing = await trx
          .selectFrom("learnUnitProgress")
          .selectAll()
          .where("userId", "=", ctx.userId)
          .where("companyId", "=", ctx.companyId)
          .where("unitSlug", "=", placement.unit.slug)
          .executeTakeFirst();

        if (existing) {
          await trx
            .updateTable("learnUnitProgress")
            .set({
              completedAt: existing.completedAt ?? now,
              updatedBy: ctx.userId,
              updatedAt: now
            })
            .where("id", "=", existing.id)
            .where("companyId", "=", ctx.companyId)
            .execute();
        } else {
          await trx
            .insertInto("learnUnitProgress")
            .values({
              companyId: ctx.companyId,
              userId: ctx.userId,
              trackSlug: placement.track.slug,
              moduleSlug: placement.module.slug,
              unitSlug: placement.unit.slug,
              quizAttempts: 0,
              completedAt: now,
              createdBy: ctx.userId,
              createdAt: now
            })
            .execute();
        }

        await maybeAwardModuleBadge(trx, {
          companyId: ctx.companyId,
          userId: ctx.userId,
          trackSlug: placement.track.slug,
          unitSlug: placement.unit.slug,
          day
        });
      }
    }
  });

  return { ...result, xpAwarded };
}

// ------------------------------------------------------------- certificates

/**
 * Idempotent per passed exam attempt. The `(examAttemptId, companyId)` unique
 * constraint means a retry or a double-submit returns the certificate that
 * already exists rather than minting a second verification code.
 */
export async function issueCertificate(
  input: Ctx & {
    trackSlug: string;
    examAttemptId: string;
    examScore: number;
  }
): Promise<string> {
  const track = getTrack(input.trackSlug);
  if (!track) throw new Response("Not found", { status: 404 });

  const db = getDatabaseClient();
  const tz = await companyTimeZone(input.companyId);
  const now = datetime.timestamp();
  const expiresAt = parseAbsolute(now, tz)
    .add({ months: CERTIFICATE_VALIDITY_MONTHS })
    .toAbsoluteString();
  const day = datetime.today(tz).toString();

  const existing = await db
    .selectFrom("learnCertificate")
    .select("id")
    .where("examAttemptId", "=", input.examAttemptId)
    .where("companyId", "=", input.companyId)
    .executeTakeFirst();

  if (existing) return existing.id;

  let certificateId = "";

  await db.transaction().execute(async (trx) => {
    // Re-verify inside the transaction — never trust the caller's word that
    // the exam passed or the challenges were done.
    const exam = await trx
      .selectFrom("learnAttempt")
      .select(["passed", "userId"])
      .where("id", "=", input.examAttemptId)
      .where("companyId", "=", input.companyId)
      .executeTakeFirst();

    if (!exam?.passed || exam.userId !== input.userId) {
      throw new Response("Exam not passed", { status: 409 });
    }

    const passedChallenges = await trx
      .selectFrom("learnChallengeAttempt")
      .select(["id", "challengeSlug", "passedAt", "contentVersion", "evidence"])
      .where("userId", "=", input.userId)
      .where("companyId", "=", input.companyId)
      .where("passed", "=", true)
      .execute();

    const bySlug = new Map(passedChallenges.map((c) => [c.challengeSlug, c]));
    const missing = track.requiredChallengeSlugs.filter((s) => !bySlug.has(s));
    if (missing.length > 0) {
      throw new Response(`Missing challenges: ${missing.join(", ")}`, {
        status: 409
      });
    }

    const used = track.requiredChallengeSlugs.map((slug) => bySlug.get(slug)!);

    const inserted = await trx
      .insertInto("learnCertificate")
      .values({
        companyId: input.companyId,
        userId: input.userId,
        trackSlug: track.slug,
        trackTitle: track.title,
        contentVersion: LEARN_CONTENT_VERSION,
        examAttemptId: input.examAttemptId,
        examScore: input.examScore,
        challengeSlugs: track.requiredChallengeSlugs,
        challengeAttemptIds: used.map((c) => c.id),
        // An immutable snapshot: re-running a challenge later must not change
        // what this certificate was issued on.
        evidence: JSON.stringify(
          used.map((c) => ({
            slug: c.challengeSlug,
            attemptId: c.id,
            passedAt: c.passedAt,
            contentVersion: c.contentVersion,
            evidence: c.evidence
          }))
        ),
        issuedAt: now,
        expiresAt,
        createdBy: input.userId,
        createdAt: now
      })
      .onConflict((oc: any) =>
        oc.columns(["examAttemptId", "companyId"]).doNothing()
      )
      .returning("id")
      .execute();

    if (inserted.length > 0) {
      certificateId = inserted[0].id;
      await awardXp(trx, {
        companyId: input.companyId,
        userId: input.userId,
        amount: CERTIFICATION_XP,
        kind: "certification",
        refSlug: track.slug,
        day
      });
    }
  });

  if (certificateId) return certificateId;

  const raced = await db
    .selectFrom("learnCertificate")
    .select("id")
    .where("examAttemptId", "=", input.examAttemptId)
    .where("companyId", "=", input.companyId)
    .executeTakeFirstOrThrow();
  return raced.id;
}

async function extendCertificateForRenewal(input: Ctx & { trackSlug: string }) {
  const db = getDatabaseClient();
  const tz = await companyTimeZone(input.companyId);
  const now = datetime.timestamp();
  const day = datetime.today(tz).toString();

  const certificate = await db
    .selectFrom("learnCertificate")
    .selectAll()
    .where("userId", "=", input.userId)
    .where("companyId", "=", input.companyId)
    .where("trackSlug", "=", input.trackSlug)
    .where("revokedAt", "is", null)
    .orderBy("expiresAt", "desc")
    .executeTakeFirst();

  if (!certificate) return;

  const expiresAt = parseAbsolute(certificate.expiresAt, tz)
    .add({ months: CERTIFICATE_VALIDITY_MONTHS })
    .toAbsoluteString();

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("learnCertificate")
      .set({
        expiresAt,
        renewedAt: now,
        updatedBy: input.userId,
        updatedAt: now
      })
      .where("id", "=", certificate.id)
      .where("companyId", "=", input.companyId)
      .execute();

    await awardXp(trx, {
      companyId: input.companyId,
      userId: input.userId,
      amount: RENEWAL_XP,
      kind: "renewal",
      refSlug: `${certificate.id}:${now.slice(0, 10)}`,
      day
    });
  });
}

export async function revokeCertificate(input: {
  companyId: string;
  certificateId: string;
  revokedBy: string;
  reason: string;
}) {
  const db = getDatabaseClient();
  const now = datetime.timestamp();

  return db
    .updateTable("learnCertificate")
    .set({
      revokedAt: now,
      revokedBy: input.revokedBy,
      customFields: sql`COALESCE("customFields", '{}'::jsonb) || ${JSON.stringify(
        {
          revocationReason: input.reason
        }
      )}::jsonb`,
      updatedBy: input.revokedBy,
      updatedAt: now
    })
    .where("id", "=", input.certificateId)
    .where("companyId", "=", input.companyId)
    .returning("id")
    .executeTakeFirst();
}
