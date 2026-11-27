// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SourceFile } from "../check";
import { blankComments, maskCommentsAndStrings } from "./comments";
import {
  matchBracket,
  type Region,
  regionOf,
  topLevelRegions
} from "./row-writes";

// The MES functions that write or pick a serial unit, for
// `mes-unit-write-resolves-unit`, and the functions allowed to do it without
// `resolveWorkUnit`. A nested callback counts as the top-level function it
// sits in, read as the concurrency checks read it (`topLevelRegions`, so a
// class method is `Class.method`). A function is keyed `file#function`.

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
const UNIT_WRITE_CALLS = [
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

const RESOLVES = /(?<!function\s)\bresolveWorkUnit\s*\(/g;

/**
 * Functions (`file#function`) that write a unit without the resolver, each
 * with its reason. A function that defines one of `UNIT_WRITE_CALLS` needs no
 * entry: it is the writer, and its callers are checked.
 */
export const UNIT_WRITE_ALLOW_LIST: Readonly<Record<string, string>> = {
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
export const UNIT_PICK_ALLOW_LIST: Readonly<Record<string, string>> = {
  "apps/mes/app/routes/x+/operation.$operationId.tsx#loader":
    "first operation only: chooses the unit the page opens on and writes nothing",
  "apps/mes/app/services/traveler.server.ts#resolveTravelerScan":
    "tells where the scanned unit is open; the scan names the unit",
  "apps/mes/app/services/traveler.server.ts#getClaimOptions":
    "lists the open units the operator may claim; the claim goes through resolveWorkUnit"
};

/** Whether the file is MES code the unit rule reads: its routes and services, not the resolver. */
export function inUnitWriteScope(file: string): boolean {
  return SCOPE.test(file) && file !== RESOLVER;
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
    const args = code.slice(open, matchBracket(masked, open) + 1);
    if (!/\btype:\s*["'][\w-]+["']/.test(args)) {
      writes.push({ index: m.index, snippet: m[0].replace(/\s+/g, "") });
    }
  }
  return writes.sort((a, b) => a.index - b.index);
}

/** The unit writes and server picks of one file, by function, and the functions that call the resolver. */
export type UnitWriteAnalysis = {
  writes: (Write & { key: string; region?: Region })[];
  picks: { index: number; snippet: string; key: string }[];
  resolving: Set<Region>;
};

export function analyzeUnitWrites(
  file: string,
  contents: string
): UnitWriteAnalysis {
  const code = blankComments(contents);
  const masked = maskCommentsAndStrings(contents);
  const regions = topLevelRegions(masked);
  const keyOf = (region?: Region) => `${file}#${region?.name ?? "<top>"}`;

  const resolving = new Set<Region>();
  for (const m of masked.matchAll(RESOLVES)) {
    const region = regionOf(regions, m.index);
    if (region) resolving.add(region);
  }

  const writes = unitWrites(code, masked)
    .map((w) => {
      const region = regionOf(regions, w.index);
      return { ...w, region, key: keyOf(region) };
    })
    // The definition of a checked writer is the writer itself.
    .filter((w) => !(w.region && UNIT_WRITE_CALLS.includes(w.region.name)));

  const picks = [...masked.matchAll(SERVER_PICKS)]
    .filter((m) => {
      const region = regionOf(regions, m.index);
      const isImport = region && masked.startsWith("import", region.start);
      const isDefinition = /function\s*$/.test(
        masked.slice(Math.max(0, m.index - 20), m.index)
      );
      return !isImport && !isDefinition;
    })
    .map((m) => ({
      index: m.index,
      snippet: m[0],
      key: keyOf(regionOf(regions, m.index))
    }));

  return { writes, picks, resolving };
}

/** The functions in scope (`file#function`) that write a unit: what an allow-list entry must still name. */
export function unitWriters(files: SourceFile[]) {
  return [
    ...new Set(
      files
        .filter(({ file }) => inUnitWriteScope(file))
        .flatMap(({ file, contents }) =>
          analyzeUnitWrites(file, contents).writes.map((w) => w.key)
        )
    )
  ].sort();
}

/** The functions in scope (`file#function`) that test a unit's state outside the resolver. */
export function unitPickers(files: SourceFile[]) {
  return [
    ...new Set(
      files
        .filter(({ file }) => inUnitWriteScope(file))
        .flatMap(({ file, contents }) =>
          analyzeUnitWrites(file, contents).picks.map((p) => p.key)
        )
    )
  ].sort();
}
