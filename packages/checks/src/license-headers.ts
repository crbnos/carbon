// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * SPDX license headers — the ONE place that says what each first-party source
 * file's header is, which files carry which, and how a header is inserted.
 *
 * Shared by the `spdx-license-header` conformance check and the fixer script
 * (`pnpm --filter @carbon/checks license-headers`), so the two cannot disagree:
 * the check passes a file exactly when `applyLicenseHeader` would leave it
 * unchanged.
 *
 * Licensing (root LICENSE + packages/ee/LICENSE): the Enterprise files are every
 * file under `packages/ee/` and every file anywhere whose NAME contains `.ee.`;
 * they are under the Carbon Commercial License only. Everything else first-party
 * is AGPL-3.0-only.
 *
 * Pure: no I/O. The file walk lives in `sources/license-files.ts`.
 */

export type LicenseKind = "agpl" | "commercial";

/** Header lines, without line endings. `//` is a comment in every in-scope language. */
export const LICENSE_HEADERS: Record<LicenseKind, readonly string[]> = {
  agpl: [
    "// SPDX-License-Identifier: AGPL-3.0-only",
    "// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,",
    "// including ports, remain AGPLv3; serving them over a network requires releasing their source."
  ],
  commercial: [
    "// SPDX-License-Identifier: LicenseRef-Carbon-Commercial",
    "// Carbon Enterprise file, licensed only under the Carbon Commercial License",
    // packages/ee/LICENSE §1 permits viewing, and copying/sharing only in source
    // form as part of Carbon's source; §2 makes every other use — "including
    // running, testing, developing with, or modifying" — need a commercial license.
    "// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license."
  ]
};

/** Directories (and root-level files) whose tracked sources carry a header. */
export const LICENSE_ROOTS = [
  "apps",
  "packages",
  "crates",
  "docs",
  "ci",
  "scripts"
] as const;

/** Extensions in scope. SQL, CSS, JSON and MDX are not. */
export const LICENSE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".rs"
] as const;

type PathExclusion = {
  /** A repo-relative path, or a predicate over one. */
  match: string | ((path: string) => boolean);
  reason: string;
};

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * Files that never get a header, each with its reason. A GENERATED file is
 * excluded because its generator would clobber the header on the next run (the
 * generators are deliberately not changed to emit one). A THIRD-PARTY file
 * carries someone else's license and copyright.
 *
 * Not listed because they are outside the walk already: untracked/ignored
 * files (build output, node_modules, react-router typegen, fonts.data.ts,
 * docs/lib/*.generated.ts, tool-metadata.json), `.ai/`, `.claude/`,
 * `.github/`, `contrib/` and `patches/`.
 */
export const PATH_EXCLUSIONS: readonly PathExclusion[] = [
  {
    match: (path) => basename(path) === "sst-env.d.ts",
    reason: "generated: SST rewrites sst-env.d.ts on every `sst` run"
  },
  {
    match: "packages/database/src/types.ts",
    reason:
      "generated: `pnpm run generate:types` (scripts/lib/generate-db-types.ts)"
  },
  {
    match: "packages/database/src/swagger-docs-schema.ts",
    reason:
      "generated: `pnpm run generate:swagger` (scripts/generate-swagger-docs.ts)"
  },
  {
    match: (path) =>
      path.startsWith("packages/ee/src/workflows/catalog/") &&
      basename(path).includes(".generated."),
    reason:
      "generated: `pnpm run generate:workflow-catalog`, byte-compared by `check:workflow-catalog`"
  },
  {
    match: "packages/ee/src/paperless-parts/lib/client.ts",
    reason:
      "generated: swagger-typescript-api output from Paperless Parts' OpenAPI spec, regenerated per its own header"
  },
  {
    match: "packages/database/supabase/edge-runtime/main/index.ts",
    reason: "third-party: derived from Supabase's self-hosting template"
  }
];

type ContentExclusion = { marker: RegExp; reason: string };

/** How many lines (after any shebang and header) are searched for a content marker. */
const CONTENT_MARKER_LINES = 5;

/**
 * Generated files recognised by what they say, not where they live — for
 * generators that write a directory shared with hand-written files, and as a
 * net for a generator added later.
 */
export const CONTENT_EXCLUSIONS: readonly ContentExclusion[] = [
  {
    marker: /Preview fixture — mirrors what getNotificationContent builds/,
    reason:
      "generated: packages/documents/scripts/generate-notification-previews.mjs"
  },
  {
    marker:
      /@generated|auto-?generated|GENERATED FILE|DO NOT EDIT|this file is generated/i,
    reason: "generated: carries a generated-file marker"
  }
];

export type LicenseClassification =
  | { kind: LicenseKind }
  | { excluded: true; reason: string };

export function hasLicenseExtension(path: string): boolean {
  return LICENSE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/** In a license root (or a root-level file) with an in-scope extension. */
export function isLicenseCandidate(path: string): boolean {
  if (!hasLicenseExtension(path)) return false;
  if (!path.includes("/")) return true;
  return LICENSE_ROOTS.some((root) => path.startsWith(`${root}/`));
}

/** Enterprise = under packages/ee/, or `.ee.` anywhere in the file NAME. */
export function isEnterprisePath(path: string): boolean {
  return path.startsWith("packages/ee/") || basename(path).includes(".ee.");
}

/** Classification by path alone (repo-relative, `/`-separated). */
export function classifyPath(path: string): LicenseClassification {
  for (const exclusion of PATH_EXCLUSIONS) {
    const hit =
      typeof exclusion.match === "string"
        ? exclusion.match === path
        : exclusion.match(path);
    if (hit) return { excluded: true, reason: exclusion.reason };
  }
  return { kind: isEnterprisePath(path) ? "commercial" : "agpl" };
}

/** Classification by path, then by the file's leading lines. */
export function classifyFile(
  path: string,
  contents: string
): LicenseClassification {
  const byPath = classifyPath(path);
  if ("excluded" in byPath) return byPath;
  const leading = leadingLines(contents);
  for (const exclusion of CONTENT_EXCLUSIONS) {
    if (exclusion.marker.test(leading)) {
      return { excluded: true, reason: exclusion.reason };
    }
  }
  return byPath;
}

export type HeaderStatus =
  /** Correct header, followed by exactly one blank line. */
  | "ok"
  /** No SPDX header at all. */
  | "missing"
  /** The other license's header (e.g. a file moved into or out of packages/ee). */
  | "wrong-license"
  /** Our SPDX identifier, but the text or spacing around it is not canonical. */
  | "malformed"
  /**
   * Someone else's notice: a non-Carbon SPDX identifier, `@license`, or a
   * copyright line. Never rewritten — that would relicense third-party code.
   * Exclude the file in PATH_EXCLUSIONS (with its reason) or fix it by hand.
   */
  | "foreign";

type Parsed = {
  /** A leading byte-order mark, kept first. */
  bom: string;
  /** The shebang line without its line ending, or "" — it must stay on line 1. */
  shebang: string;
  /** Everything after the shebang line. */
  body: string;
  eol: string;
};

function parse(contents: string): Parsed {
  const eol = contents.includes("\r\n") ? "\r\n" : "\n";
  let rest = contents;
  let bom = "";
  if (rest.startsWith("\uFEFF")) {
    bom = "\uFEFF";
    rest = rest.slice(1);
  }
  let shebang = "";
  // `#![` is a Rust inner attribute, not a shebang.
  if (rest.startsWith("#!") && !rest.startsWith("#![")) {
    const end = rest.indexOf("\n");
    const line = end === -1 ? rest : rest.slice(0, end);
    shebang = line.replace(/\r$/, "");
    rest = end === -1 ? "" : rest.slice(end + 1);
  }
  return { bom, shebang, body: rest, eol };
}

const LEADING_BLANK_LINES = /^(?:[ \t]*\r?\n)+/;

const OUR_SPDX_LINES = new Map<string, LicenseKind>([
  [LICENSE_HEADERS.agpl[0] as string, "agpl"],
  [LICENSE_HEADERS.commercial[0] as string, "commercial"]
]);

/**
 * Lines of a header wording that has since been replaced. When the text in
 * LICENSE_HEADERS changes, move the old lines here so the fixer swaps the old
 * header out instead of stacking the new one above it. Only lines listed here
 * or in LICENSE_HEADERS are ever stripped: a file's own comments are never
 * guessed to be part of a header.
 */
export const RETIRED_HEADER_LINES: readonly string[] = [
  "// Copyright (C) Carbon Manufacturing Systems Corporation.",
  "// Copyright (C) Carbon Manufacturing Systems Corporation and contributors."
];

const KNOWN_HEADER_LINES = new Set<string>([
  ...LICENSE_HEADERS.agpl,
  ...LICENSE_HEADERS.commercial,
  ...RETIRED_HEADER_LINES
]);

/**
 * Strip every leading Carbon SPDX header from `body` — our SPDX line plus the
 * known header lines after it, repeated so a doubled header collapses to one.
 * Returns the remainder (leading blank lines intact) and the license the FIRST
 * stripped header named, or null when there was none.
 */
function stripHeaders(body: string): {
  rest: string;
  found: LicenseKind | null;
} {
  let found: LicenseKind | null = null;
  let rest = body;
  for (;;) {
    const candidate =
      found === null ? rest : rest.replace(LEADING_BLANK_LINES, "");
    const lines = candidate.split("\n");
    const line = (i: number) => (lines[i] as string).replace(/\r$/, "");
    const kind = OUR_SPDX_LINES.get(line(0));
    if (!kind) return { rest, found };
    found ??= kind;
    let n = 1;
    while (
      n < lines.length &&
      KNOWN_HEADER_LINES.has(line(n)) &&
      !OUR_SPDX_LINES.has(line(n))
    ) {
      n++;
    }
    rest = lines.slice(n).join("\n");
  }
}

/** The first lines after any shebang and Carbon header, for marker searches. */
function leadingLines(contents: string): string {
  return stripHeaders(parse(contents).body)
    .rest.replace(LEADING_BLANK_LINES, "")
    .split(/\r?\n/)
    .slice(0, CONTENT_MARKER_LINES)
    .join("\n");
}

const FOREIGN_NOTICE =
  /SPDX-License-Identifier|@license\b|\bCopyright\b|\(c\)\s*\d{4}/i;

/**
 * The file with exactly the `kind` header: after any shebang (and BOM), above
 * everything else — directives, `// @ts-nocheck`, triple-slash references,
 * Rust `//!` docs and `#![...]` attributes all remain valid after a comment —
 * then exactly one blank line. An existing Carbon header (either license, or a
 * stale wording of it) is replaced. Line endings and the trailing newline are
 * kept. Idempotent. A file with a FOREIGN notice is returned unchanged.
 */
export function applyLicenseHeader(
  contents: string,
  kind: LicenseKind
): string {
  if (inspectForeign(contents)) return contents;
  const { bom, shebang, body, eol } = parse(contents);
  const rest = stripHeaders(body).rest.replace(LEADING_BLANK_LINES, "");
  return (
    bom +
    (shebang ? shebang + eol : "") +
    LICENSE_HEADERS[kind].join(eol) +
    eol +
    (rest.length > 0 ? eol + rest : "")
  );
}

function inspectForeign(contents: string): boolean {
  return FOREIGN_NOTICE.test(leadingLines(contents));
}

export function inspectLicenseHeader(
  contents: string,
  kind: LicenseKind
): HeaderStatus {
  if (inspectForeign(contents)) return "foreign";
  if (applyLicenseHeader(contents, kind) === contents) return "ok";
  const { found } = stripHeaders(parse(contents).body);
  if (found === null) return "missing";
  return found === kind ? "malformed" : "wrong-license";
}
