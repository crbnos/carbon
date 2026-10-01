// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Public exports for cross-app consumers (ERP + MES). Client-safe only —
// the server evaluators/plan gates live in `./server.ts` and are imported
// via `@carbon/ee/rules.server`.
//
// Covers both rule families sharing the `@carbon/utils` engine:
// - storage rules (`./storage`): warehouse/MES transaction surfaces
// - sales rules (`./sales`): sales-document surfaces
export * from "./sales";
export * from "./storage/context";
export * from "./storage/service";
export {
  type RuleViolationPayload,
  useRuleViolations
} from "./use-violations";
export { default as RuleViolationModal } from "./violation-modal";
