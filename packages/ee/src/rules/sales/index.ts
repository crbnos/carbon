// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Public exports for cross-app consumers. Client-safe only — `server.ts`
// (evaluator + plan gate) is NOT exported here; import it via
// `@carbon/ee/rules.server`.
export {
  buildSalesRuleLineContext,
  type CustomerCtxInput,
  type SalesRuleItemCtxRow,
  type SalesRuleLineInput
} from "./context";
export * from "./service";
