// v1 of the in-app agent is READ-ONLY and, for cost/context safety, DOCS-ONLY:
// it answers "how Carbon works" from the product docs and can navigate/link, but it
// does NOT query the customer's live ERP data. An open-ended analytics question
// ("how many customers do I have?") could otherwise fan out list tools that return
// large row payloads into the model context — expensive and context-rotting.
//
// The data tools (search_tools / describe_tool / call_tool) and their supporting
// infra remain wired up behind this flag. v2 — the agent-with-actions milestone —
// flips this on behind an enforcement/approval gate (bounded results: counts not
// rows, injected default limits, truncation) rather than the current unbounded path.
export const AGENT_DATA_TOOLS_ENABLED: boolean = false;
