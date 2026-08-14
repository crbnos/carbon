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
