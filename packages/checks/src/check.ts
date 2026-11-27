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

/** A module folder and its top-level entry names. */
export type ModuleDir = { name: string; dir: string; entries: string[] };

/** Reads one input of the repository: every migration, the app's TypeScript, … */
export type Loader<T> = (root: string) => T;

/**
 * The repository a check reads. `read(load)` runs a loader once and keeps its
 * result, so checks that read the same input (every migration, the app's
 * TypeScript) share one read. A loader is any `(root) => T`; give one a name
 * at module level so every check that uses it passes the same function.
 */
export type Repo = {
  root: string;
  read<T>(load: Loader<T>): T;
};

/** PURE: the violations in one file. */
export type Scan = (file: string, contents: string) => Violation[];

type About = {
  id: string;
  description: string;
  /** The change that retired the old pattern; absent on a check that states an invariant. */
  provenance?: Provenance;
};

/**
 * One rule over the repository, made by `defineCheck`. `reads` lists the
 * loaders it declared, so the runner can group checks without running them;
 * `run` loads them through `repo.read` and applies the rule.
 */
export type Check = About & {
  reads: readonly Loader<unknown>[];
  run(repo: Repo): Violation[];
};

/** Every violation `scan` finds in `files`. */
export function eachFile(files: SourceFile[], scan: Scan): Violation[] {
  return files.flatMap(({ file, contents }) => scan(file, contents));
}

type FileRule = About & { files: Loader<SourceFile[]>; scan: Scan };

type InputsRule<T> = About & {
  reads: { [K in keyof T]: Loader<T[K]> };
  find(inputs: T): Violation[];
};

/**
 * A check, from the inputs it reads and its rule over them. A rule over one
 * file at a time names its `files` and a `scan`; a rule over several inputs
 * names them in `reads` and gets them loaded in `find`. Neither sees the repo,
 * so a check reads only what it declares, and a test calls `scan` or `find`
 * with its own values.
 */
export function defineCheck(rule: FileRule): Check & { scan: Scan };
export function defineCheck<T extends Record<string, unknown>>(
  rule: InputsRule<T>
): Check & { find(inputs: T): Violation[] };
export function defineCheck(
  rule: FileRule | InputsRule<Record<string, unknown>>
): Check & {
  scan?: Scan;
  find?(inputs: Record<string, unknown>): Violation[];
} {
  if ("files" in rule) {
    const { files, scan, ...about } = rule;
    return {
      ...about,
      scan,
      reads: [files],
      run: (repo) => eachFile(repo.read(files), scan)
    };
  }
  const { reads, find, ...about } = rule;
  return {
    ...about,
    find,
    reads: Object.values(reads),
    run: (repo) =>
      find(
        Object.fromEntries(
          Object.entries(reads).map(([name, load]) => [name, repo.read(load)])
        )
      )
  };
}
