// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Client-safe entry point (`@carbon/ee/pegging`): the pure pegging functions.
export * from "./mrp-pegging";

// Type only, so no runtime edge reaches the writer: `@carbon/planning` takes
// the writer as an injected dependency (`MrpDeps`) and must name its type.
import type { writeGroupPegs } from "./peg-writer";

export type { WriteGroupPegsResult } from "./peg-writer";
export type WriteGroupPegs = typeof writeGroupPegs;
