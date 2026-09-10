/**
 * Resolving the schema baseline the drift check compares against.
 *
 * Split out of `check-backups.ts` so it can be tested without a database: the
 * script owns the process (connecting, printing, exiting), this owns the decision
 * of WHICH baseline to use and WHY. Nothing here touches `process` or `console` —
 * warnings come back as data so a test can assert on them.
 */

import type { Manifest } from "../backups/schema";

/** Repo-relative: the same string works for the fetch URL and for `git show`. */
export const SCHEMA_REPO_PATH = "packages/jobs/manifests/schema.json";
export const BASELINE_BRANCH = "main";

/** A refusal the caller should surface and exit 1 on — never a silent skip. */
export class BaselineError extends Error {}

/** `owner/repo` from a git remote URL, or null when it is not a GitHub remote. */
export function parseGithubSlug(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  const match = remoteUrl
    .trim()
    .match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

export function baselineUrl(slug: string): string {
  return `https://raw.githubusercontent.com/${slug}/${BASELINE_BRANCH}/${SCHEMA_REPO_PATH}`;
}

/**
 * Absent and unreadable are different answers, and conflating them produces a
 * confidently wrong message: "could not be found" sends the reader hunting for a
 * file that is sitting right there, corrupt.
 */
export function parseBaseline(text: string, source: string): Manifest {
  try {
    return JSON.parse(text) as Manifest;
  } catch (err) {
    throw new BaselineError(
      `The schema baseline at ${source} could not be read.\n` +
        `  ${err instanceof Error ? err.message : String(err)}\n` +
        "  It is present but not valid JSON, so no verdict is possible."
    );
  }
}

const STALE_NOTE =
  `  Falling back to your local origin/${BASELINE_BRANCH} copy, which can be months old if you have not pulled.\n` +
  "  An older baseline is a STRICTER check, never a blinder one — but it can flag a column a teammate already removed.";

export type BaselineSources = {
  /** `git remote get-url origin`, or null when it cannot be read. */
  remoteUrl: () => string | null;
  /** The file's text from GitHub. `null` = a 404. Throwing = a network problem. */
  fetchText: (url: string) => Promise<string | null>;
  /** The file's text from the local `origin/main` ref, or null when absent. */
  localText: () => string | null;
};

export type ResolvedBaseline = {
  manifest: Manifest;
  source: string;
  warnings: string[];
};

/**
 * The schema `main` currently ships, which is what a customer's existing backup was
 * taken against. Never the working-tree copy: that is regenerated from the live
 * database on every successful run, so it would compare today's schema with itself.
 *
 * A network problem degrades to the local copy with a warning; a baseline in
 * NEITHER place throws, because a missing baseline skipped quietly is
 * indistinguishable from a passing check.
 */
export async function resolveBaseline(
  sources: BaselineSources
): Promise<ResolvedBaseline> {
  const warnings: string[] = [];
  const slug = parseGithubSlug(sources.remoteUrl());

  if (slug) {
    const url = baselineUrl(slug);
    // The parse stays OUTSIDE this try: a corrupt baseline is a refusal, and
    // catching it here would silently downgrade it to "fetch failed" and fall
    // through to the local copy.
    let fetched: string | null = null;
    try {
      fetched = await sources.fetchText(url);
      if (fetched === null) {
        warnings.push(
          `⚠ ${SCHEMA_REPO_PATH} is not on ${BASELINE_BRANCH} yet (404).\n${STALE_NOTE}`
        );
      }
    } catch (err) {
      warnings.push(
        `⚠ Could not fetch the schema baseline from ${BASELINE_BRANCH} — ${
          err instanceof Error ? err.message : String(err)
        }\n${STALE_NOTE}`
      );
    }
    if (fetched !== null) {
      return { manifest: parseBaseline(fetched, url), source: url, warnings };
    }
  } else {
    warnings.push(
      `⚠ origin is not a GitHub remote, so the baseline could not be fetched.\n${STALE_NOTE}`
    );
  }

  const ref = `origin/${BASELINE_BRANCH}:${SCHEMA_REPO_PATH}`;
  const local = sources.localText();
  if (local !== null) {
    return {
      manifest: parseBaseline(local, ref),
      source: `origin/${BASELINE_BRANCH} (local copy)`,
      warnings
    };
  }

  throw new BaselineError(
    "The schema baseline could not be found.\n" +
      `  Looked on ${BASELINE_BRANCH} at GitHub and in your local origin/${BASELINE_BRANCH}, for ${SCHEMA_REPO_PATH}.\n` +
      "  A missing baseline cannot be skipped quietly — it would look exactly like a passing check.\n" +
      "  If this is the first commit to introduce the baseline, commit it once with:\n" +
      "    CARBON_SKIP_BACKUP_CHECK=1 git commit ..."
  );
}
