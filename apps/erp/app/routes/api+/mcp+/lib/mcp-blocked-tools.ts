/**
 * Operations excluded from the generated generic API/MCP catalog and blocked at
 * shared dispatch. This covers HTTP v1, MCP, agent, and workflow callers;
 * direct browser imports remain unaffected.
 */
export const MCP_BLOCKED_TOOL_NAMES: readonly string[] = [
  "settings_seedCompany",
  // Creating a company is an account-level operation that must not be exposed
  // as an MCP tool (it would let a company-scoped token create new tenants).
  "settings_insertCompany",
  // The mirror of insertCompany: a bare `company` delete whose only argument is a
  // companyId the dispatcher fills from the caller's own key, so an empty body
  // deletes the caller's tenant. Its "internal users only" gate lives in the
  // settings ROUTE, which no API/MCP call passes through.
  "settings_deleteSubsidiary",
  // Internal sweep orchestration invoked by job/operation completion flows.
  // Their args require a userId the MCP executor cannot inject (AuthField has
  // no such payload field), so direct calls would only ever fail validation.
  "production_returnPickedRemaindersForOperation",
  "production_returnPickedRemaindersForJob",
  // Ungated scheduling primitive: it fires the `schedule-job` Inngest event with
  // no permission check of its own (every ERP route gates on `production` update
  // before calling it). `production_scheduleJob` is the intended MCP entry point —
  // it re-applies that gate — so the raw trigger must not be reachable via MCP.
  "production_triggerJobSchedule",
  // Bulk sales-order line insert. It has no in-app caller — it is reachable
  // only through this executor, which exposes every named export of
  // sales.service.ts. It writes lines without the sales-rule evaluation the
  // route action performs, and unlike `upsertSalesOrderLine` there is no
  // single-line path to gate.
  "sales_insertSalesOrderLines",
  // Unreachable by construction: these tables carry USER-scoped RLS
  // (`"createdBy"::uuid = auth.uid()`, migration 20260228000000_rls-refactor-3.sql),
  // but an API key authenticates by header rather than a Supabase JWT, so
  // `auth.uid()` is NULL and the predicate can never match. Blocked rather than
  // left to fail because the failure is silent for half of them — an UPDATE or
  // DELETE matching zero rows is not an error, so `deleteNote` answered 200 with
  // the row untouched. Making them work is an RLS decision, not an app-code one.
  "shared_updateNote",
  "shared_deleteNote",
  "production_deleteMaintenanceDispatchComment",
  "resources_deleteMaintenanceDispatchComment",
  "sales_updateQuoteFavorite",
  "sales_updateSalesOrderFavorite",
  "sales_updateSalesRFQFavorite",
  "purchasing_updateSupplierQuoteFavorite",
  "resources_insertTrainingCompletion",
  // Impact service boundaries require application-level authorization. Keep raw
  // operations behind permission-aware adapters rather than generic dispatch.
  "items_writeChangeNoticeImpactDecision",
  "items_writeChangeNoticeImpactDecisions",
  "items_reconcileChangeNoticeImpactProvenance",
  "items_createChangeNoticeImpactTask",
  "items_linkChangeNoticeImpactTask",
  "items_unlinkChangeNoticeImpactTask",
  "items_designateChangeNoticeImpactTask",
  "items_getChangeNoticeImpactCandidates",
  "items_getChangeNoticeImpactWorkspace",
  "items_getChangeNoticeImpactHistory",
  "items_removeChangeNoticeAffectedItem",
  // These helpers are internal implementation details, not MCP contracts. Without
  // an explicit exclusion, regenerating metadata publishes them as opaque WRITE
  // tools (and the generic parser cannot describe all of their nested inputs).
  "items_createChangeNoticeImpactPreviewFingerprint",
  "items_normalizePurchaseOrderLineImpactSnapshot",
  "items_normalizeJobImpactSnapshot",
  "items_normalizeJobMaterialImpactSnapshot",
  "items_classifyPurchaseOrderLineImpactEligibility",
  "items_classifyJobImpactEligibility",
  "items_classifyJobMaterialImpactEligibility",
  "items_deriveChangeNoticeImpactProvenance",
  "items_compareChangeNoticeImpactSnapshot",
  // Internal tenancy guard used by the authorized task mutation path; it is not
  // a generic API/MCP operation of its own.
  "items_assertChangeNoticeAssigneeIsCompanyMember",
  // Change Notice engineering writers are route-guarded; the generic dispatcher
  // must not bypass the engineering lock, parent ownership checks, or the
  // Implementation -> Done apply orchestration. Keep the guarded browser paths
  // and explicit adapters as the supported mutation boundaries.
  "items_updateChangeNotice",
  "items_updateChangeNoticeStatus",
  "items_createChangeNoticeDraftMethod",
  "items_addChangeNoticeAffectedItem",
  "items_updateChangeNoticeAffectedItemChangeType",
  "items_updateChangeNoticeAffectedItemCutover",
  // Change Notice action-task mutators are route-guarded (and some use the
  // trusted Kysely boundary); the generic MCP executor must not bypass task
  // lifecycle, workflow, and parent-scope checks.
  "items_updateChangeNoticeActionStatus",
  "items_deleteChangeNoticeAction",
  "items_updateChangeNoticeActionOrder",
  "items_setChangeNoticeActionTasks",
  "items_seedDefaultChangeNoticeActions",
  "items_updateChangeNoticeActionNotes",
  "items_updateChangeNoticeActionAssignee",
  "items_updateChangeNoticeActionDueDate",
  "items_upsertChangeNoticeRequiredAction",
  "items_deleteChangeNoticeRequiredAction"
];

export function isMcpBlockedTool(name: string): boolean {
  return MCP_BLOCKED_TOOL_NAMES.includes(name);
}
