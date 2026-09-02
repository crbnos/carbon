// Server-only entry point (`@carbon/ee/rules.server`) — re-exports both
// evaluator families. Never import from a client module.
//
// `isBlocked` / `dedupeViolations` are shared: block/dedupe semantics are
// identical for storage and sales rules, so both come from `./storage/server`.

export {
  type EvaluateSalesRuleLinesArgs,
  type EvaluateSalesRuleLinesResult,
  type EvaluateSalesRulesForSalesDocumentArgs,
  evaluateSalesRuleLines,
  evaluateSalesRulesForSalesDocument,
  isSalesRulesEnabledForCompany,
  resolveSalesOrderShipTo,
  type SalesDocumentType
} from "./sales/server";
export {
  dedupeViolations,
  type EvaluateLinesForSurfaceArgs,
  type EvaluateLinesForSurfaceResult,
  evaluateLinesForSurface,
  getStorageRulesDataForTarget,
  isBlocked,
  isStorageRulesEnabledForCompany
} from "./storage/server";
