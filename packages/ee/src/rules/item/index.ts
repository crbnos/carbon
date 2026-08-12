// Public exports for cross-app consumers. Client-safe only — `server.ts`
// (evaluator + plan gate) is NOT exported here; import it via
// `@carbon/ee/rules.server`.
export {
  buildItemRuleLineContext,
  type CustomerCtxInput,
  type ItemRuleItemCtxRow,
  type ItemRuleLineInput
} from "./context";
export * from "./service";
