// Public exports for cross-app consumers (ERP + MES). Client-safe only —
// the server evaluators/plan gates live in `./server.ts` and are imported
// via `@carbon/ee/rules.server`.
//
// Covers both rule families sharing the `@carbon/utils` engine:
// - storage rules (`./storage`): warehouse/MES transaction surfaces
// - sales rules (`./item`): sales-document surfaces
export * from "./sales";
export * from "./storage/context";
export * from "./storage/service";
export {
  type RuleViolationPayload,
  useRuleViolations
} from "./use-violations";
export { default as RuleViolationModal } from "./violation-modal";
