// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The run-trigger wire contract lives in the CE leaf `@carbon/workflows-core` so
// community packages (`@carbon/lib`) can depend on it without pulling in this
// commercial engine (which would form a `lib → ee → lib` cycle). Re-exported here
// so `@carbon/ee/workflows`'s public surface is unchanged.
export { type RunTrigger, runTriggerSchema } from "@carbon/workflows-core";
