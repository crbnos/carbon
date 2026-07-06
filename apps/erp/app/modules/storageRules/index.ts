// ERP-side Storage Rules module. Re-exports cross-app queries from the
// `@carbon/ee/storage-rules` package alongside ERP-only admin CRUD + form
// validators.

export {
  assignStorageRule,
  getActiveRulesForTargets,
  getRuleAssignmentsForTarget,
  getStorageRulesList,
  unassignStorageRule
} from "@carbon/ee/storage-rules";
export * from "./storageRules.models";
export * from "./storageRules.service";
