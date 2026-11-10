// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The authorization rules for every public table. `authz sync` makes a database match this
// file; `authz migration` ships a change to databases that do not sync yet (see migration.ts).
// A bare action (`"update"`) is the key of the page that owns the table (access/registry.ts;
// rules.ts `Permission`): a table's module and its read come from the registry, so a rule
// names only what differs. A page key (`purchasing.suppliers_create`) is a grant to a page
// that does not own the table, and renders as written.
import { permissionKey } from "../access/levels";
import { ITEM_PAGES } from "../access/registry";
import {
  always,
  and,
  anyOf,
  anyPageOf,
  authenticated,
  company,
  custom,
  exists,
  external,
  group,
  inCompany,
  inGroup,
  isNotNull,
  isNull,
  type Manifest,
  member,
  or,
  owner,
  policies,
  portal,
  projectModule,
  serviceOnly,
  type Table,
  through,
  throughIndexed,
  viaParent,
  where
} from "./rules";

/** Any one item page at `action`: for a row no one item decides. */
const anyItemPage = (action: "create" | "update" | "delete") =>
  anyOf(...ITEM_PAGES.map((page) => permissionKey(page, action)));

/** The payment and memo a settlement applies are both still Draft (or absent). */
const draftSettlement = and(
  or(
    isNull("paymentId"),
    exists(
      "payment",
      "paymentId",
      where<"payment">((eb) => eb("status", "=", "Draft")),
      {
        sameCompany: true
      }
    )
  ),
  or(
    isNull("memoId"),
    exists(
      "memo",
      "memoId",
      where<"memo">((eb) => eb("status", "=", "Draft")),
      {
        sameCompany: true
      }
    )
  )
);

/**
 * The value's attribute is one users manage for themselves (canSelfManage), in a category of
 * one of the caller's companies. The account route checks canSelfManage too; this makes the
 * database agree instead of trusting the route.
 */
const ownAttribute = through(
  "userAttributeId",
  "userAttribute",
  "id",
  and(
    where<"userAttribute">((eb) => eb("canSelfManage", "=", true)),
    through(
      "userAttributeCategoryId",
      "userAttributeCategory",
      "id",
      inCompany("companyId", "employee")
    )
  )
);

/**
 * Whoever can read a record can read how its document prints, by the record's own
 * read rule. Nothing writes through the API: every save validates the edit and
 * checks the record's lock on the server, as the system.
 */
const documentEditReader = or(
  and(
    where<"documentEdit">((eb) =>
      eb("documentType", "in", [
        "purchaseReturnOrder",
        "salesReturnOrder",
        "stockTransfer",
        "jobTraveler"
      ])
    ),
    inCompany("companyId", "employee")
  ),
  and(
    where<"documentEdit">((eb) => eb("documentType", "=", "purchaseOrder")),
    inCompany("companyId", anyPageOf("purchasing", "inventory", "invoicing"))
  ),
  and(
    where<"documentEdit">((eb) => eb("documentType", "=", "purchasingRfq")),
    inCompany("companyId", anyPageOf("purchasing"))
  ),
  and(
    where<"documentEdit">((eb) => eb("documentType", "=", "quote")),
    inCompany("companyId", anyPageOf("sales"))
  ),
  and(
    where<"documentEdit">((eb) => eb("documentType", "=", "salesOrder")),
    inCompany("companyId", anyPageOf("sales", "inventory", "invoicing"))
  ),
  and(
    where<"documentEdit">((eb) => eb("documentType", "=", "salesInvoice")),
    inCompany("companyId", anyPageOf("invoicing"))
  ),
  and(
    where<"documentEdit">((eb) => eb("documentType", "=", "packingSlip")),
    inCompany("companyId", anyPageOf("inventory", "sales"))
  ),
  and(
    where<"documentEdit">((eb) => eb("documentType", "=", "issue")),
    inCompany("companyId", anyPageOf("quality"))
  )
);

/** The value's attribute belongs to a category the caller manages (Attributes at Edit). */
const managedAttribute = through(
  "userAttributeId",
  "userAttribute",
  "id",
  through(
    "userAttributeCategoryId",
    "userAttributeCategory",
    "id",
    inCompany("companyId", "update")
  )
);

/** Who manages a grant row: the page of its subject column. */
const grantRows = (apiKeyAction: "view" | "create" | "update" | "delete") =>
  or(
    and(isNotNull("userId"), inCompany("companyId", "users.accounts_update")),
    and(
      isNotNull("employeeTypeId"),
      // A role's grants read like any Users table: View on a Users page (the
      // person Access tab shows the role's levels). Writing them needs Employee Types.
      inCompany(
        "companyId",
        apiKeyAction === "view"
          ? anyPageOf("users")
          : "users.employeeTypes_update"
      )
    ),
    and(
      isNotNull("apiKeyId"),
      inCompany("companyId", permissionKey("settings.apiKeys", apiKeyAction))
    )
  );

/**
 * A project table, governed by projects_* (any employee reads) in its project's company.
 * `column` names the row's project, or its element with `via: "projectElement"`.
 */
const projectTable = <T extends Table>(
  column = "projectId",
  via?: "projectElement"
) =>
  company<T>({
    read: projectModule(column, "view", { standard: "employee", via }),
    create: projectModule(column, "create", { via }),
    update: projectModule(column, "update", { via }),
    delete: projectModule(column, "delete", { via })
  });

export const manifest = {
  ability: company(),
  account: group({ read: "employee" }),
  accountDefault: company({
    create: false,
    delete: false
  }),
  accountingCutoverIgnoredInvoice: company(),
  accountingPeriod: company(),
  accountingPeriodBalance: company({
    delete: "update"
  }),
  accountingSyncOperation: company({
    read: "employee",
    create: false,
    delete: false
  }),
  accountingSyncTieOut: company({
    create: false,
    update: false,
    delete: false
  }),
  address: company(),
  agentMessage: policies({
    select: and(
      inCompany("companyId", "employee"),
      exists("agentThread", "threadId", owner("userId"), { sameCompany: true })
    ),
    insert: and(
      inCompany("companyId", "employee"),
      exists("agentThread", "threadId", owner("userId"), { sameCompany: true })
    ),
    update: and(
      inCompany("companyId", "employee"),
      exists("agentThread", "threadId", owner("userId"), { sameCompany: true })
    )
  }),
  agentMessagePart: custom(
    "EXISTS over a join of agentMessage and agentThread (the caller owns the thread); no shared piece expresses a join",
    (t) => `
    CREATE POLICY "INSERT" ON ${t} AS PERMISSIVE FOR INSERT TO public WITH CHECK ((("companyId" = ANY (( SELECT get_companies_with_employee_role() AS get_companies_with_employee_role)::text[])) AND (EXISTS ( SELECT 1
   FROM ("agentMessage" m
     JOIN "agentThread" t ON (((t.id = m."threadId") AND (t."companyId" = m."companyId"))))
  WHERE ((m.id = "agentMessagePart"."messageId") AND (m."companyId" = "agentMessagePart"."companyId") AND (t."userId" = (( SELECT auth.uid() AS uid))::text))))));
    CREATE POLICY "SELECT" ON ${t} AS PERMISSIVE FOR SELECT TO public USING ((("companyId" = ANY (( SELECT get_companies_with_employee_role() AS get_companies_with_employee_role)::text[])) AND (EXISTS ( SELECT 1
   FROM ("agentMessage" m
     JOIN "agentThread" t ON (((t.id = m."threadId") AND (t."companyId" = m."companyId"))))
  WHERE ((m.id = "agentMessagePart"."messageId") AND (m."companyId" = "agentMessagePart"."companyId") AND (t."userId" = (( SELECT auth.uid() AS uid))::text))))));
    CREATE POLICY "UPDATE" ON ${t} AS PERMISSIVE FOR UPDATE TO public USING ((("companyId" = ANY (( SELECT get_companies_with_employee_role() AS get_companies_with_employee_role)::text[])) AND (EXISTS ( SELECT 1
   FROM ("agentMessage" m
     JOIN "agentThread" t ON (((t.id = m."threadId") AND (t."companyId" = m."companyId"))))
  WHERE ((m.id = "agentMessagePart"."messageId") AND (m."companyId" = "agentMessagePart"."companyId") AND (t."userId" = (( SELECT auth.uid() AS uid))::text))))));
  `
  ),
  agentThread: policies({
    all: and(owner("userId"), inCompany("companyId", "employee"))
  }),
  apiKey: company(),
  apiKeyRateLimit: policies({
    select: exists("apiKey", "apiKeyId", "view")
  }),
  approvalRequest: serviceOnly(),
  approvalRule: company(),
  assemblyComponentMapping: company({ read: "employee" }),
  assemblyInstruction: company({ read: "employee" }),
  assemblyInstructionStep: company({ read: "employee" }),
  assemblyInstructionStepMaterial: company({ read: "employee" }),
  assemblyInstructionStepSlide: company(),
  assemblyInstructionStepTool: company(),
  assemblyPlanJob: company({ read: "employee" }),
  assemblyUnit: company({ read: "employee" }),
  attributeDataType: policies({ select: authenticated }),
  auditLogArchive: serviceOnly(),
  balloon: company({ read: "employee" }),
  // Batch properties are also kept from Tracked Entities, which wrote them before.
  batchProperty: company(),
  capacityReservation: company({ read: "employee" }),
  charge: policies({
    select: inCompany("companyId", "employee"),
    insert: and(
      where<"charge">((eb) => eb("status", "=", "Draft")),
      inCompany("companyId", "create")
    ),
    update: and(
      where<"charge">((eb) => eb("status", "=", "Draft")),
      inCompany("companyId", "update")
    ),
    delete: and(
      where<"charge">((eb) => eb("status", "=", "Draft")),
      inCompany("companyId", "delete")
    )
  }),
  chargeLine: policies({
    select: inCompany("companyId", "employee"),
    insert: and(
      exists(
        "charge",
        "chargeId",
        where<"charge">((eb) => eb("status", "=", "Draft")),
        { sameCompany: true }
      ),
      inCompany("companyId", "create")
    ),
    update: and(
      exists(
        "charge",
        "chargeId",
        where<"charge">((eb) => eb("status", "=", "Draft")),
        { sameCompany: true }
      ),
      inCompany("companyId", "update")
    ),
    delete: and(
      exists(
        "charge",
        "chargeId",
        where<"charge">((eb) => eb("status", "=", "Draft")),
        { sameCompany: true }
      ),
      inCompany("companyId", "delete")
    )
  }),
  challengeAttempt: policies({
    select: owner("userId"),
    insert: owner("userId")
  }),
  changeOrder: company(),
  changeOrderActionTask: company(),
  changeOrderAffectedItem: company(),
  changeOrderRequiredAction: company({ read: "employee" }),
  changeOrderSupersession: company(),
  changeOrderType: company({ read: "employee" }),
  changelogDispatch: serviceOnly(),
  company: policies({
    select: and(
      isNotNull("companyGroupId"),
      inGroup("companyGroupId", "employee")
    ),
    update: inCompany("id", "update")
  }),
  companyAccountsPayableBillingAddress: company({
    read: "employee",
    column: "id"
  }),
  companyAccountsReceivableBillingAddress: company({
    read: "employee",
    column: "id"
  }),
  companyGroup: policies({
    select: through("id", "company", "companyGroupId", member("id"))
  }),
  companyIntegration: company(),
  companyPlan: policies({ select: and(authenticated, member("id")) }),
  companySettings: company({
    read: "employee",
    create: false,
    delete: false,
    column: "id"
  }),
  companyUsage: policies({ select: and(authenticated, member("id")) }),
  config: policies({ select: authenticated }),
  configurationParameter: company({ read: "member" }),
  configurationParameterGroup: company({ read: "member" }),
  configurationRule: company(),
  consumable: company({ read: "employee" }),
  // Customers and Suppliers share it by isCustomer (the registry).
  contact: company(),
  contractFinancingRequest: company(),
  contractFinancingRequestEvent: company(),
  contractor: company(),
  contractorAbility: policies({
    select: viaParent("contractorId", "contractor", "view"),
    insert: viaParent("contractorId", "contractor", "create"),
    update: viaParent("contractorId", "contractor", "update"),
    delete: viaParent("contractorId", "contractor", "delete")
  }),
  costCenter: company({ read: "employee" }),
  costLedger: policies({
    select: inCompany("companyId", "view")
  }),
  country: policies({ select: authenticated }),
  currency: group({ read: "employee" }),
  currencyCode: policies({ select: authenticated }),
  customer: policies({
    select: or(
      inCompany("companyId", "view"),
      portal.customer("id", "sales_view")
    ),
    insert: inCompany("companyId", "create"),
    update: inCompany("companyId", "update"),
    delete: inCompany("companyId", "delete")
  }),
  customerAccount: policies({
    select: or(
      inCompany("companyId", "view"),
      portal.customer("customerId", "sales_view")
    ),
    insert: inCompany("companyId", "create"),
    update: inCompany("companyId", "update"),
    delete: inCompany("companyId", "delete")
  }),
  customerAsset: company({ read: "employee" }),
  customerBankAccount: company(),
  customerContact: policies({
    select: or(
      viaParent("customerId", "customer", "view"),
      portal.customer("customerId", "sales_view")
    ),
    insert: or(
      viaParent("customerId", "customer", "create"),
      portal.customer("customerId", "sales_create")
    ),
    update: or(
      viaParent("customerId", "customer", "update"),
      portal.customer("customerId", "sales_update")
    ),
    delete: or(
      viaParent("customerId", "customer", "delete"),
      portal.customer("customerId", "sales_delete")
    )
  }),
  customerContract: company(),
  customerContractAmendment: company(),
  // Government contracting Phase 5a: ACRN funding actions on a contract line.
  customerContractFinancing: company(),
  customerContractFinancingRate: company(),
  customerContractFunding: company(),
  customerContractInvoice: company(),
  customerContractInvoiceLine: company(),
  customerContractLaborRate: company(),
  customerContractLedgerEntry: company(),
  customerContractLine: company(),
  // Government contracting Phase 5b: a rate ceiling reads like its contract line.
  customerContractRateCeiling: company(),
  customerContractRevenue: company(),
  customerItemPriceOverride: company({ read: "employee" }),
  customerItemPriceOverrideBreak: company({ read: "employee" }),
  customerItemRentalRate: company(),
  customerLocation: policies({
    select: or(
      viaParent("customerId", "customer", "view"),
      portal.customer("customerId", "sales_view")
    ),
    insert: or(
      viaParent("customerId", "customer", "create"),
      portal.customer("customerId", "sales_create")
    ),
    update: or(
      viaParent("customerId", "customer", "update"),
      portal.customer("customerId", "sales_update")
    ),
    delete: or(
      viaParent("customerId", "customer", "delete"),
      portal.customer("customerId", "sales_delete")
    )
  }),
  customerPartToItem: policies({
    select: or(
      inCompany("companyId", "view"),
      or(
        portal.customer("customerId", "sales_view"),
        portal.customer("customerId", "parts_view")
      )
    ),
    insert: or(
      inCompany("companyId", anyOf("create", "sales.customers_create")),
      or(
        portal.customer("customerId", "sales_create"),
        portal.customer("customerId", "parts_create")
      )
    ),
    update: or(
      inCompany("companyId", anyOf("update", "sales.customers_update")),
      or(
        portal.customer("customerId", "sales_update"),
        portal.customer("customerId", "parts_update")
      )
    ),
    delete: or(
      inCompany("companyId", anyOf("delete", "sales.customers_delete")),
      or(
        portal.customer("customerId", "sales_delete"),
        portal.customer("customerId", "parts_delete")
      )
    )
  }),
  customerPayment: company({
    create: false,
    delete: false
  }),
  customerShipping: company({
    create: false,
    delete: false
  }),
  customerStatus: company({ read: "member" }),
  customerTax: company({
    create: false,
    delete: false
  }),
  customerType: company({ read: "member" }),
  customField: company({ read: "member" }),
  customFieldTable: policies({ select: authenticated }),
  demandActual: company(),
  demandForecast: company(),
  demandForecastSource: company(),
  demandProjection: company(),
  department: company({ read: "employee" }),
  depreciationRun: company(),
  depreciationRunLine: company(),
  dimension: group({ read: "employee" }),
  dimensionValue: group({ read: "employee" }),
  // groups_for_user is wrapped in a SELECT so Postgres runs it once per query
  // rather than once per row (it is VOLATILE), and it comes first so the
  // API-key lookup only runs for rows outside the caller's groups.
  document: custom(
    "bespoke: readGroups/writeGroups arrays via groups_for_user, plus has_valid_api_key_for_company",
    (t) => `
    CREATE POLICY "DELETE" ON ${t} AS PERMISSIVE FOR DELETE TO public USING ((("companyId" = ANY (( SELECT get_companies_with_employee_permission('documents_delete'::text) AS get_companies_with_employee_permission)::text[])) AND (("writeGroups" && ( SELECT groups_for_user((( SELECT auth.uid() AS uid))::text) AS groups_for_user)) OR has_valid_api_key_for_company("companyId"))));
    CREATE POLICY "INSERT" ON ${t} AS PERMISSIVE FOR INSERT TO public WITH CHECK ((("companyId" = ANY (( SELECT get_companies_with_employee_permission('documents_create'::text) AS get_companies_with_employee_permission)::text[])) AND (("writeGroups" && ( SELECT groups_for_user((( SELECT auth.uid() AS uid))::text) AS groups_for_user)) OR has_valid_api_key_for_company("companyId"))));
    CREATE POLICY "SELECT" ON ${t} AS PERMISSIVE FOR SELECT TO public USING ((("companyId" = ANY (( SELECT get_companies_with_employee_permission('documents_view'::text) AS get_companies_with_employee_permission)::text[])) AND (("readGroups" && ( SELECT groups_for_user((( SELECT auth.uid() AS uid))::text) AS groups_for_user)) OR has_valid_api_key_for_company("companyId"))));
    CREATE POLICY "UPDATE" ON ${t} AS PERMISSIVE FOR UPDATE TO public USING ((("companyId" = ANY (( SELECT get_companies_with_employee_permission('documents_update'::text) AS get_companies_with_employee_permission)::text[])) AND (("writeGroups" && ( SELECT groups_for_user((( SELECT auth.uid() AS uid))::text) AS groups_for_user)) OR has_valid_api_key_for_company("companyId"))));
  `
  ),
  documentExtraction: policies({ all: inCompany("companyId", "employee") }),
  documentFavorite: policies({
    select: owner("userId"),
    insert: owner("userId"),
    delete: owner("userId")
  }),
  documentLabel: policies({
    select: owner("userId"),
    insert: owner("userId"),
    delete: owner("userId")
  }),
  documentEdit: policies({ select: documentEditReader }),
  documentSection: company({ read: "employee" }),
  // Saved by the server, which validates its figures: no API writes.
  documentTemplate: company({
    read: "employee",
    create: false,
    update: false,
    delete: false
  }),
  documentTransaction: policies({
    select: owner("userId"),
    insert: owner("userId")
  }),
  earnedValuePeriod: company({
    read: "employee",
    create: false,
    update: false,
    delete: false
  }),
  employee: company({ read: "employee", create: "update" }),
  employeeAbility: company(),
  employeeJob: company({ read: "employee" }),
  employeePin: serviceOnly(),
  employeeShift: company(),
  employeeType: company({
    create: "update",
    delete: "update"
  }),
  employeeTypePermission: policies({
    all: viaParent("employeeTypeId", "employeeType", "update")
  }),
  // Storage Rules and Sales Rules share it by family, and its assignments and
  // acknowledgments through ruleId (the registry).
  enforcementRule: company({ read: "employee" }),
  enforcementRuleAcknowledgment: company({
    read: "employee",
    update: false,
    delete: false
  }),
  // A storage rule's items are also assigned from the item pages, as before.
  enforcementRuleItemAssignment: policies({
    select: inCompany("companyId", "employee"),
    insert: or(
      inCompany("companyId", "create"),
      exists(
        "enforcementRule",
        "ruleId",
        and(
          where<"enforcementRule">((eb) => eb("family", "=", "storage")),
          inCompany("companyId", anyItemPage("create"))
        ),
        { sameCompany: true }
      )
    ),
    update: or(
      inCompany("companyId", "update"),
      exists(
        "enforcementRule",
        "ruleId",
        and(
          where<"enforcementRule">((eb) => eb("family", "=", "storage")),
          inCompany("companyId", anyItemPage("update"))
        ),
        { sameCompany: true }
      )
    ),
    delete: or(
      inCompany("companyId", "delete"),
      exists(
        "enforcementRule",
        "ruleId",
        and(
          where<"enforcementRule">((eb) => eb("family", "=", "storage")),
          inCompany("companyId", anyItemPage("delete"))
        ),
        { sameCompany: true }
      )
    )
  }),
  enforcementRuleWorkCenterAssignment: policies({
    select: inCompany("companyId", "employee"),
    insert: and(
      exists(
        "enforcementRule",
        "ruleId",
        where<"enforcementRule">((eb) => eb("targetType", "=", "workCenter")),
        { sameCompany: true }
      ),
      inCompany("companyId", anyOf("create", "resources.workCenters_create"))
    ),
    update: and(
      exists(
        "enforcementRule",
        "ruleId",
        where<"enforcementRule">((eb) => eb("targetType", "=", "workCenter")),
        { sameCompany: true }
      ),
      inCompany("companyId", anyOf("update", "resources.workCenters_update"))
    ),
    delete: inCompany(
      "companyId",
      anyOf("delete", "resources.workCenters_delete")
    )
  }),
  // Also written by the audit log switch, from its Settings page, as before.
  // Audit Logs tops out at Edit.
  eventSystemSubscription: company({
    read: "employee",
    create: anyOf("create", "settings.auditLogs_update"),
    update: anyOf("update", "settings.auditLogs_update"),
    delete: anyOf("delete", "settings.auditLogs_update")
  }),
  exchangeRate: policies({ select: always, to: "authenticated" }),
  exchangeRateOverride: company({
    read: "employee",
    create: "update",
    delete: "update"
  }),
  externalIntegrationMapping: policies({
    select: inCompany("companyId", "employee"),
    insert: inCompany("companyId", "employee")
  }),
  externalLink: company({ read: "employee" }),
  feedback: serviceOnly(),
  fiscalYearSettings: company(),
  fixedAsset: company(),
  fixedAssetCipCost: company(),
  fixedAssetClass: company(),
  fixedAssetDisposal: company({
    update: false,
    delete: false
  }),
  fixedAssetTransfer: company(),
  fixedAssetUsageLog: company(),
  fixture: serviceOnly(),
  fulfillment: company({
    create: anyOf("create", "inventory.shipments_create")
  }),
  gauge: company({ read: "employee" }),
  gaugeCalibrationRecord: company(),
  gaugeType: company({ read: "employee" }),
  group: company({ read: "employee" }),
  holiday: company({ read: "employee" }),
  implementationCheckState: company({
    read: "employee",
    create: "employee",
    update: "employee"
  }),
  implementationFieldValue: company({
    read: "employee",
    create: "employee",
    update: "employee"
  }),
  implementationHub: company({
    read: "employee",
    update: "employee",
    column: "id"
  }),
  implementationRow: policies({ all: inCompany("companyId", "employee") }),
  // Government contracting Phase 5b. The rate run writes the statement, the
  // runs and the Actual rates with Kysely; nothing writes them through the API.
  indirectExpenseStatement: company({
    read: "employee",
    create: false,
    update: false,
    delete: false
  }),
  indirectPool: company({ read: "employee" }),
  indirectPoolAccount: company({ read: "employee" }),
  indirectRate: company({ read: "employee" }),
  indirectRateRun: company({
    read: "employee",
    create: false,
    update: false,
    delete: false
  }),
  industry: policies({ select: authenticated }),
  inspection: company(),
  inspectionDocument: company({ read: "employee" }),
  inspectionDocumentParameter: company({ read: "employee" }),
  inspectionFeature: company({ read: "employee" }),
  inspectionHistory: company({
    update: false,
    delete: false
  }),
  inspectionMeasurement: company(),
  inspectionSample: company(),
  inspectionSamplingPlan: company(),
  inspectionTrackedEntity: company(),
  integration: policies({ select: authenticated }),
  // Read-only to API roles: a user-written row could claim another company's Slack
  // team_id or point secretRef at someone else's vault secret. The server writes it
  // with the service role after its own permission check.
  integrationConnection: company({
    create: false,
    update: false,
    delete: false
  }),
  intercompanyEliminationLine: company({ read: "employee" }),
  intercompanyTransaction: policies({
    select: or(
      inCompany("sourceCompanyId", "create"),
      inCompany("targetCompanyId", "create")
    ),
    insert: or(
      inCompany("sourceCompanyId", "create"),
      inCompany("targetCompanyId", "create")
    ),
    update: or(
      inCompany("sourceCompanyId", "update"),
      inCompany("targetCompanyId", "update")
    ),
    delete: or(
      inCompany("sourceCompanyId", "delete"),
      inCompany("targetCompanyId", "delete")
    )
  }),
  inventoryCount: company(),
  inventoryCountLine: company(),
  invite: serviceOnly(),
  // Settlements change only while the payment and memo they apply are still Draft, in the
  // settlement's own company. (The imported policy compared each parent to itself —
  // p.id = p."paymentId" — so writes only passed when both ids were null.)
  invoiceSettlement: policies({
    select: inCompany("companyId", "employee"),
    insert: and(draftSettlement, inCompany("companyId", "create")),
    update: and(draftSettlement, inCompany("companyId", "update")),
    delete: and(draftSettlement, inCompany("companyId", "delete"))
  }),
  itarCertification: policies({ select: inCompany("companyId", "employee") }),
  item: policies({
    select: or(
      inCompany("companyId", "employee"),
      throughIndexed(
        "id",
        "supplierPart",
        "itemId",
        and(portal.supplier("supplierId", "parts_view"), isNotNull("itemId"))
      ),
      throughIndexed(
        "id",
        "customerPartToItem",
        "itemId",
        and(portal.customer("customerId", "parts_view"), isNotNull("itemId"))
      )
    ),
    insert: inCompany("companyId", "create"),
    update: or(
      inCompany("companyId", "update"),
      throughIndexed(
        "id",
        "supplierPart",
        "itemId",
        portal.supplier("supplierId", "parts_update")
      ),
      throughIndexed(
        "id",
        "customerPartToItem",
        "itemId",
        portal.customer("customerId", "parts_update")
      )
    ),
    delete: or(
      inCompany("companyId", "delete"),
      throughIndexed(
        "id",
        "supplierPart",
        "itemId",
        portal.supplier("supplierId", "parts_delete")
      ),
      throughIndexed(
        "id",
        "customerPartToItem",
        "itemId",
        portal.customer("customerId", "parts_delete")
      )
    )
  }),
  itemCost: policies({
    select: or(
      inCompany("companyId", "view"),
      throughIndexed(
        "itemId",
        "supplierPart",
        "itemId",
        portal.supplier("supplierId", "parts_view")
      )
    ),
    insert: inCompany("companyId", "create"),
    update: or(
      inCompany("companyId", "update"),
      throughIndexed(
        "itemId",
        "supplierPart",
        "itemId",
        portal.supplier("supplierId", "parts_update")
      ),
      throughIndexed(
        "itemId",
        "customerPartToItem",
        "itemId",
        portal.customer("customerId", "parts_update")
      )
    )
  }),
  itemInspectionDocumentAssignment: company(),
  itemLedger: policies({
    select: inCompany("companyId", "view"),
    insert: inCompany(
      "companyId",
      anyOf("create", "accounting.journalEntries_create")
    )
  }),
  itemPlanning: company({ delete: false }),
  itemPostingGroup: company(),
  itemPostingGroupResponsibility: company({
    read: "employee",
    create: "update",
    update: "update",
    delete: "update"
  }),
  itemRentalRate: company(),
  itemReplenishment: company(),
  itemSerialSequence: company({ read: "employee" }),
  itemShelfLife: company(),
  itemStockQuantities: policies({ select: inCompany("companyId", "employee") }),
  itemSupersession: company({ read: "employee" }),
  itemUnitSalePrice: company(),
  job: company({ read: "employee" }),
  jobFavorite: policies({
    select: owner("userId"),
    insert: owner("userId"),
    delete: owner("userId")
  }),
  jobMakeMethod: company({ read: "employee" }),
  jobMaterial: company({ read: "employee" }),
  jobMaterialStep: policies({
    select: exists("jobMaterial", "jobMaterialId", "employee"),
    insert: exists("jobMaterial", "jobMaterialId", "create"),
    update: exists("jobMaterial", "jobMaterialId", "update"),
    delete: exists("jobMaterial", "jobMaterialId", "delete")
  }),
  jobOperation: company({ read: "employee" }),
  jobOperationBatch: company({ read: "employee" }),
  jobOperationDependency: policies({
    select: inCompany("companyId", "employee")
  }),
  jobOperationNote: company({ read: "employee", create: "employee" }),
  jobOperationParameter: company({ read: "employee" }),
  jobOperationStep: company({ read: "employee" }),
  jobOperationStepRecord: company({ read: "employee", create: "employee" }),
  jobOperationStepSlide: company({ read: "employee" }),
  jobOperationTool: company({ read: "employee" }),
  jobOperationToolStep: policies({
    select: exists("jobOperationTool", "jobOperationToolId", "employee"),
    insert: exists("jobOperationTool", "jobOperationToolId", "create"),
    update: exists("jobOperationTool", "jobOperationToolId", "update"),
    delete: exists("jobOperationTool", "jobOperationToolId", "delete")
  }),
  // Provisional and Superseded are the accounting cutover's automatic statuses
  // (.ai/specs/implemented/2026-10-08-accounting-cutover.md): only the posting
  // server functions and the enable write them, as the service connection. A
  // user never creates a journal in either status nor moves one into it.
  journal: policies({
    select: inCompany("companyId", "view"),
    insert: and(
      where<"journal">((eb) => eb("status", "in", ["Draft", "Posted"])),
      inCompany("companyId", "create")
    ),
    // Posted stays updatable only for the Posted -> Reversed transition, which the
    // journal_posted_immutable trigger enforces. The new row keeps the company scope,
    // so a journal can never move company, and a status a user may set: Draft,
    // Posted (a manual posting) or Reversed (a reversal).
    update: {
      using: and(
        where<"journal">((eb) => eb("status", "in", ["Draft", "Posted"])),
        inCompany("companyId", "update")
      ),
      check: and(
        where<"journal">((eb) =>
          eb("status", "in", ["Draft", "Posted", "Reversed"])
        ),
        inCompany("companyId", "update")
      )
    },
    delete: and(
      where<"journal">((eb) => eb("status", "=", "Draft")),
      inCompany("companyId", "delete")
    )
  }),
  journalLine: policies({
    select: inCompany("companyId", "view"),
    // Lines go into a Draft journal, or into the Posted reversal the ERP's
    // reverseJournalEntry writes through the user's client. Never into a
    // Provisional, Superseded or Reversed journal.
    insert: and(
      inCompany("companyId", "create"),
      exists(
        "journal",
        "journalId",
        where<"journal">((eb) => eb("status", "in", ["Draft", "Posted"]))
      )
    ),
    update: and(
      inCompany("companyId", "update"),
      exists(
        "journal",
        "journalId",
        where<"journal">((eb) => eb("status", "=", "Draft"))
      )
    ),
    delete: and(
      inCompany("companyId", "delete"),
      exists(
        "journal",
        "journalId",
        where<"journal">((eb) => eb("status", "=", "Draft"))
      )
    )
  }),
  journalLineDimension: company({
    update: false
  }),
  kanban: company({ read: "employee" }),
  laborCategory: company({ read: "employee" }),
  laborCategoryRate: company({ read: "employee" }),
  lease: company(),
  // Written only by post-lease and the lease run (Kysely); read-only over the API.
  leaseEvent: company({
    create: false,
    update: false,
    delete: false
  }),
  leaseLine: company(),
  leasePayment: company(),
  // Written only by post-lease and the lease run (Kysely); read-only over the API.
  leaseScheduleLine: company({
    create: false,
    update: false,
    delete: false
  }),
  lessonCompletion: policies({
    select: owner("userId"),
    insert: owner("userId")
  }),
  location: company({ read: "employee" }),
  // Written only by the OEE sync and the entitlement-gated @carbon/ee/oee.server
  // functions, over Kysely and under the device lock: read-only through the API.
  machineStateChange: policies({ select: inCompany("companyId", "employee") }),
  maintenanceDispatch: company({
    read: "employee",
    create: "employee",
    update: "employee"
  }),
  maintenanceDispatchComment: policies({
    select: inCompany("companyId", "employee"),
    insert: inCompany("companyId", "employee"),
    update: {
      using: owner("createdBy"),
      check: and(owner("createdBy"), inCompany("companyId", "employee"))
    },
    delete: owner("createdBy")
  }),
  maintenanceDispatchEvent: company({
    read: "employee",
    create: "employee",
    update: "employee"
  }),
  maintenanceDispatchItem: company({ read: "employee", create: "employee" }),
  // Same rule as its sibling maintenanceDispatchItem. (The imported policy named
  // maintenance_update / maintenance_delete, which no one can hold.)
  maintenanceDispatchItemTrackedEntity: company({
    read: "employee",
    create: "employee"
  }),
  maintenanceDispatchWorkCenter: company({
    read: "employee",
    create: "employee"
  }),
  maintenanceFailureMode: company({ read: "employee" }),
  maintenanceSchedule: company(),
  maintenanceScheduleItem: company({ read: "employee", create: "employee" }),
  makeMethod: company(),
  material: company({ read: "employee" }),
  materialDimension: policies({
    select: or(isNull("companyId"), inCompany("companyId", "view")),
    insert: inCompany("companyId", "create"),
    update: inCompany("companyId", "update"),
    delete: inCompany("companyId", "delete")
  }),
  materialFinish: policies({
    select: or(isNull("companyId"), inCompany("companyId", "view")),
    insert: inCompany("companyId", "create"),
    update: inCompany("companyId", "update"),
    delete: inCompany("companyId", "delete")
  }),
  materialForm: policies({
    select: or(isNull("companyId"), inCompany("companyId", "view")),
    insert: inCompany("companyId", "create"),
    update: inCompany("companyId", "update"),
    delete: inCompany("companyId", "delete")
  }),
  materialGrade: policies({
    select: or(isNull("companyId"), inCompany("companyId", "view")),
    insert: inCompany("companyId", "create"),
    update: inCompany("companyId", "update"),
    delete: inCompany("companyId", "delete")
  }),
  materialSubstance: policies({
    select: or(isNull("companyId"), inCompany("companyId", "view")),
    insert: inCompany("companyId", "create"),
    update: inCompany("companyId", "update"),
    delete: inCompany("companyId", "delete")
  }),
  materialType: policies({
    select: or(isNull("companyId"), inCompany("companyId", "view")),
    insert: inCompany("companyId", "create"),
    update: inCompany("companyId", "update"),
    delete: inCompany("companyId", "delete")
  }),
  membership: policies({
    select: viaParent("groupId", "group", "employee"),
    insert: viaParent("groupId", "group", "update"),
    update: viaParent("groupId", "group", "update"),
    delete: viaParent("groupId", "group", "update")
  }),
  memo: policies({
    select: inCompany("companyId", "employee"),
    insert: inCompany("companyId", "create"),
    update: inCompany("companyId", "update"),
    delete: and(
      where<"memo">((eb) => eb("status", "=", "Draft")),
      inCompany("companyId", "delete")
    )
  }),
  methodMaterial: company(),
  methodMaterialStep: policies({
    select: exists("methodMaterial", "methodMaterialId", "employee"),
    insert: exists("methodMaterial", "methodMaterialId", "create"),
    update: exists("methodMaterial", "methodMaterialId", "update"),
    delete: exists("methodMaterial", "methodMaterialId", "delete")
  }),
  methodOperation: company(),
  methodOperationParameter: company({ read: "employee" }),
  // Operation steps are also edited by whoever edits job operations, as before.
  methodOperationStep: company({ read: "employee" }),
  methodOperationStepSlide: company({ read: "employee" }),
  methodOperationTool: company(),
  methodOperationToolStep: policies({
    select: exists("methodOperationTool", "methodOperationToolId", "employee"),
    insert: exists("methodOperationTool", "methodOperationToolId", "create"),
    update: exists("methodOperationTool", "methodOperationToolId", "update"),
    delete: exists("methodOperationTool", "methodOperationToolId", "delete")
  }),
  // Items, quotes, orders and jobs point at a model; the model names none of
  // them, so every item page writes it (the registry: Parts, alsoWrittenBy).
  modelUpload: company({ read: "employee" }),
  nonConformance: company(),
  nonConformanceActionProcess: company(),
  nonConformanceActionTask: company(),
  nonConformanceApprovalTask: company(),
  nonConformanceCustomer: company(),
  nonConformanceInspection: company(),
  nonConformanceItem: company(),
  nonConformanceItemTrackedEntity: company(),
  nonConformanceJobOperation: company(),
  nonConformancePurchaseOrderLine: company(),
  nonConformancePurchaseReturnOrderLine: company(),
  nonConformanceReceiptLine: company(),
  nonConformanceRequiredAction: company(),
  nonConformanceReviewer: company(),
  nonConformanceSalesOrderLine: company(),
  nonConformanceSalesReturnOrderLine: company(),
  nonConformanceShipmentLine: company(),
  nonConformanceSupplier: company(),
  nonConformanceTrackedEntity: company(),
  nonConformanceType: company({ read: "employee" }),
  nonConformanceWorkflow: company(),
  noQuoteReason: company(),
  // Only the author edits or deletes a note, and never moves it into another company.
  note: policies({
    select: inCompany("companyId", "employee"),
    insert: inCompany("companyId", "employee"),
    update: {
      using: owner("createdBy"),
      check: and(owner("createdBy"), inCompany("companyId", "employee"))
    },
    delete: owner("createdBy")
  }),
  notification: policies({ select: owner("userId"), update: owner("userId") }),
  notificationDelivery: policies({ select: owner("userId") }),
  // A NULL companyId is an account-level preference (the changelog newsletter).
  notificationPreference: policies({
    select: and(owner("userId"), or(isNull("companyId"), member("companyId"))),
    insert: and(owner("userId"), or(isNull("companyId"), member("companyId"))),
    update: {
      using: owner("userId"),
      check: and(owner("userId"), or(isNull("companyId"), member("companyId")))
    },
    delete: and(owner("userId"), or(isNull("companyId"), member("companyId")))
  }),
  oauthClient: serviceOnly(),
  oauthCode: serviceOnly(),
  oauthToken: serviceOnly(),
  // Quotes owns it, but a new RFQ and a new sales order each insert their
  // opportunity as the caller.
  opportunity: company({
    create: anyOf(
      "sales.rfqs_create",
      "sales.quotes_create",
      "sales.salesOrders_create"
    ),
    delete: false
  }),
  part: company({ read: "employee" }),
  partner: company({ read: "employee" }),
  passkeyCredential: policies({ all: owner("userId") }),
  payment: policies({
    select: inCompany("companyId", "employee"),
    insert: inCompany("companyId", "create"),
    update: inCompany("companyId", "update"),
    delete: and(
      where<"payment">((eb) => eb("status", "=", "Draft")),
      inCompany("companyId", "delete")
    )
  }),
  paymentTerm: company(),
  // Government contracting Phase 5a: payroll totals imported from CSV.
  payrollPeriodTotal: company(),
  peopleAbsence: company({ read: "employee" }),
  performanceBasedPaymentEvent: company(),
  peopleAssignment: company({ read: "employee" }),
  period: policies({ select: authenticated }),
  // A person's grants are an Accounts setting and a role's an Employee Types one, at Edit
  // for every command; an API key's are API Keys ones, as the apiKey rule is.
  permission: policies({
    select: grantRows("view"),
    insert: grantRows("create"),
    update: { using: grantRows("update"), check: grantRows("update") },
    delete: grantRows("delete")
  }),
  periodCloseTask: company({ read: "employee" }),
  periodCloseTaskDefinition: company({ read: "employee" }),
  pickingList: company(),
  pickingListLine: company(),
  pickingListLineTrackedEntity: policies({
    select: exists("pickingListLine", "pickingListLineId", "view"),
    insert: exists("pickingListLine", "pickingListLineId", "create"),
    update: exists("pickingListLine", "pickingListLineId", "update"),
    delete: exists("pickingListLine", "pickingListLineId", "delete")
  }),
  pickMethod: company({ delete: false }),
  plan: policies({ select: authenticated }),
  // Read-only through the API. MRP writes it (Kysely) and the planning routes
  // change it with the service role after their own checks; an API write could
  // point an action's jobId / purchaseOrderLineId at another company's row
  // (single-column foreign keys), which the service-role read then shows.
  // Read by the production AND purchasing planning pages with the user's
  // client; the row names a supplier, an open quantity and an assignee.
  planningAction: company({
    create: false,
    update: false,
    delete: false
  }),
  planningGroup: company({ read: "employee" }),
  pricingRule: company({ read: "employee" }),
  printerRoute: company(),
  printJob: company(),
  procedure: company({ read: "employee" }),
  procedureParameter: company({ read: "employee" }),
  procedureStep: company({ read: "employee" }),
  process: company({ read: "employee" }),
  productionEvent: company(),
  productionQuantity: company({ read: "employee" }),
  project: company({ read: "employee" }),
  projectBaseline: company({ read: "employee", update: false, delete: false }),
  projectChangeRequest: company({ read: "employee" }),
  projectChangeRequestComment: company({
    read: "employee",
    create: "employee",
    update: and(owner("createdBy"), inCompany("companyId", "employee")),
    delete: owner("createdBy")
  }),
  projectChangeRequestItem: company({ read: "employee" }),
  projectChangeRequestView: policies({
    select: owner("userId"),
    insert: and(owner("userId"), inCompany("companyId", "employee")),
    update: {
      using: owner("userId"),
      check: and(owner("userId"), inCompany("companyId", "employee"))
    },
    delete: owner("userId")
  }),
  projectBillableItem: projectTable(),
  projectBorrow: company({
    read: "employee",
    create: false,
    update: false,
    delete: false
  }),
  // The revenue recognition run writes reliefs with Kysely; nothing writes
  // them through the API.
  projectCostRelief: company({
    read: "employee",
    create: false,
    update: false,
    delete: false
  }),
  projectElement: projectTable(),
  projectElementComment: company({
    read: projectModule("projectElementId", "view", {
      standard: "employee",
      via: "projectElement"
    }),
    create: and(
      inCompany("companyId", "employee"),
      projectModule("projectElementId", "view", {
        standard: "employee",
        via: "projectElement"
      })
    ),
    update: and(owner("createdBy"), inCompany("companyId", "employee")),
    delete: owner("createdBy")
  }),
  projectElementCost: projectTable(),
  projectElementLabel: projectTable("projectElementId", "projectElement"),
  projectElementLabor: projectTable(),
  projectElementLink: projectTable(),
  projectElementMaterial: projectTable(),
  projectExpenseEntry: projectTable(),
  // Company-wide (Settings → Projects): any employee reads; Settings or
  // Projects writers edit.
  projectLabel: company({
    read: "employee",
    create: anyOf("create", "settings.projects_update"),
    update: anyOf("update", "settings.projects_update"),
    delete: anyOf("delete", "settings.projects_update")
  }),
  projectLedger: company({
    read: projectModule("projectId", "view", { standard: "employee" }),
    create: false,
    update: false,
    delete: false
  }),
  // Government contracting Phase 5a: who may charge time to a project with
  // restrictCharging.
  projectMember: projectTable(),
  projectMilestone: projectTable(),
  // MRP writes pegs with the service role; a manual peg goes through a server
  // action that checks update: projects first.
  projectPeg: company({
    read: "employee",
    create: false,
    update: false,
    delete: false
  }),
  // Company-wide (Settings → Projects): any employee reads; Settings or
  // Projects writers edit.
  projectState: company({
    read: "employee",
    create: anyOf("create", "settings.projects_update"),
    update: anyOf("update", "settings.projects_update"),
    delete: anyOf("delete", "settings.projects_update")
  }),
  projectStockTransfer: company({ read: "employee" }),
  projectStockTransferLine: company({ read: "employee" }),
  projectUserPreference: policies({
    select: owner("userId"),
    insert: and(owner("userId"), inCompany("companyId", "employee")),
    update: {
      using: owner("userId"),
      check: and(owner("userId"), inCompany("companyId", "employee"))
    },
    delete: owner("userId")
  }),
  projectView: policies({
    select: or(
      owner("createdBy"),
      and(
        where<"projectView">((eb) => eb("isShared", "=", true)),
        inCompany("companyId", "view")
      )
    ),
    insert: and(owner("createdBy"), inCompany("companyId", "view")),
    update: {
      using: owner("createdBy"),
      check: and(owner("createdBy"), inCompany("companyId", "view"))
    },
    delete: owner("createdBy")
  }),
  purchaseInvoice: company(),
  purchaseInvoiceDelivery: company(),
  purchaseInvoiceLine: company(),
  purchaseInvoicePriceChange: policies({
    select: viaParent("invoiceId", "purchaseInvoice", "view")
  }),
  purchaseInvoiceStatusHistory: policies({
    select: viaParent("invoiceId", "purchaseInvoice", "view")
  }),
  purchaseOrder: company(),
  purchaseOrderDelivery: company(),
  purchaseOrderFavorite: policies({
    select: owner("userId"),
    insert: owner("userId"),
    delete: owner("userId")
  }),
  purchaseOrderLine: company(),
  // The versions an approval request keeps: written by the amendment
  // re-submit and read by the rejection, both through Kysely.
  purchaseOrderLineVersion: serviceOnly(),
  purchaseOrderPayment: company(),
  purchaseOrderVersion: serviceOnly(),
  purchaseOrderStatusHistory: policies({
    select: viaParent("purchaseOrderId", "purchaseOrder", "view")
  }),
  purchaseOrderTransaction: policies({
    select: viaParent("purchaseOrderId", "purchaseOrder", "view"),
    insert: viaParent("purchaseOrderId", "purchaseOrder", "update")
  }),
  purchaseReturnOrder: company({ read: "employee" }),
  purchaseReturnOrderCreditLine: company({ read: "employee" }),
  purchaseReturnOrderLine: company({ read: "employee" }),
  purchaseReturnOrderLineTrackedEntity: company({ read: "employee" }),
  purchasingRfq: company(),
  purchasingRfqFavorite: policies({
    select: owner("userId"),
    insert: owner("userId"),
    delete: owner("userId")
  }),
  purchasingRfqLine: company(),
  purchasingRfqSupplier: company(),
  purchasingRfqToPurchaseOrder: company({
    update: false,
    delete: false
  }),
  purchasingRfqToSupplierQuote: company({
    update: false,
    delete: false
  }),
  pushSubscription: policies({
    select: and(owner("userId"), member("companyId")),
    insert: and(owner("userId"), member("companyId")),
    update: {
      using: owner("userId"),
      check: and(owner("userId"), member("companyId"))
    },
    delete: and(owner("userId"), member("companyId"))
  }),
  qualityDocument: company({ read: "employee" }),
  qualityDocumentStep: company({ read: "employee" }),
  quote: company(),
  quoteFavorite: policies({
    select: owner("userId"),
    insert: owner("userId"),
    delete: owner("userId")
  }),
  quoteLine: company(),
  quoteLinePrice: policies({
    select: viaParent("quoteLineId", "quoteLine", "view"),
    insert: viaParent("quoteLineId", "quoteLine", "create"),
    update: viaParent("quoteLineId", "quoteLine", "update"),
    delete: viaParent("quoteLineId", "quoteLine", "delete")
  }),
  quoteMakeMethod: company(),
  quoteMaterial: company(),
  quoteMaterialStep: policies({
    select: exists("quoteMaterial", "quoteMaterialId", "employee"),
    insert: exists("quoteMaterial", "quoteMaterialId", "create"),
    update: exists("quoteMaterial", "quoteMaterialId", "update"),
    delete: exists("quoteMaterial", "quoteMaterialId", "delete")
  }),
  quoteOperation: company(),
  quoteOperationParameter: company({ read: "employee" }),
  quoteOperationStep: company({ read: "employee" }),
  quoteOperationStepSlide: company({ read: "employee" }),
  quoteOperationTool: company({ read: "employee" }),
  quoteOperationToolStep: policies({
    select: exists("quoteOperationTool", "quoteOperationToolId", "employee"),
    insert: exists("quoteOperationTool", "quoteOperationToolId", "create"),
    update: exists("quoteOperationTool", "quoteOperationToolId", "update"),
    delete: exists("quoteOperationTool", "quoteOperationToolId", "delete")
  }),
  quotePayment: policies({
    select: or(
      inCompany("companyId", "view"),
      exists("quote", "id", portal.customer("customerId", "sales_view"))
    ),
    insert: or(
      inCompany("companyId", "create"),
      exists("quote", "id", portal.customer("customerId", "sales_create"))
    ),
    update: or(
      inCompany("companyId", "update"),
      exists("quote", "id", portal.customer("customerId", "sales_update"))
    ),
    delete: or(
      inCompany("companyId", "delete"),
      exists("quote", "id", portal.customer("customerId", "sales_delete"))
    )
  }),
  quoteShipment: policies({
    select: or(
      inCompany("companyId", "view"),
      exists("quote", "id", portal.customer("customerId", "sales_view"))
    ),
    insert: or(
      inCompany("companyId", "create"),
      exists("quote", "id", portal.customer("customerId", "sales_create"))
    ),
    update: or(
      inCompany("companyId", "update"),
      exists("quote", "id", portal.customer("customerId", "sales_update"))
    ),
    delete: or(
      inCompany("companyId", "delete"),
      exists("quote", "id", portal.customer("customerId", "sales_delete"))
    )
  }),
  receipt: company(),
  receiptFixedAssetLine: company(),
  receiptLine: company(),
  reimbursement: policies({
    select: inCompany("companyId", "employee"),
    insert: and(
      where<"reimbursement">((eb) => eb("status", "=", "Draft")),
      inCompany("companyId", "create")
    ),
    update: and(
      where<"reimbursement">((eb) => eb("status", "=", "Draft")),
      inCompany("companyId", "update")
    ),
    delete: and(
      where<"reimbursement">((eb) => eb("status", "=", "Draft")),
      inCompany("companyId", "delete")
    )
  }),
  reimbursementLine: policies({
    select: inCompany("companyId", "employee"),
    insert: and(
      exists(
        "reimbursement",
        "reimbursementId",
        where<"reimbursement">((eb) => eb("status", "=", "Draft")),
        { sameCompany: true }
      ),
      inCompany("companyId", "create")
    ),
    update: and(
      exists(
        "reimbursement",
        "reimbursementId",
        where<"reimbursement">((eb) => eb("status", "=", "Draft")),
        { sameCompany: true }
      ),
      inCompany("companyId", "update")
    ),
    delete: and(
      exists(
        "reimbursement",
        "reimbursementId",
        where<"reimbursement">((eb) => eb("status", "=", "Draft")),
        { sameCompany: true }
      ),
      inCompany("companyId", "delete")
    )
  }),
  // SELECT / INSERT / DELETE only — a line's dimensions are replaced by
  // delete-then-insert, so nothing ever issues an UPDATE. `custom` because the
  // Draft check is TWO hops away (dimension → line → reimbursement) and `exists`
  // aliases its parent as `p`, so a nested `exists` cannot name the intermediate
  // table. Mirrors reimbursementLine's rule one level deeper.
  reimbursementLineDimension: custom(
    "two-hop parent check: the dimension's line's reimbursement must still be Draft",
    (t) => `
    CREATE POLICY "SELECT" ON ${t} AS PERMISSIVE FOR SELECT TO public USING (("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])));
    CREATE POLICY "INSERT" ON ${t} AS PERMISSIVE FOR INSERT TO public WITH CHECK ((EXISTS (SELECT 1 FROM public."reimbursementLine" l JOIN public."reimbursement" h ON ((h.id = l."reimbursementId") AND (h."companyId" = l."companyId")) WHERE ((l.id = ${t}."reimbursementLineId") AND (l."companyId" = ${t}."companyId") AND (h.status = 'Draft'::"reimbursementStatus"))) AND ("companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing.reimbursements_create'::text))::text[]))));
    CREATE POLICY "DELETE" ON ${t} AS PERMISSIVE FOR DELETE TO public USING ((EXISTS (SELECT 1 FROM public."reimbursementLine" l JOIN public."reimbursement" h ON ((h.id = l."reimbursementId") AND (h."companyId" = l."companyId")) WHERE ((l.id = ${t}."reimbursementLineId") AND (l."companyId" = ${t}."companyId") AND (h.status = 'Draft'::"reimbursementStatus"))) AND ("companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing.reimbursements_delete'::text))::text[]))));
  `
  ),
  rentalAgreement: company(),
  rentalAgreementCharge: company(),
  // Written only by saveRentalAgreementContacts (server-side), which checks the
  // agreement's status and customer; the API cannot write rows directly.
  rentalAgreementContact: company({
    create: false,
    update: false,
    delete: false
  }),
  rentalAgreementLine: company(),
  rentalBillingPeriod: company(),
  rentalLeaseScheduleLine: company(),
  reportPin: policies({
    all: and(owner("userId"), inCompany("companyId", "employee"))
  }),
  reportView: policies({
    select: and(
      inCompany("companyId", "employee"),
      or(
        where<"reportView">((eb) => eb("visibility", "=", "Company")),
        owner("createdBy")
      )
    ),
    insert: and(inCompany("companyId", "employee"), owner("createdBy")),
    update: and(inCompany("companyId", "employee"), owner("createdBy")),
    delete: and(inCompany("companyId", "employee"), owner("createdBy"))
  }),
  returnReason: company({ read: "employee" }),
  revenueRecognitionRun: company(),
  revenueRecognitionRunLine: company(),
  revenueRecognitionSchedule: company(),
  rework: company(),
  riskRegister: company({ read: "employee", create: "employee" }),
  salesInvoice: company(),
  salesInvoiceLine: company(),
  // Government contracting Phase 5a: the ACRN split of an invoice. Only the
  // invoice server function writes it, with Kysely.
  salesInvoiceFundingAllocation: company({
    create: false,
    update: false,
    delete: false
  }),
  salesInvoiceShipment: company(),
  salesOrder: company(),
  salesOrderFavorite: policies({
    select: owner("userId"),
    insert: owner("userId"),
    delete: owner("userId")
  }),
  salesOrderLine: company(),
  salesOrderPayment: policies({
    select: or(
      inCompany("companyId", "view"),
      exists("salesOrder", "id", portal.customer("customerId", "sales_view"))
    ),
    insert: or(
      inCompany("companyId", "create"),
      exists("salesOrder", "id", portal.customer("customerId", "sales_create"))
    ),
    update: or(
      inCompany("companyId", "update"),
      exists("salesOrder", "id", portal.customer("customerId", "sales_update"))
    ),
    delete: or(
      inCompany("companyId", "delete"),
      exists("salesOrder", "id", portal.customer("customerId", "sales_delete"))
    )
  }),
  salesOrderShipment: policies({
    select: or(
      inCompany("companyId", "view"),
      exists("salesOrder", "id", portal.customer("customerId", "sales_view"))
    ),
    insert: or(
      inCompany("companyId", "create"),
      exists("salesOrder", "id", portal.customer("customerId", "sales_create"))
    ),
    update: or(
      inCompany("companyId", "update"),
      exists("salesOrder", "id", portal.customer("customerId", "sales_update"))
    ),
    delete: or(
      inCompany("companyId", "delete"),
      exists("salesOrder", "id", portal.customer("customerId", "sales_delete"))
    )
  }),
  salesOrderStatusHistory: policies({
    select: viaParent("salesOrderId", "salesOrder", "view")
  }),
  salesOrderTransaction: policies({
    select: viaParent("salesOrderId", "salesOrder", "view"),
    insert: viaParent("salesOrderId", "salesOrder", "update")
  }),
  salesReturnOrder: company({ read: "employee" }),
  salesReturnOrderCreditLine: company({ read: "employee" }),
  salesReturnOrderLine: company({ read: "employee" }),
  salesReturnOrderLineTrackedEntity: company({ read: "employee" }),
  salesRfq: company(),
  salesRfqFavorite: policies({
    select: owner("userId"),
    insert: owner("userId"),
    delete: owner("userId")
  }),
  salesRfqLine: company(),
  scrapReason: company({ read: "employee" }),
  scriptRun: policies({ select: authenticated }),
  searchIndexRegistry: serviceOnly(),
  sequence: company(),
  service: company({ read: "employee" }),
  // Every technician write (MES, My Time) runs on the service role or the
  // system connection after its own check; the user's client needs the scope.
  serviceJob: company({ read: "employee" }),
  serviceJobAssignment: company({ read: "employee" }),
  serviceJobEstimateLine: company({ read: "employee" }),
  serviceJobItem: company({ read: "employee" }),
  serviceJobTime: company({ read: "employee" }),
  shift: company({ read: "employee" }),
  shipment: company({
    create: anyOf("create", "sales.salesOrders_create")
  }),
  shipmentFixedAssetLine: company(),
  shipmentLine: company(),
  shippingMethod: company({ read: "employee" }),
  shippingTerm: company({ read: "employee" }),
  slackDocumentThread: serviceOnly(),
  ssoConnection: company({
    read: "employee",
    create: "update",
    delete: "update"
  }),
  ssoDomain: company({
    read: "employee",
    create: "update",
    delete: "update"
  }),
  ssoReservedDomain: policies({ select: authenticated }),
  stockTransfer: company({ read: "employee" }),
  stockTransferLine: company({ read: "employee" }),
  storageType: company({ read: "employee" }),
  storageUnit: company({ read: "employee" }),
  suggestion: company({
    create: "employee"
  }),
  supplier: company(),
  supplierAccount: company(),
  supplierBankAccount: company(),
  supplierContact: policies({
    select: viaParent("supplierId", "supplier", "view"),
    insert: viaParent("supplierId", "supplier", "create"),
    update: viaParent("supplierId", "supplier", "update"),
    delete: viaParent("supplierId", "supplier", "delete")
  }),
  supplierInteraction: company(),
  supplierLedger: company({
    create: false,
    update: false,
    delete: false
  }),
  supplierLocation: policies({
    select: viaParent("supplierId", "supplier", "view"),
    insert: viaParent("supplierId", "supplier", "create"),
    update: viaParent("supplierId", "supplier", "update"),
    delete: viaParent("supplierId", "supplier", "delete")
  }),
  supplierPart: company(),
  supplierPartPrice: company(),
  supplierPayment: company({
    create: false,
    delete: false
  }),
  // Processes owns it; Suppliers edits a supplier's processes.
  supplierProcess: company({
    create: anyOf("update", "purchasing.suppliers_update"),
    delete: anyOf("delete", "purchasing.suppliers_delete")
  }),
  supplierQuote: company(),
  supplierQuoteFavorite: policies({
    select: owner("userId"),
    insert: owner("userId"),
    delete: owner("userId")
  }),
  supplierQuoteLine: company(),
  supplierQuoteLinePrice: policies({
    select: viaParent("supplierQuoteId", "supplierQuote", "view"),
    insert: viaParent("supplierQuoteId", "supplierQuote", "create"),
    update: viaParent("supplierQuoteId", "supplierQuote", "update"),
    delete: viaParent("supplierQuoteId", "supplierQuote", "delete")
  }),
  supplierShipping: company({
    create: false,
    delete: false
  }),
  supplierTax: company({
    create: false,
    delete: false
  }),
  supplierType: company({ read: "member" }),
  supplyActual: company(),
  supplyForecast: company(),
  // Written by the log_*_changes triggers and read through table_changes_since,
  // which checks the caller's company itself. No API access.
  tableChange: serviceOnly(),
  tableView: policies({
    select: or(
      owner("createdBy"),
      and(
        where<"tableView">((eb) => eb("type", "=", "Public")),
        inCompany("companyId", "member")
      )
    ),
    insert: and(owner("createdBy"), inCompany("companyId", "member")),
    update: {
      using: owner("createdBy"),
      check: and(owner("createdBy"), inCompany("companyId", "member"))
    },
    delete: owner("createdBy")
  }),
  // Every page tags its records; deleting a tag is a Company setting (the registry).
  tag: company({
    read: "employee",
    create: "employee",
    update: false,
    delete: "update"
  }),
  terms: company({
    create: false,
    delete: false,
    column: "id"
  }),
  timeCardEntry: policies({
    select: or(
      and(owner("employeeId"), inCompany("companyId", "employee")),
      inCompany("companyId", "view")
    ),
    insert: or(
      and(owner("employeeId"), inCompany("companyId", "employee")),
      inCompany("companyId", "create")
    ),
    update: or(
      and(owner("employeeId"), inCompany("companyId", "employee")),
      inCompany("companyId", "update")
    ),
    delete: inCompany("companyId", "delete")
  }),
  // Government contracting Phase 5a: weekly certification and the DCAA
  // correction trail. Only the timesheet server functions write them, with
  // Kysely. The owner reads their own rows; projects_view reads every row.
  timesheetCertification: company({
    read: or(
      and(owner("employeeId"), inCompany("companyId", "employee")),
      inCompany("companyId", "view")
    ),
    create: false,
    update: false,
    delete: false
  }),
  timesheetEntry: policies({
    select: or(owner("employeeId"), projectModule("projectId", "view")),
    insert: and(
      owner("employeeId"),
      inCompany("companyId", "employee"),
      where<"timesheetEntry">((eb) => eb("status", "=", "Draft"))
    ),
    update: {
      using: or(
        and(
          owner("employeeId"),
          where<"timesheetEntry">((eb) => eb("status", "=", "Draft"))
        ),
        projectModule("projectId", "update")
      ),
      check: or(
        and(
          owner("employeeId"),
          inCompany("companyId", "employee"),
          where<"timesheetEntry">((eb) => eb("status", "=", "Draft"))
        ),
        projectModule("projectId", "update")
      )
    },
    delete: and(
      owner("employeeId"),
      where<"timesheetEntry">((eb) => eb("status", "=", "Draft"))
    )
  }),
  timesheetEntryRevision: company({
    read: or(
      and(owner("employeeId"), inCompany("companyId", "employee")),
      inCompany("companyId", "view")
    ),
    create: false,
    update: false,
    delete: false
  }),
  tool: company({ read: "employee" }),
  trackedActivity: company({ read: "employee", create: "employee" }),
  trackedActivityInput: company({ read: "employee", create: "employee" }),
  trackedActivityOutput: company({ read: "employee", create: "employee" }),
  trackedEntity: company({ read: "employee", create: "employee" }),
  training: company({ read: "employee" }),
  trainingAssignment: company(),
  trainingCompletion: policies({
    select: inCompany("companyId", "view"),
    insert: or(
      inCompany("companyId", "create"),
      and(owner("employeeId"), inCompany("companyId", "employee"))
    ),
    update: inCompany("companyId", "update"),
    delete: inCompany("companyId", "delete")
  }),
  trainingQuestion: company({ read: "employee" }),
  // Written only by the OEE sync and the entitlement-gated @carbon/ee/oee.server
  // functions, over Kysely and under the device lock: read-only through the API.
  unattributedMachineTime: policies({
    select: inCompany("companyId", "employee")
  }),
  unitOfMeasure: company({ read: "member" }),
  user: custom(
    "bespoke: five overlapping policies — self, shared company membership, employee/customer/supplier accounts, Accounts Edit, and an API-key EXISTS on userToCompany",
    (t) => `
    CREATE POLICY "Employees can view users with an account in their company" ON ${t} AS PERMISSIVE FOR SELECT TO public USING (((id IN ( SELECT employee.id
   FROM employee
  WHERE (employee."companyId" = ANY (( SELECT get_companies_with_employee_role() AS get_companies_with_employee_role)::text[])))) OR (id IN ( SELECT "customerAccount".id
   FROM "customerAccount"
  WHERE ("customerAccount"."companyId" = ANY (( SELECT get_companies_with_employee_role() AS get_companies_with_employee_role)::text[])))) OR (id IN ( SELECT "supplierAccount".id
   FROM "supplierAccount"
  WHERE ("supplierAccount"."companyId" = ANY (( SELECT get_companies_with_employee_role() AS get_companies_with_employee_role)::text[]))))));
    CREATE POLICY "Employees with Accounts Edit can update users in their company" ON ${t} AS PERMISSIVE FOR UPDATE TO public USING ((id IN ( SELECT "userToCompany"."userId"
   FROM "userToCompany"
  WHERE ("userToCompany"."companyId" = ANY (( SELECT get_companies_with_employee_permission('users.accounts_update'::text) AS get_companies_with_employee_permission)::text[]))))) WITH CHECK ((id IN ( SELECT "userToCompany"."userId"
   FROM "userToCompany"
  WHERE ("userToCompany"."companyId" = ANY (( SELECT get_companies_with_employee_permission('users.accounts_update'::text) AS get_companies_with_employee_permission)::text[])))));
    CREATE POLICY "Requests with an API key can select users from their company" ON ${t} AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM "userToCompany"
  WHERE (("userToCompany"."userId" = "user".id) AND ("userToCompany"."companyId" = get_company_id_from_api_key())))));
    CREATE POLICY "Users can modify themselves" ON ${t} AS PERMISSIVE FOR UPDATE TO public USING (((( SELECT auth.uid() AS uid))::text = id)) WITH CHECK (((( SELECT auth.uid() AS uid))::text = id));
    CREATE POLICY "Users can view other users from their same company" ON ${t} AS PERMISSIVE FOR SELECT TO public USING (((id = (( SELECT auth.uid() AS uid))::text) OR (id IN ( SELECT "userToCompany"."userId"
   FROM "userToCompany"
  WHERE ("userToCompany"."companyId" IN ( SELECT "userToCompany_1"."companyId"
           FROM "userToCompany" "userToCompany_1"
          WHERE ("userToCompany_1"."userId" = (( SELECT auth.uid() AS uid))::text)))))));
  `
  ),
  // Employees read the attributes they manage for themselves, so the self-service path of
  // userAttributeValue (which reads these rows under the caller's RLS) works without
  // Attributes at View; every other attribute still needs it.
  userAttribute: policies({
    select: or(
      through(
        "userAttributeCategoryId",
        "userAttributeCategory",
        "id",
        inCompany("companyId", "view")
      ),
      and(
        where<"userAttribute">((eb) => eb("canSelfManage", "=", true)),
        through(
          "userAttributeCategoryId",
          "userAttributeCategory",
          "id",
          inCompany("companyId", "employee")
        )
      )
    ),
    insert: through(
      "userAttributeCategoryId",
      "userAttributeCategory",
      "id",
      inCompany("companyId", "create")
    ),
    update: through(
      "userAttributeCategoryId",
      "userAttributeCategory",
      "id",
      inCompany("companyId", "update")
    ),
    delete: through(
      "userAttributeCategoryId",
      "userAttributeCategory",
      "id",
      inCompany("companyId", "delete")
    )
  }),
  // Any employee reads the categories (names only): userAttribute's self-service read goes
  // through them, and they cannot look back at userAttribute without a policy cycle.
  userAttributeCategory: policies({
    select: inCompany("companyId", "employee"),
    insert: inCompany("companyId", "create"),
    update: inCompany("companyId", "update"),
    delete: inCompany("companyId", "delete")
  }),
  // A user reads, writes and clears their own values of self-managed attributes, in a
  // company they belong to; Attributes at Edit manages everyone's. (The imported "insert"
  // policy was FOR UPDATE with no USING, so the account page could not save a value without
  // Attributes at Edit.)
  userAttributeValue: policies({
    all: or(and(owner("userId"), ownAttribute), managedAttribute)
  }),
  userModulePreference: policies({ all: owner("userId") }),
  userPermission: policies({
    select: through("id", "userToCompany", "userId", member("companyId"))
  }),
  // Memberships are written only by the server (invites, SSO, onboarding) through the
  // service role. Through the API an admin could otherwise attach any user to their company
  // and then read that user's profile and permissions.
  userToCompany: company({ read: "employee", create: false, update: false }),
  // Unused since the parts schema: nothing writes it, so the API cannot either.
  warehouse: company({
    read: "employee",
    create: false,
    update: false,
    delete: false
  }),
  warehouseTransfer: company(),
  warehouseTransferLine: company(),
  webhook: company(),
  webhookTable: policies({ select: authenticated }),
  workCenter: company({ read: "employee" }),
  // Written only by the OEE sync and the entitlement-gated @carbon/ee/oee.server
  // functions, over Kysely and under the device lock: read-only through the API.
  workCenterDevice: policies({ select: inCompany("companyId", "employee") }),
  // Written only by the load and unload interceptors: read-only through the API.
  workCenterLoad: policies({ select: inCompany("companyId", "employee") }),
  workCenterProcess: company({ read: "employee" }),
  workCenterReplacementPart: company(),
  workCenterShift: company({ read: "employee" }),
  workflow: company(),
  workflowRun: company({
    create: false,
    update: false,
    delete: false
  }),
  workflowStepRun: company({
    create: false,
    update: false,
    delete: false
  }),
  workflowTriggerEvent: company({
    create: "update",
    update: false,
    delete: "update"
  }),
  workflowVersion: company(),
  // Who may join a private Realtime broadcast topic. The policy is checked once,
  // when the client joins; the topic itself names the company or the user.
  "realtime.messages": external(
    "the row has no company or user column: the topic (company:<id>:<table>, user:<id>:<table>) carries the scope",
    (t) => `
    CREATE POLICY "company topic" ON ${t} FOR SELECT TO authenticated USING ((split_part(realtime.topic(), ':', 1) = 'company') AND (split_part(realtime.topic(), ':', 2) = ANY ((SELECT get_companies_with_employee_role())::text[])));
    CREATE POLICY "user topic" ON ${t} FOR SELECT TO authenticated USING ((split_part(realtime.topic(), ':', 1) = 'user') AND (split_part(realtime.topic(), ':', 2) = ((SELECT auth.uid()))::text));`
  )
} satisfies Manifest;
