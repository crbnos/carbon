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
// Enforcement-rule AUTHORING writes for both families (server-only; embed
// `requireEntitlement`). Kept out of the client-safe `@carbon/ee/rules` barrel.
export {
  assignSalesRule,
  assignStorageRule,
  deleteEnforcementRule,
  type EnforcementRuleFamily,
  type EnforcementRuleInsert,
  type EnforcementRuleUpdate,
  unassignSalesRule,
  unassignStorageRule,
  upsertEnforcementRule
} from "./service.server";
export {
  dedupeViolations,
  type EvaluateLinesForSurfaceArgs,
  type EvaluateLinesForSurfaceResult,
  evaluateLinesForSurface,
  getStorageRulesDataForTarget,
  isBlocked,
  isStorageRulesEnabledForCompany
} from "./storage/server";
