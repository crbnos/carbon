// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Insert or correct the SPDX license header on every first-party source file.
 *
 *   pnpm --filter @carbon/checks license-headers              # write
 *   pnpm --filter @carbon/checks license-headers --check      # list, exit 1 if any
 *   pnpm --filter @carbon/checks license-headers --dry-run    # counts only
 *   pnpm --filter @carbon/checks license-headers -- <paths…>  # only these files
 *
 * Flags: `--verbose` lists every excluded file with its reason; `--root <dir>`
 * points at another checkout (default: this repo). Paths are resolved against
 * the directory the command was started from.
 *
 * Same walk (`listLicenseCandidates`) and same rules (`license-headers.ts`) as
 * the `spdx-license-header` check, so after a write run the check is clean.
 * Idempotent: a second run changes nothing. A file carrying a third-party
 * notice is reported and never rewritten.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  applyLicenseHeader,
  classifyFile,
  type HeaderStatus,
  inspectLicenseHeader,
  type LicenseKind
} from "../license-headers";
import { listLicenseCandidates } from "../sources/license-files";
import { repoRoot } from "../sources/migrations";

type Mode = "write" | "check" | "dry-run";

function parseArgs(argv: string[]) {
  let mode: Mode = "write";
  let verbose = false;
  let root: string | undefined;
  const paths: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--check") mode = "check";
    else if (arg === "--dry-run") mode = "dry-run";
    else if (arg === "--verbose") verbose = true;
    else if (arg === "--root") root = argv[++i];
    else if (arg === "--") continue;
    else if (arg.startsWith("--")) {
      console.error(`Unknown flag ${arg}`);
      process.exit(2);
    } else paths.push(arg);
  }
  return { mode, verbose, root, paths };
}

function main() {
  const {
    mode,
    verbose,
    root: rootArg,
    paths
  } = parseArgs(process.argv.slice(2));
  // pnpm --filter runs scripts from the package dir; INIT_CWD is where the user was.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const root = rootArg ? resolve(cwd, rootArg) : repoRoot();

  let candidates = listLicenseCandidates(root);
  if (paths.length > 0) {
    const wanted = new Set(
      paths.map((p) =>
        relative(root, isAbsolute(p) ? p : resolve(cwd, p))
          .split(sep)
          .join("/")
      )
    );
    candidates = candidates.filter((path) => wanted.has(path));
  }

  const counts: Record<LicenseKind, Record<HeaderStatus, number>> = {
    agpl: { ok: 0, missing: 0, "wrong-license": 0, malformed: 0, foreign: 0 },
    commercial: {
      ok: 0,
      missing: 0,
      "wrong-license": 0,
      malformed: 0,
      foreign: 0
    }
  };
  const excluded = new Map<string, string[]>();
  const pending: { path: string; kind: LicenseKind; status: HeaderStatus }[] =
    [];

  for (const path of candidates) {
    const full = join(root, path);
    const contents = readFileSync(full, "utf8");
    const classification = classifyFile(path, contents);
    if ("excluded" in classification) {
      const list = excluded.get(classification.reason) ?? [];
      list.push(path);
      excluded.set(classification.reason, list);
      continue;
    }
    const { kind } = classification;
    const status = inspectLicenseHeader(contents, kind);
    counts[kind][status]++;
    if (status === "ok") continue;
    pending.push({ path, kind, status });
    if (mode === "write" && status !== "foreign") {
      writeFileSync(full, applyLicenseHeader(contents, kind));
    }
  }

  const fixable = pending.filter((p) => p.status !== "foreign");
  const foreign = pending.filter((p) => p.status === "foreign");

  if (mode === "check") {
    for (const { path, kind, status } of pending) {
      console.log(`${status.padEnd(13)} ${kind.padEnd(10)} ${path}`);
    }
  }
  for (const { path } of foreign) {
    console.warn(
      `third-party notice, left untouched (add to PATH_EXCLUSIONS or fix by hand): ${path}`
    );
  }

  const excludedTotal = [...excluded.values()].reduce(
    (n, list) => n + list.length,
    0
  );
  const verb = mode === "write" ? "fixed" : "to fix";
  console.log(
    [
      `Scanned ${candidates.length} files under ${root}`,
      `  AGPL-3.0-only:       ${counts.agpl.ok} correct, ${counts.agpl.missing} missing, ${counts.agpl["wrong-license"]} wrong license, ${counts.agpl.malformed} malformed, ${counts.agpl.foreign} third-party`,
      `  Carbon Commercial:   ${counts.commercial.ok} correct, ${counts.commercial.missing} missing, ${counts.commercial["wrong-license"]} wrong license, ${counts.commercial.malformed} malformed, ${counts.commercial.foreign} third-party`,
      `  Excluded:            ${excludedTotal}`,
      ...[...excluded.entries()].map(
        ([reason, list]) => `    ${String(list.length).padStart(4)}  ${reason}`
      ),
      `${fixable.length} ${verb}${foreign.length ? `, ${foreign.length} need a human` : ""}.`
    ].join("\n")
  );
  if (verbose) {
    for (const [reason, list] of excluded) {
      console.log(`\n${reason}:\n${list.map((p) => `  ${p}`).join("\n")}`);
    }
  }

  if (mode === "check" && pending.length > 0) process.exit(1);
  if (mode === "write" && foreign.length > 0) process.exit(1);
}

main();
