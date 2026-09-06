/**
 * Carbon Learn — client-safe types.
 *
 * Nothing in this file may carry an answer key or checker logic: it is
 * re-exported through the resources module barrel and therefore bundled for the
 * browser. Question banks live in `banks/*.server.ts`, checkers in
 * `checkers/*.server.ts`.
 */

export const learnTrackSlugs = [
  "fundamentals",
  "purchasing",
  "accounting",
  "sales",
  "inventory",
  "production",
  "planning",
  "quality",
  "admin"
] as const;

export type LearnTrackSlug = (typeof learnTrackSlugs)[number];

export type LearnDocLink = {
  title: string;
  /** Absolute docs.carbon.ms URL — built with `docsRef` so the host lives in one place. */
  url: string;
};

export type LearnUnitAssessment =
  | { kind: "quiz"; questionCount: 4 | 5 }
  | { kind: "challenge"; challengeSlug: string };

export type LearnUnit = {
  slug: string;
  title: string;
  objective: string;
  estimatedMinutes: number;
  docs: LearnDocLink[];
  assessment: LearnUnitAssessment;
};

export type LearnModule = {
  slug: string;
  title: string;
  description: string;
  badgeSlug: string;
  badgeTitle: string;
  units: LearnUnit[];
};

export type LearnExamBlueprint = {
  questionCount: number;
  timeLimitMinutes: number;
  topics: Array<{ topic: string; count: number }>;
};

export type LearnChallengeRequirement = {
  key: string;
  label: string;
};

export type LearnChallengeMeta = {
  slug: string;
  trackSlug: LearnTrackSlug;
  title: string;
  /** The scenario. Capstones state the outcome without step-by-step instructions. */
  brief: string;
  requirements: LearnChallengeRequirement[];
  capstone: boolean;
};

export type LearnTrack = {
  slug: LearnTrackSlug;
  title: string;
  description: string;
  audience: string;
  modules: LearnModule[];
  requiredChallengeSlugs: string[];
  exam: LearnExamBlueprint;
  challenges: LearnChallengeMeta[];
  status: "live" | "coming-soon";
};

export type LearnQuestionKind = "single" | "multi";
export type LearnQuestionBloom = "remember" | "apply" | "analyze";

/** What the runner receives: no answer, no explanation. */
export type LearnServedQuestion = {
  slug: string;
  kind: LearnQuestionKind;
  prompt: string;
  options: Array<{ id: string; text: string }>;
};

/** Server-only shape held in the banks. */
export type LearnQuestion = LearnServedQuestion & {
  unitSlug: string;
  topic: string;
  bloom: LearnQuestionBloom;
  answer: string | string[];
  explanation: string;
  docsUrl: string;
};

export type LearnCheckResult =
  | { passed: true; evidence: Record<string, unknown> }
  | { passed: false; failedRequirement: string; message: string };

export type LearnXpKind =
  | "unit_quiz"
  | "challenge"
  | "module_badge"
  | "certification"
  | "renewal";

export type LearnCertificateStatus =
  | "Active"
  | "Expiring"
  | "Expired"
  | "Revoked";

export type LearnTeamStatus =
  | "Not started"
  | "In progress"
  | "Certified"
  | "Expired"
  | "Revoked"
  | "Overdue";
