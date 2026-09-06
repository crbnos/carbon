/**
 * Carbon Learn — every gamification constant and every pure rule in one file,
 * so the numbers can be audited in a single place and unit-tested without a
 * database. Nothing here touches Supabase, Kysely, or a request.
 *
 * The economy follows Trailhead's published shape: quiz XP decays on retries so
 * guessing gets cheaper, hands-on challenges pay 5x and never decay so the
 * error -> fix -> re-check loop stays free. Streaks are WEEKLY (not daily):
 * daily chains punish weekends, which is why GitHub removed them.
 */

import type { LearnExamBlueprint } from "./types";

/**
 * Bump on ANY change to a question bank, a checker, or a track's structure.
 * Certificates are stamped with it, and an in-flight attempt whose version no
 * longer matches is voided rather than graded against content it never saw.
 */
export const LEARN_CONTENT_VERSION = "2026.09.1";

/** XP for a unit quiz by the attempt number on which it was PASSED. */
export const QUIZ_XP_BY_PASS_ATTEMPT = [100, 50, 25] as const;
export const CHALLENGE_XP = 500;
export const MODULE_BADGE_XP = 50;
export const CERTIFICATION_XP = 1000;
export const RENEWAL_XP = 100;

export const WEEKLY_GOAL_OPTIONS = [100, 200, 500] as const;
export const DEFAULT_WEEKLY_GOAL_XP = 200;

export const HEATMAP_WEEKS = 26;
/** Daily-XP thresholds: <100 -> 1, <250 -> 2, <500 -> 3, >=500 -> 4. 0 XP -> 0. */
export const HEATMAP_BUCKETS = [100, 250, 500] as const;

export const EXAM_PASS_RATIO = 0.8;
export const EXAM_TIME_LIMIT_MINUTES = 45;
export const EXAM_COOLDOWN_FIRST_HOURS = 24;
export const EXAM_COOLDOWN_NEXT_DAYS = 7;

export const CERTIFICATE_VALIDITY_MONTHS = 12;
export const RENEWAL_WINDOW_DAYS = 30;
export const RENEWAL_QUESTION_COUNT = 10;

/** Total XP required to reach `level`. L1 = 0, L2 = 500, L3 = 1500, L4 = 3000. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return 250 * level * (level - 1);
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) {
    level += 1;
  }
  return level;
}

export function quizXpForPassAttempt(attempt: number): number {
  const clamped = Math.min(
    Math.max(attempt, 1),
    QUIZ_XP_BY_PASS_ATTEMPT.length
  );
  return QUIZ_XP_BY_PASS_ATTEMPT[clamped - 1];
}

export function heatmapBucket(xp: number): 0 | 1 | 2 | 3 | 4 {
  if (xp <= 0) return 0;
  if (xp < HEATMAP_BUCKETS[0]) return 1;
  if (xp < HEATMAP_BUCKETS[1]) return 2;
  if (xp < HEATMAP_BUCKETS[2]) return 3;
  return 4;
}

/**
 * When may the learner sit the exam again?
 *
 * `failedSubmittedAt` is every FAILED attempt's `submittedAt`, ISO strings.
 * No fails -> null (may start now). One fail -> 24h after it. Two or more ->
 * 7 days after the most recent. Returns an ISO string the caller compares
 * lexicographically against `datetime.timestamp()`.
 */
export function examCooldownEnd(failedSubmittedAt: string[]): string | null {
  if (failedSubmittedAt.length === 0) return null;
  const latest = [...failedSubmittedAt].sort().at(-1);
  if (!latest) return null;
  const base = new Date(latest);
  if (Number.isNaN(base.getTime())) return null;
  const ms =
    failedSubmittedAt.length === 1
      ? EXAM_COOLDOWN_FIRST_HOURS * 60 * 60 * 1000
      : EXAM_COOLDOWN_NEXT_DAYS * 24 * 60 * 60 * 1000;
  return new Date(base.getTime() + ms).toISOString();
}

/**
 * Consecutive weeks in which the learner met their weekly XP goal.
 *
 * `weekXp` is keyed by the ISO-week Monday ("YYYY-MM-DD") in the company's
 * timezone; `currentWeekMonday` is this week's Monday. The current week can
 * only ADD to the streak — an unmet current week never breaks it, because the
 * week is not over yet. That is the whole point of a weekly streak in a
 * workday product.
 */
export function weeklyStreak(
  weekXp: Record<string, number>,
  goalXp: number,
  currentWeekMonday: string
): number {
  const mondayBefore = (monday: string, weeksBack: number): string => {
    const d = new Date(`${monday}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 7 * weeksBack);
    return d.toISOString().slice(0, 10);
  };

  let streak = 0;
  if ((weekXp[currentWeekMonday] ?? 0) >= goalXp) {
    streak += 1;
  }
  for (let back = 1; ; back += 1) {
    const monday = mondayBefore(currentWeekMonday, back);
    if ((weekXp[monday] ?? 0) >= goalXp) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * The renewal quiz opens 30 days before expiry and stays open afterwards — a
 * lapsed holder should be able to renew rather than be forced back through the
 * full exam the day after their certificate ages out.
 */
export function isWithinRenewalWindow(
  expiresAt: string,
  now: string,
  windowDays: number = RENEWAL_WINDOW_DAYS
): boolean {
  const opens = new Date(
    new Date(expiresAt).getTime() - windowDays * 24 * 60 * 60 * 1000
  ).toISOString();
  return now >= opens;
}

/** Deterministic 32-bit hash so a seed string yields a repeatable shuffle. */
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, seedable PRNG. */
function makeRandom(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: T[], seed: string): T[] {
  const out = [...items];
  const random = makeRandom(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Draw one exam form: `count` questions per blueprint topic, preferring
 * questions the learner has not just seen (`exclude`) so a retake is a fresh
 * form. Throws when a topic pool is too small — a silently short form would
 * make the pass bar mean something different per sitting.
 */
export function drawStratifiedForm(
  pool: Array<{ slug: string; topic: string }>,
  blueprint: LearnExamBlueprint["topics"],
  seed: string,
  exclude: Set<string> = new Set()
): string[] {
  const drawn: string[] = [];

  for (const { topic, count } of blueprint) {
    const candidates = pool.filter((q) => q.topic === topic);
    if (candidates.length < count) {
      throw new Error(
        `Exam blueprint needs ${count} questions for topic "${topic}" but the bank has ${candidates.length}`
      );
    }
    const shuffled = seededShuffle(candidates, `${seed}:${topic}`);
    const fresh = shuffled.filter((q) => !exclude.has(q.slug));
    const reused = shuffled.filter((q) => exclude.has(q.slug));
    drawn.push(...[...fresh, ...reused].slice(0, count).map((q) => q.slug));
  }

  return seededShuffle(drawn, `${seed}:order`);
}
