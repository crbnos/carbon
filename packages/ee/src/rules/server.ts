// Server-only entry point (`@carbon/ee/rules.server`) — re-exports both
// evaluator families. Never import from a client module.
//
// `isBlocked` / `dedupeViolations` are shared: block/dedupe semantics are
// identical for storage and item rules, so both come from `./storage/server`.

export {
  type EvaluateItemRuleLinesArgs,
  type EvaluateItemRuleLinesResult,
  type EvaluateItemRulesForSalesDocumentArgs,
  evaluateItemRuleLines,
  evaluateItemRulesForSalesDocument,
  isItemRulesEnabledForCompany,
  resolveSalesOrderShipTo,
  type SalesDocumentType
} from "./item/server";
export {
  dedupeViolations,
  type EvaluateLinesForSurfaceArgs,
  type EvaluateLinesForSurfaceResult,
  evaluateLinesForSurface,
  getStorageRulesDataForTarget,
  isBlocked,
  isStorageRulesEnabledForCompany
} from "./storage/server";
