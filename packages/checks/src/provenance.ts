// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Does a conformance check prove itself on the bug it exists for? A check
 * declares the commit(s) of the past fix it encodes (`provenance.incidents`),
 * and its test file replays each one: a case that names the sha and expects a
 * finding (the parent revision's code). A check whose test never fails on the
 * real bug proves only that it parses its own fixtures.
 *
 * Pure: the caller reads the files. `provenance.test.ts` runs it over every
 * check `run.ts` registers.
 */

import type { Provenance } from "./check";
import { matchBracket } from "./conformance/row-writes";

/** A commit sha as the tests cite it: 10–40 hex characters, letters and digits. */
const SHA = /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{10,40}\b/g;

/** The distinct shas a test file cites, in order of first mention. */
export function citedShas(testSource: string): string[] {
  return [...new Set(testSource.match(SHA) ?? [])];
}

/** The text of every `it(…)` / `test(…)` call in a test file: title and body. */
export function testCases(testSource: string): string[] {
  const cases: string[] = [];
  for (const m of testSource.matchAll(
    /(?<![\w$.])(?:it|test)(?:\.(?:each|only|concurrent)(?:\([^)]*\))?)?\s*\(/g
  )) {
    const open = (m.index ?? 0) + m[0].length - 1;
    cases.push(testSource.slice(open, matchBracket(testSource, open) + 1));
  }
  return cases;
}

/**
 * Whether a case expects the check to find something: an assertion left once
 * the "found nothing" forms (`toEqual([])`, `toHaveLength(0)`) are removed.
 */
export function expectsFinding(testCase: string): boolean {
  const rest = testCase.replace(
    /(?<!\.not)\.(?:toEqual|toStrictEqual)\(\s*\[\s*\]\s*\)|(?<!\.not)\.toHaveLength\(\s*0\s*\)/g,
    ""
  );
  return /\bexpect\s*\([\s\S]*?\)\s*(?:\.not)?\.to[A-Z]\w*\(/.test(rest);
}

export type ProvenanceInput = {
  id: string;
  /** The check's provenance, or null when the module exports none. */
  provenance: Provenance | null;
  /** The check's `<id>.test.ts`, or null when it has none. */
  testSource: string | null;
  /** On the list of checks written before provenance was required. */
  unproven: boolean;
};

/** What is missing for the check to prove itself; empty when it does. */
export function provenanceProblems(input: ProvenanceInput): string[] {
  const { id, provenance, testSource, unproven } = input;
  const incidents = provenance?.incidents ?? [];
  const cited = testSource ? citedShas(testSource) : [];

  if (unproven) {
    if (incidents.length > 0 || cited.length > 0) {
      return [
        `${id} is on UNPROVEN_CHECKS but its provenance or test names a fix (${[...new Set([...incidents, ...cited])].join(", ")}): declare it in provenance.incidents and remove ${id} from the list`
      ];
    }
    return [];
  }

  if (incidents.length === 0) {
    return [
      `${id} declares no provenance.incidents: name the commit of the past fix it encodes, and replay its parent revision in ${id}.test.ts (a new check cannot join UNPROVEN_CHECKS)`
    ];
  }
  if (testSource === null) {
    return [`${id} has no ${id}.test.ts to replay ${incidents.join(", ")}`];
  }

  const problems: string[] = [];
  const cases = testCases(testSource);
  for (const sha of incidents) {
    if (!/^[0-9a-f]{10,40}$/.test(sha)) {
      problems.push(
        `${id}: incident "${sha}" is not a commit sha (10–40 lowercase hex)`
      );
      continue;
    }
    if (!testSource.includes(sha)) {
      problems.push(
        `${id}: ${id}.test.ts never names ${sha}, the fix provenance.incidents declares`
      );
      continue;
    }
    const replays = cases.some(
      (c) => c.toLowerCase().includes(sha) && expectsFinding(c)
    );
    if (!replays) {
      problems.push(
        `${id}: no case in ${id}.test.ts names ${sha} and expects a finding — replay the code from before ${sha} (git show ${sha}^:<file>) and assert the check flags it`
      );
    }
  }
  for (const sha of cited) {
    if (!incidents.includes(sha)) {
      problems.push(
        `${id}: ${id}.test.ts replays ${sha}, which provenance.incidents does not declare — add the fix to incidents`
      );
    }
  }
  return problems;
}
