// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";
import { maskCommentsAndStrings } from "./no-default-on-effects";
import { blankComments } from "./no-unscoped-kysely-write";

// On a later operation of a serial part, a write names the unit the operator
// picked or scanned, never one the server chose. `resolveWorkUnit`
// (apps/mes/app/services/work-unit.server.ts) owns that rule, so every
// top-level function that writes a unit calls it, or is listed below with the
// reason it does not need to. Only the resolver picks a unit on the server.
const SCOPE = /^apps\/mes\/app\/(?:routes\/x\+|services)\//;
const RESOLVER = "apps/mes/app/services/work-unit.server.ts";

/** Postings whose input names a serial unit. */
const UNIT_POSTING_TYPES = [
  "jobOperationSerialComplete",
  "jobOperationScrap",
  "trackedEntitiesToOperation",
  "unconsumeTrackedEntities",
  "scrapTrackedEntity"
];

/** MES helpers that write a unit; their callers are checked by name. */
export const UNIT_WRITE_CALLS = [
  "startProductionEvent",
  "startMachineProductionEvent",
  "insertAttributeRecord",
  "insertReworkQuantity",
  "insertProductionQuantity",
  "insertProductionQuantityIfCurrent",
  "insertScrapQuantity",
  "completeAllStepsForUnit",
  "createQualityIssue"
];

/** Production tables whose new row names the unit it was made for. */
const UNIT_TABLES =
  "jobOperationStepRecord|trackedActivity|trackedActivityOutput|productionEvent|productionQuantity";

/** The writes that name or imply a serial unit (matched with comments blanked). */
const UNIT_WRITES = [
  new RegExp(`type:\\s*["'](?:${UNIT_POSTING_TYPES.join("|")})["']`, "g"),
  /["']trigger-(?:rework|correction)["']/g,
  new RegExp(
    `(?<!function\\s)\\b(?:${UNIT_WRITE_CALLS.join("|")})\\s*\\(`,
    "g"
  ),
  new RegExp(
    `\\.from\\(\\s*["'](?:${UNIT_TABLES})["']\\s*\\)\\s*\\.(?:insert|upsert)\\b`,
    "g"
  ),
  new RegExp(`\\binsertInto\\(\\s*["'](?:${UNIT_TABLES})\\b[^"']*["']`, "g")
];

/** The server picks the unit with these; only the resolver may. */
const SERVER_PICKS =
  /\b(?:isSerialEntityIncompleteForOperation|getNextIncompleteSerialEntity)\b/g;

/**
 * Functions (`file#function`) that write a unit without the resolver, each
 * with its reason. A function that defines one of `UNIT_WRITE_CALLS` needs no
 * entry: it is the writer, and its callers are checked.
 */
export const UNIT_WRITE_ALLOW_LIST: Record<string, string> = {
  "apps/mes/app/routes/x+/trigger-rework.tsx#action":
    "the units are chosen explicitly in the dialog",
  "apps/mes/app/routes/x+/inspection-lot.$id.disposition.tsx#action":
    "inspection lot: the units are the lot's samples and the operator's allocation",
  "apps/mes/app/services/quality.server.ts#postSerialCompletions":
    "inspection lot: completes the lot's passed samples, read server-side",
  "apps/mes/app/services/quality.server.ts#postBulkCompletion":
    "inspection lot: a non-serial completion, which names no unit",
  "apps/mes/app/services/quality.server.ts#createInspectionRejectionIssue":
    "inspection lot: the rejection NCR takes the lot's sampled units",
  "apps/mes/app/services/operations.service.ts#insertBatchStepRecords":
    "a batch records index 0 on every member operation and names no unit"
};

/**
 * Functions (`file#function`) that test a unit's state outside the resolver,
 * each with its reason. None of them chooses the unit a write names.
 */
export const UNIT_PICK_ALLOW_LIST: Record<string, string> = {
  "apps/mes/app/routes/x+/operation.$operationId.tsx#loader":
    "first operation only: chooses the unit the page opens on and writes nothing",
  "apps/mes/app/services/traveler.server.ts#resolveTravelerScan":
    "tells where the scanned unit is open; the scan names the unit",
  "apps/mes/app/services/traveler.server.ts#getClaimOptions":
    "lists the open units the operator may claim; the claim goes through resolveWorkUnit"
};

const lineOf = (contents: string, index: number) =>
  contents.slice(0, index).split("\n").length;

type Region = { start: number; name: string; isImport: boolean };

const DECLARATION =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+([\w$]+)|(?:const|let|var)\s+([\w$]+))/;

/**
 * The file's top-level statements. Biome puts every top-level statement at
 * column 0 and indents everything inside one, so a line that starts with an
 * identifier character in the masked text opens the next statement.
 */
function topLevelRegions(masked: string): Region[] {
  const regions: Region[] = [];
  let offset = 0;
  for (const line of masked.split("\n")) {
    if (/^[A-Za-z_$@]/.test(line)) {
      const m = DECLARATION.exec(line);
      regions.push({
        start: offset,
        name: m?.[1] ?? m?.[2] ?? `<line ${lineOf(masked, offset)}>`,
        isImport: line.startsWith("import")
      });
    }
    offset += line.length + 1;
  }
  return regions;
}

function regionAt(regions: Region[], index: number): Region | undefined {
  let found: Region | undefined;
  for (const region of regions) {
    if (region.start > index) break;
    found = region;
  }
  return found;
}

/** Index just past the `)` that closes the call opened at `open`. */
function closingParen(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return masked.length;
}

type Write = { index: number; snippet: string };

function unitWrites(code: string, masked: string): Write[] {
  const writes: Write[] = [];
  for (const pattern of UNIT_WRITES) {
    for (const m of code.matchAll(pattern)) {
      // A match inside a string is text, not code.
      if (masked[m.index] !== code[m.index]) continue;
      writes.push({ index: m.index, snippet: m[0].replace(/\s+/g, "") });
    }
  }
  // An `issue` posting whose type is not a literal could be any of them.
  for (const m of code.matchAll(/\b(?:erpPosting|post)\(\s*["']issue["']/g)) {
    if (masked[m.index] !== code[m.index]) continue;
    const open = m.index + m[0].indexOf("(");
    const args = code.slice(open, closingParen(masked, open));
    if (!/\btype:\s*["'][\w-]+["']/.test(args)) {
      writes.push({ index: m.index, snippet: m[0].replace(/\s+/g, "") });
    }
  }
  return writes.sort((a, b) => a.index - b.index);
}

const RESOLVES = /(?<!function\s)\bresolveWorkUnit\s*\(/g;

type Analysis = {
  regions: Region[];
  writes: (Write & { key: string; region?: Region })[];
  picks: { index: number; snippet: string; key: string }[];
  resolving: Set<Region>;
};

function analyze(file: string, contents: string): Analysis {
  const code = blankComments(contents);
  const masked = maskCommentsAndStrings(contents);
  const regions = topLevelRegions(masked);
  const keyOf = (region?: Region) => `${file}#${region?.name ?? "<top>"}`;

  const resolving = new Set<Region>();
  for (const m of masked.matchAll(RESOLVES)) {
    const region = regionAt(regions, m.index);
    if (region) resolving.add(region);
  }

  const writes = unitWrites(code, masked)
    .map((w) => {
      const region = regionAt(regions, w.index);
      return { ...w, region, key: keyOf(region) };
    })
    // The definition of a checked writer is the writer itself.
    .filter((w) => !(w.region && UNIT_WRITE_CALLS.includes(w.region.name)));

  const picks = [...masked.matchAll(SERVER_PICKS)]
    .filter((m) => {
      const region = regionAt(regions, m.index);
      const isDefinition = /function\s*$/.test(
        masked.slice(Math.max(0, m.index - 20), m.index)
      );
      return !region?.isImport && !isDefinition;
    })
    .map((m) => ({
      index: m.index,
      snippet: m[0],
      key: keyOf(regionAt(regions, m.index))
    }));

  return { regions, writes, picks, resolving };
}

export const mesUnitWriteResolvesUnit: ConformanceCheck = {
  id: "mes-unit-write-resolves-unit",
  description:
    "An MES function that writes a serial unit calls resolveWorkUnit, and only the resolver picks a unit on the server",
  provenance: {
    deprecates:
      "an MES route that checks (or picks) the serial unit it writes on its own",
    replacedBy:
      "`resolveWorkUnit` in apps/mes/app/services/work-unit.server.ts",
    since: "2026-11-18"
  },
  scan(file: string, contents: string): Violation[] {
    if (!SCOPE.test(file) || file === RESOLVER) return [];
    const { writes, picks, resolving } = analyze(file, contents);
    const violations: Violation[] = [];

    for (const pick of picks) {
      if (pick.key in UNIT_PICK_ALLOW_LIST) continue;
      violations.push({
        file,
        line: lineOf(contents, pick.index),
        snippet: pick.snippet,
        message:
          "Only the resolver picks a unit on the server: call resolveWorkUnit, or add the function to UNIT_PICK_ALLOW_LIST with the reason"
      });
    }

    for (const write of writes) {
      if (write.key in UNIT_WRITE_ALLOW_LIST) continue;
      if (write.region && resolving.has(write.region)) continue;
      violations.push({
        file,
        line: lineOf(contents, write.index),
        snippet: write.snippet,
        message:
          "This writes a serial unit: call resolveWorkUnit in the same function first, or add the function to UNIT_WRITE_ALLOW_LIST with the reason"
      });
    }
    return violations;
  }
};

/** The functions in scope (`file#function`) that write a unit, for the review-list test. */
export function unitWriters(files: { file: string; contents: string }[]) {
  return [
    ...new Set(
      files
        .filter(({ file }) => SCOPE.test(file) && file !== RESOLVER)
        .flatMap(({ file, contents }) =>
          analyze(file, contents).writes.map((w) => w.key)
        )
    )
  ].sort();
}

/** The functions in scope (`file#function`) that test a unit's state outside the resolver. */
export function unitPickers(files: { file: string; contents: string }[]) {
  return [
    ...new Set(
      files
        .filter(({ file }) => SCOPE.test(file) && file !== RESOLVER)
        .flatMap(({ file, contents }) =>
          analyze(file, contents).picks.map((p) => p.key)
        )
    )
  ].sort();
}
