// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INSPECTION_STATUS_COLOR_MAP,
  JOB_OPERATION_STATUS_COLOR_MAP,
  JOB_STATUS_COLOR_MAP,
  PICKING_LIST_LINE_STATUS_COLOR_MAP,
  PICKING_LIST_STATUS_COLOR_MAP,
  TRACKED_ENTITY_STATUS_COLOR_MAP
} from "@carbon/utils/status-colors";
import { describe, expect, it } from "vitest";

/**
 * Every status this app can render must have an icon.
 *
 * `StatusBadge` exists to say a status in colour AND shape, because a tablet
 * under work lights has glare and roughly one man in twelve cannot tell its
 * red from its green. A status with no icon entry silently degrades to
 * colour-and-text — which is the exact case the component was written for —
 * and that is how `Partial` and `Short`, the two states a kitter most needs to
 * tell apart, shipped as colour-only when the picking screens landed.
 *
 * The file is read as TEXT rather than imported: `StatusBadge.tsx` imports
 * react-native, whose Flow-typed source vitest cannot parse. That makes this a
 * coverage check on the map's keys, which is exactly what is at risk — a new
 * status added to a map in @carbon/utils fails here until the icon follows.
 */
const iconKeys = (() => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "StatusBadge.tsx"),
    "utf8"
  );
  const start = source.indexOf("const STATUS_ICONS");
  if (start === -1)
    throw new Error("STATUS_ICONS is gone from StatusBadge.tsx");
  const body = source.slice(start, source.indexOf("};", start));
  return new Set(
    [...body.matchAll(/^\s+"?([A-Za-z ]+)"?:\s/gm)].map((m) => m[1] as string)
  );
})();

const ENTITIES = {
  inspection: INSPECTION_STATUS_COLOR_MAP,
  job: JOB_STATUS_COLOR_MAP,
  jobOperation: JOB_OPERATION_STATUS_COLOR_MAP,
  pickingList: PICKING_LIST_STATUS_COLOR_MAP,
  pickingListLine: PICKING_LIST_LINE_STATUS_COLOR_MAP,
  trackedEntity: TRACKED_ENTITY_STATUS_COLOR_MAP
} as const;

describe("StatusBadge icon coverage", () => {
  it.each(
    Object.entries(ENTITIES)
  )("every %s status has an icon", (_entity, map) => {
    const missing = Object.keys(map).filter((status) => !iconKeys.has(status));
    expect(missing).toEqual([]);
  });

  it("has no icon for a status no map declares", () => {
    // A stale entry is a status that was renamed or removed; it reads as
    // supported when nothing renders it.
    const declared = new Set(
      Object.values(ENTITIES).flatMap((map) => Object.keys(map))
    );
    expect([...iconKeys].filter((key) => !declared.has(key))).toEqual([]);
  });
});
