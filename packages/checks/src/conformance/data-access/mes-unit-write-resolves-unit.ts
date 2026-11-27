// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck, eachFile, type Violation } from "../../check";
import { blankComments, maskCommentsAndStrings } from "../../sources/comments";
import { typescript } from "../../sources/inputs";
import {
  matchBracket,
  type Region,
  regionOf,
  topLevelRegions
} from "../../sources/row-writes";
import { lineOf } from "../../sources/text";

// On a later operation of a serial part, a write names the unit the operator
// picked or scanned, never one the server chose. `resolveWorkUnit`
// (apps/mes/app/services/work-unit.server.ts) owns that rule, so every
// top-level function that writes a unit calls it, or is listed in
// UNIT_WRITE_ALLOW_LIST below with the reason it does not need to. Only the
// resolver picks a unit on the server.
//
// A nested callback counts as the top-level function it sits in, read as the
// concurrency checks read it (`topLevelRegions`, so a class method is
// `Class.method`). Every allow-list entry must still name a function that
// writes or picks, so a stale entry cannot pre-approve a later one. The check
// proves that the function calls the resolver, not that it honours the
// resolver's refusal.
export const mesUnitWriteResolvesUnit = defineCheck({
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
  reads: { files: typescript },
  rule() {
    // A stale allow-list entry's finding points here.
    const thisFile =
      "packages/checks/src/conformance/data-access/mes-unit-write-resolves-unit.ts";

    /**
     * Functions (`file#function`) that write a unit without the resolver, each
     * with its reason. A function that defines one of `unitWriteCalls` needs no
     * entry: it is the writer, and its callers are checked.
     */
    const UNIT_WRITE_ALLOW_LIST: Readonly<Record<string, string>> = {
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
     * Functions (`file#function`) that test a unit's state outside the
     * resolver, each with its reason. None of them chooses the unit a write
     * names.
     */
    const UNIT_PICK_ALLOW_LIST: Readonly<Record<string, string>> = {
      "apps/mes/app/routes/x+/operation.$operationId.tsx#loader":
        "first operation only: chooses the unit the page opens on and writes nothing",
      "apps/mes/app/services/traveler.server.ts#resolveTravelerScan":
        "tells where the scanned unit is open; the scan names the unit",
      "apps/mes/app/services/traveler.server.ts#getClaimOptions":
        "lists the open units the operator may claim; the claim goes through resolveWorkUnit"
    };

    const scope = /^apps\/mes\/app\/(?:routes\/x\+|services)\//;
    const resolver = "apps/mes/app/services/work-unit.server.ts";

    /** Postings whose input names a serial unit. */
    const unitPostingTypes = [
      "jobOperationSerialComplete",
      "jobOperationScrap",
      "trackedEntitiesToOperation",
      "unconsumeTrackedEntities",
      "scrapTrackedEntity"
    ];

    /** MES helpers that write a unit; their callers are checked by name. */
    const unitWriteCalls = [
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
    const unitTables =
      "jobOperationStepRecord|trackedActivity|trackedActivityOutput|productionEvent|productionQuantity";

    const unitWritePatterns = [
      new RegExp(`type:\\s*["'](?:${unitPostingTypes.join("|")})["']`, "g"),
      /["']trigger-(?:rework|correction)["']/g,
      new RegExp(
        `(?<!function\\s)\\b(?:${unitWriteCalls.join("|")})\\s*\\(`,
        "g"
      ),
      new RegExp(
        `\\.from\\(\\s*["'](?:${unitTables})["']\\s*\\)\\s*\\.(?:insert|upsert)\\b`,
        "g"
      ),
      new RegExp(`\\binsertInto\\(\\s*["'](?:${unitTables})\\b[^"']*["']`, "g")
    ];

    /** The server picks the unit with these; only the resolver may. */
    const serverPicks =
      /\b(?:isSerialEntityIncompleteForOperation|getNextIncompleteSerialEntity)\b/g;

    const resolves = /(?<!function\s)\bresolveWorkUnit\s*\(/g;

    type Write = { index: number; snippet: string };

    const unitWrites = (code: string, masked: string): Write[] => {
      const writes: Write[] = [];
      for (const pattern of unitWritePatterns) {
        for (const m of code.matchAll(pattern)) {
          // A match inside a string is text, not code.
          if (masked[m.index] !== code[m.index]) continue;
          writes.push({ index: m.index, snippet: m[0].replace(/\s+/g, "") });
        }
      }
      // An `issue` posting whose type is not a literal could be any of them.
      for (const m of code.matchAll(
        /\b(?:erpPosting|post)\(\s*["']issue["']/g
      )) {
        if (masked[m.index] !== code[m.index]) continue;
        const open = m.index + m[0].indexOf("(");
        const args = code.slice(open, matchBracket(masked, open) + 1);
        if (!/\btype:\s*["'][\w-]+["']/.test(args)) {
          writes.push({ index: m.index, snippet: m[0].replace(/\s+/g, "") });
        }
      }
      return writes.sort((a, b) => a.index - b.index);
    };

    const scan = (file: string, contents: string) => {
      const code = blankComments(contents);
      const masked = maskCommentsAndStrings(contents);
      const regions = topLevelRegions(masked);
      const keyOf = (region?: Region) => `${file}#${region?.name ?? "<top>"}`;

      const resolving = new Set<Region>();
      for (const m of masked.matchAll(resolves)) {
        const region = regionOf(regions, m.index);
        if (region) resolving.add(region);
      }

      const writes = unitWrites(code, masked)
        .map((w) => {
          const region = regionOf(regions, w.index);
          return { ...w, region, key: keyOf(region) };
        })
        // The definition of a checked writer is the writer itself.
        .filter((w) => !(w.region && unitWriteCalls.includes(w.region.name)));

      const picks = [...masked.matchAll(serverPicks)]
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
    };

    return ({ files }) => {
      const writers = new Set<string>();
      const pickers = new Set<string>();
      const violations = eachFile(files, (file, contents) => {
        if (!scope.test(file) || file === resolver) return [];
        const { writes, picks, resolving } = scan(file, contents);
        const out: Violation[] = [];

        for (const pick of picks) {
          pickers.add(pick.key);
          if (pick.key in UNIT_PICK_ALLOW_LIST) continue;
          out.push({
            file,
            line: lineOf(contents, pick.index),
            snippet: pick.snippet,
            message: `Only the resolver picks a unit on the server: call resolveWorkUnit, or add the function to UNIT_PICK_ALLOW_LIST in ${thisFile} with the reason`
          });
        }

        for (const write of writes) {
          writers.add(write.key);
          if (write.key in UNIT_WRITE_ALLOW_LIST) continue;
          if (write.region && resolving.has(write.region)) continue;
          out.push({
            file,
            line: lineOf(contents, write.index),
            snippet: write.snippet,
            message: `This writes a serial unit: call resolveWorkUnit in the same function first, or add the function to UNIT_WRITE_ALLOW_LIST in ${thisFile} with the reason`
          });
        }
        return out;
      });

      const stale = (list: string, entries: object, found: Set<string>) => {
        for (const key of Object.keys(entries)) {
          if (found.has(key)) continue;
          violations.push({
            file: thisFile,
            line: 0,
            snippet: key,
            message: `${list} lists ${key}, which no longer exists or no longer touches a serial unit: remove the entry`
          });
        }
      };
      stale("UNIT_WRITE_ALLOW_LIST", UNIT_WRITE_ALLOW_LIST, writers);
      stale("UNIT_PICK_ALLOW_LIST", UNIT_PICK_ALLOW_LIST, pickers);
      return violations;
    };
  }
});
