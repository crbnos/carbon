// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** A source file handed to a check: any text file, SQL or TypeScript. */
export type SourceFile = { file: string; contents: string };

/** One occurrence of a forbidden pattern. */
export type Violation = {
  /** Migration file basename, e.g. "20260101120000_foo.sql", or "<inline>" in unit tests. */
  file: string;
  /** 1-based line number; 0 if unknown. */
  line: number;
  /** The exact matched text. */
  snippet: string;
  /** Human-readable reason. */
  message: string;
};

/** Provenance: the transition event that retired the old pattern (spec §5.7). */
export type Provenance = {
  deprecates: string;
  replacedBy: string;
  /** Migration/commit that flipped the standard, if known. */
  since?: string;
  /**
   * The commit sha(s) of the past fix(es) the check encodes. The check's test
   * file names each sha in a case that replays the parent revision's code and
   * expects a finding, so the check is shown to catch the bug it exists for.
   * Enforced by `provenance.test.ts`.
   */
  incidents?: string[];
};

/**
 * A conformance check forbids a single deprecated pattern.
 * `scan` is PURE: same (file, contents) in → same violations out. No I/O.
 */
export type ConformanceCheck = {
  id: string;
  description: string;
  provenance: Provenance;
  scan(file: string, contents: string): Violation[];
};

/** A module folder and its top-level entry names. */
export type ModuleDir = { name: string; dir: string; entries: string[] };

/**
 * A structure check inspects a directory's layout (not file text).
 * `inspect` is PURE: same module in → same violations out. No I/O.
 */
export type StructureCheck = {
  id: string;
  description: string;
  provenance: Provenance;
  inspect(module: ModuleDir): Violation[];
};

/**
 * The repository a check reads. `read(load)` runs a loader once and keeps its
 * result, so checks that read the same input (every migration, the app's
 * TypeScript) share one read. A loader is any `(root) => T`; give one a name
 * at module level so every check that uses it passes the same function.
 */
export type Repo = {
  root: string;
  read<T>(load: (root: string) => T): T;
};

/**
 * One rule over the repository: what it is, and how to find where it is
 * broken. `find` says which inputs the rule reads, so adding a check is one
 * object and one line in `checks.ts`.
 */
export type Check = {
  id: string;
  description: string;
  /** The change that retired the old pattern; absent on a check that states an invariant. */
  provenance?: Provenance;
  find(repo: Repo): Violation[];
};

/** Every violation `scan` finds in `files`. */
export function eachFile(
  files: SourceFile[],
  scan: (file: string, contents: string) => Violation[]
): Violation[] {
  return files.flatMap(({ file, contents }) => scan(file, contents));
}

/**
 * A check that reads one file at a time: `check.scan` stays as it is (tests
 * call it with a fixture string), and `input` says which files it runs over.
 */
export function fileCheck(
  input: (root: string) => SourceFile[],
  check: ConformanceCheck
): ConformanceCheck & Check {
  return {
    ...check,
    find: (repo) => eachFile(repo.read(input), check.scan)
  };
}
