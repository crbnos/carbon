// Storage Rules cross-app queries live in the `@carbon/ee/rules` package
// (shared with MES); the ERP-only admin CRUD + validators live in
// `inventory.service.ts` / `inventory.models.ts`.
export {
  assignStorageRule,
  getActiveRulesForTargets,
  getRuleAssignmentsForTarget,
  getStorageRulesList,
  unassignStorageRule
} from "@carbon/ee/rules";
export * from "./inventory.models";
export * from "./inventory.service";
export * from "./types";
export * from "./ui";
