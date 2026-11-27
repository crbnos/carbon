// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { basename } from "node:path";
import type { Check, Loader, Scan, SourceFile } from "../check";
import { CHECKS } from "../checks";
import {
  UNTIMED_FETCH_ROOTS,
  untimedFetchTypescript
} from "../conformance/server";
import { classifyPath, isLicenseCandidate } from "../license-headers";
import {
  migrations,
  requestHandlingTypescript,
  routeTypescript,
  typescript
} from "../sources/inputs";
import { loadLicenseFiles } from "../sources/license-files";
import {
  ERP_MODULES_ROOT,
  ERP_SERVER_SUFFIXES,
  loadServerFiles,
  maskClientCode,
  SERVER_ROOTS,
  SERVER_ROUTE_ROOTS
} from "../sources/server-files";
import { isTrackedTestPath, loadTestFiles } from "../sources/test-files";
import {
  isTest,
  REQUEST_HANDLING_ROOTS,
  ROUTE_ROOTS,
  TYPESCRIPT_ROOTS
} from "../sources/typescript";

/** A check that reads one file at a time (`defineCheck({ files, scan })`). */
export type FileCheck = Check & { scan: Scan };

/**
 * The files one loader returns, as a predicate on one path. A check that reads
 * that loader and scans file by file is in the set (`checks`), so `brief` runs
 * it on a planned edit; file-sets.test.ts keeps each predicate equal to its
 * loader.
 */
export type FileSet = {
  name: string;
  loader: Loader<SourceFile[]>;
  includes(path: string): boolean;
  /** The `file` a violation carries, which its baseline key uses. */
  violationFile(path: string): string;
  /** The text the checks see: route modules lose their browser half. */
  prepare(path: string, contents: string): string;
  checks(): FileCheck[];
};

/** The file checks of `CHECKS` that read `loader`. */
export function fileChecksOf(loader: Loader<SourceFile[]>): FileCheck[] {
  return CHECKS.filter(
    (check): check is FileCheck =>
      "scan" in check &&
      typeof check.scan === "function" &&
      check.reads.length === 1 &&
      check.reads[0] === loader
  );
}

const MIGRATIONS_DIR = "packages/database/supabase/migrations/";

const under = (path: string, roots: readonly string[]) =>
  roots.some((root) => path.startsWith(`${root}/`));

const segments = (path: string) => path.split("/");

const hasNodeModules = (path: string) =>
  segments(path).includes("node_modules");

/** The server walk also skips dot directories and dot files. */
const hasDotSegment = (path: string) =>
  segments(path).some((segment) => segment.startsWith("."));

const isTypescriptSource = (path: string) =>
  (path.endsWith(".ts") || path.endsWith(".tsx")) &&
  !isTest(basename(path)) &&
  !hasNodeModules(path);

function isServerFile(path: string): boolean {
  if (hasNodeModules(path) || hasDotSegment(path) || isTest(basename(path))) {
    return false;
  }
  if (under(path, SERVER_ROOTS)) return path.endsWith(".ts");
  if (under(path, [ERP_MODULES_ROOT])) {
    return ERP_SERVER_SUFFIXES.some((suffix) => path.endsWith(suffix));
  }
  if (under(path, SERVER_ROUTE_ROOTS)) {
    return path.endsWith(".ts") || path.endsWith(".tsx");
  }
  return false;
}

const asIs = (_path: string, contents: string) => contents;
const samePath = (path: string) => path;

type Entry = Omit<FileSet, "checks">;

const ENTRIES: Entry[] = [
  {
    name: "migrations",
    loader: migrations,
    includes: (path) =>
      path.startsWith(MIGRATIONS_DIR) &&
      path.endsWith(".sql") &&
      !path.slice(MIGRATIONS_DIR.length).includes("/"),
    violationFile: (path) => basename(path),
    prepare: asIs
  },
  {
    name: "server",
    loader: loadServerFiles,
    includes: isServerFile,
    violationFile: samePath,
    prepare: (path, contents) =>
      under(path, SERVER_ROUTE_ROOTS) ? maskClientCode(contents) : contents
  },
  {
    name: "typescript",
    loader: typescript,
    includes: (path) =>
      under(path, TYPESCRIPT_ROOTS) && isTypescriptSource(path),
    violationFile: samePath,
    prepare: asIs
  },
  {
    name: "request-handling",
    loader: requestHandlingTypescript,
    includes: (path) =>
      under(path, REQUEST_HANDLING_ROOTS) && isTypescriptSource(path),
    violationFile: samePath,
    prepare: asIs
  },
  {
    name: "routes",
    loader: routeTypescript,
    includes: (path) => under(path, ROUTE_ROOTS) && isTypescriptSource(path),
    violationFile: samePath,
    prepare: asIs
  },
  {
    name: "untimed-fetch",
    loader: untimedFetchTypescript,
    includes: (path) =>
      under(path, UNTIMED_FETCH_ROOTS) && isTypescriptSource(path),
    violationFile: samePath,
    prepare: asIs
  },
  {
    name: "license",
    loader: loadLicenseFiles,
    includes: (path) =>
      isLicenseCandidate(path) &&
      !hasNodeModules(path) &&
      !("excluded" in classifyPath(path)),
    violationFile: samePath,
    prepare: asIs
  },
  {
    name: "tests",
    loader: loadTestFiles,
    includes: (path) => isTrackedTestPath(path) && !hasNodeModules(path),
    violationFile: samePath,
    prepare: asIs
  }
];

export const FILE_SETS: FileSet[] = ENTRIES.map((entry) => ({
  ...entry,
  checks: () => fileChecksOf(entry.loader)
}));

export function fileSetsFor(path: string): FileSet[] {
  return FILE_SETS.filter((set) => set.includes(path));
}
