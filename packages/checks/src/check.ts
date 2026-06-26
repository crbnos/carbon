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

/**
 * A conformance check forbids a single deprecated pattern.
 * `scan` is PURE: same (file, contents) in → same violations out. No I/O.
 */
export type ConformanceCheck = {
  id: string;
  description: string;
  /** Provenance: the transition event that retired the old pattern (spec §5.7). */
  provenance: {
    deprecates: string;
    replacedBy: string;
    /** Migration/commit that flipped the standard, if known. */
    since?: string;
  };
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
  provenance: { deprecates: string; replacedBy: string; since?: string };
  inspect(module: ModuleDir): Violation[];
};
