// The authorization rules for every public table. `authz sync` makes a database match this
// file; `authz migration` ships a change to databases that do not sync yet (see migration.ts).
import {
  always,
  and,
  anyOf,
  authenticated,
  company,
  custom,
  exists,
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
  serviceOnly,
  through,
  viaParent,
  where
} from "./rules";

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

/** The value's attribute belongs to a category the caller manages (resources_update). */
const managedAttribute = through(
  "userAttributeId",
  "userAttribute",
  "id",
  through(
    "userAttributeCategoryId",
    "userAttributeCategory",
    "id",
    inCompany("companyId", "resources_update")
  )
);

export const manifest = {
  ability: company("resources", {
    read: anyOf("resources_view", "production_view")
  }),
  account: group("accounting"),
  accountDefault: company("accounting", {
    read: "accounting_view",
    create: false,
    delete: false
  }),
  accountingPeriod: company("accounting", { read: "accounting_view" }),
  accountingPeriodBalance: company("accounting", {
    read: "accounting_view",
    delete: "accounting_update"
  }),
  accountingSyncOperation: company("settings", {
    create: false,
    delete: false
  }),
  accountingSyncTieOut: company("accounting", {
    read: "accounting_view",
    create: false,
    update: false,
    delete: false
  }),
  address: policies({
    select: inCompany("companyId", anyOf("sales_view", "purchasing_view")),
    insert: inCompany("companyId", anyOf("sales_create", "purchasing_create")),
    update: inCompany("companyId", anyOf("sales_update", "purchasing_update")),
    delete: inCompany("companyId", anyOf("sales_delete", "purchasing_delete"))
  }),
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
  WHERE ((m.id = "agentMessagePart"."messageId") AND (m."companyId" = "agentMessagePart"."companyId") AND (t."userId" = (auth.uid())::text))))));
    CREATE POLICY "SELECT" ON ${t} AS PERMISSIVE FOR SELECT TO public USING ((("companyId" = ANY (( SELECT get_companies_with_employee_role() AS get_companies_with_employee_role)::text[])) AND (EXISTS ( SELECT 1
   FROM ("agentMessage" m
     JOIN "agentThread" t ON (((t.id = m."threadId") AND (t."companyId" = m."companyId"))))
  WHERE ((m.id = "agentMessagePart"."messageId") AND (m."companyId" = "agentMessagePart"."companyId") AND (t."userId" = (auth.uid())::text))))));
    CREATE POLICY "UPDATE" ON ${t} AS PERMISSIVE FOR UPDATE TO public USING ((("companyId" = ANY (( SELECT get_companies_with_employee_role() AS get_companies_with_employee_role)::text[])) AND (EXISTS ( SELECT 1
   FROM ("agentMessage" m
     JOIN "agentThread" t ON (((t.id = m."threadId") AND (t."companyId" = m."companyId"))))
  WHERE ((m.id = "agentMessagePart"."messageId") AND (m."companyId" = "agentMessagePart"."companyId") AND (t."userId" = (auth.uid())::text))))));
  `
  ),
  agentThread: policies({
    all: and(owner("userId"), inCompany("companyId", "employee"))
  }),
  apiKey: company("settings", { read: "settings_view" }),
  apiKeyRateLimit: policies({
    select: exists("apiKey", "apiKeyId", "settings_view")
  }),
  approvalRequest: serviceOnly(),
  approvalRule: company("settings", { read: "settings_view" }),
  assemblyComponentMapping: company("production"),
  assemblyInstruction: company("production"),
  assemblyInstructionStep: company("production"),
  assemblyInstructionStepMaterial: company("production"),
  assemblyInstructionStepSlide: company("production", {
    read: "production_view"
  }),
  assemblyInstructionStepTool: company("production", {
    read: "production_view"
  }),
  assemblyPlanJob: company("production"),
  assemblyUnit: company("production"),
  attributeDataType: policies({ select: authenticated }),
  auditLogArchive: serviceOnly(),
  balloon: company("quality"),
  batchProperty: policies({
    select: inCompany("companyId", anyOf("parts_view", "inventory_view")),
    insert: inCompany("companyId", anyOf("parts_create", "inventory_create")),
    update: inCompany("companyId", anyOf("parts_update", "inventory_update")),
    delete: inCompany("companyId", anyOf("parts_delete", "inventory_delete"))
  }),
  capacityReservation: company("production"),
  charge: policies({
    select: inCompany("companyId", "employee"),
    insert: and(
      where<"charge">((eb) => eb("status", "=", "Draft")),
      inCompany("companyId", "invoicing_create")
    ),
    update: and(
      where<"charge">((eb) => eb("status", "=", "Draft")),
      inCompany("companyId", "invoicing_update")
    ),
    delete: and(
      where<"charge">((eb) => eb("status", "=", "Draft")),
      inCompany("companyId", "invoicing_delete")
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
      inCompany("companyId", "invoicing_create")
    ),
    update: and(
      exists(
        "charge",
        "chargeId",
        where<"charge">((eb) => eb("status", "=", "Draft")),
        { sameCompany: true }
      ),
      inCompany("companyId", "invoicing_update")
    ),
    delete: and(
      exists(
        "charge",
        "chargeId",
        where<"charge">((eb) => eb("status", "=", "Draft")),
        { sameCompany: true }
      ),
      inCompany("companyId", "invoicing_delete")
    )
  }),
  challengeAttempt: policies({
    select: owner("userId"),
    insert: owner("userId")
  }),
  changeOrder: company("parts", { read: "parts_view" }),
  changeOrderActionTask: company("parts", { read: "parts_view" }),
  changeOrderAffectedItem: company("parts", { read: "parts_view" }),
  changeOrderRequiredAction: company("parts"),
  changeOrderSupersession: company("parts", { read: "parts_view" }),
  changeOrderType: company("parts"),
  changelogDispatch: serviceOnly(),
  company: policies({
    select: and(
      isNotNull("companyGroupId"),
      inGroup("companyGroupId", "employee")
    ),
    update: inCompany("id", "settings_update")
  }),
  companyAccountsPayableBillingAddress: company("settings", { column: "id" }),
  companyAccountsReceivableBillingAddress: company("settings", {
    column: "id"
  }),
  companyGroup: policies({
    select: through("id", "company", "companyGroupId", member("id"))
  }),
  companyIntegration: company("settings", { read: "settings_view" }),
  companyPlan: policies({ select: and(authenticated, member("id")) }),
  companySettings: company("settings", {
    create: false,
    delete: false,
    column: "id"
  }),
  companyUsage: policies({ select: and(authenticated, member("id")) }),
  config: policies({ select: authenticated }),
  configurationParameter: company("parts", { read: "member" }),
  configurationParameterGroup: company("parts", { read: "member" }),
  configurationRule: company("parts", { read: "parts_view" }),
  consumable: company("parts"),
  contact: policies({
    select: inCompany("companyId", anyOf("sales_view", "purchasing_view")),
    insert: inCompany("companyId", anyOf("sales_create", "purchasing_create")),
    update: inCompany("companyId", anyOf("sales_update", "purchasing_update")),
    delete: inCompany("companyId", anyOf("sales_delete", "purchasing_delete"))
  }),
  contractor: company("resources", { read: "resources_view" }),
  contractorAbility: policies({
    select: viaParent("contractorId", "contractor", "resources_view"),
    insert: viaParent("contractorId", "contractor", "resources_create"),
    update: viaParent("contractorId", "contractor", "resources_update"),
    delete: viaParent("contractorId", "contractor", "resources_delete")
  }),
  costCenter: company("accounting"),
  costLedger: policies({
    select: inCompany("companyId", anyOf("accounting_view", "parts_view"))
  }),
  country: policies({ select: authenticated }),
  currency: group("accounting"),
  currencyCode: policies({ select: authenticated }),
  customer: policies({
    select: or(
      inCompany("companyId", "sales_view"),
      portal.customer("id", "sales_view")
    ),
    insert: inCompany("companyId", "sales_create"),
    update: inCompany("companyId", "sales_update"),
    delete: inCompany("companyId", "sales_delete")
  }),
  customerAccount: policies({
    select: or(
      inCompany("companyId", "sales_view"),
      portal.customer("customerId", "sales_view")
    ),
    insert: inCompany("companyId", "sales_create"),
    update: inCompany("companyId", "sales_update"),
    delete: inCompany("companyId", "sales_delete")
  }),
  customerBankAccount: company("accounting", { read: "accounting_view" }),
  customerContact: policies({
    select: or(
      viaParent("customerId", "customer", "sales_view"),
      portal.customer("customerId", "sales_view")
    ),
    insert: or(
      viaParent("customerId", "customer", "sales_create"),
      portal.customer("customerId", "sales_create")
    ),
    update: or(
      viaParent("customerId", "customer", "sales_update"),
      portal.customer("customerId", "sales_update")
    ),
    delete: or(
      viaParent("customerId", "customer", "sales_delete"),
      portal.customer("customerId", "sales_delete")
    )
  }),
  customerItemPriceOverride: company("sales"),
  customerItemPriceOverrideBreak: company("sales"),
  customerLocation: policies({
    select: or(
      viaParent("customerId", "customer", "sales_view"),
      portal.customer("customerId", "sales_view")
    ),
    insert: or(
      viaParent("customerId", "customer", "sales_create"),
      portal.customer("customerId", "sales_create")
    ),
    update: or(
      viaParent("customerId", "customer", "sales_update"),
      portal.customer("customerId", "sales_update")
    ),
    delete: or(
      viaParent("customerId", "customer", "sales_delete"),
      portal.customer("customerId", "sales_delete")
    )
  }),
  customerPartToItem: policies({
    select: or(
      or(
        inCompany("companyId", "sales_view"),
        inCompany("companyId", "parts_view")
      ),
      or(
        portal.customer("customerId", "sales_view"),
        portal.customer("customerId", "parts_view")
      )
    ),
    insert: or(
      or(
        inCompany("companyId", "sales_create"),
        inCompany("companyId", "parts_create")
      ),
      or(
        portal.customer("customerId", "sales_create"),
        portal.customer("customerId", "parts_create")
      )
    ),
    update: or(
      or(
        inCompany("companyId", "sales_update"),
        inCompany("companyId", "parts_update")
      ),
      or(
        portal.customer("customerId", "sales_update"),
        portal.customer("customerId", "parts_update")
      )
    ),
    delete: or(
      or(
        inCompany("companyId", "sales_delete"),
        inCompany("companyId", "parts_delete")
      ),
      or(
        portal.customer("customerId", "sales_delete"),
        portal.customer("customerId", "parts_delete")
      )
    )
  }),
  customerPayment: company("sales", {
    read: "sales_view",
    create: false,
    delete: false
  }),
  customerShipping: company("sales", {
    read: "sales_view",
    create: false,
    delete: false
  }),
  customerStatus: company("sales", { read: "member" }),
  customerTax: company("sales", {
    read: "sales_view",
    create: false,
    delete: false
  }),
  customerType: company("sales", { read: "member" }),
  customField: company("settings", { read: "member" }),
  customFieldTable: policies({ select: authenticated }),
  demandActual: policies({
    select: or(
      inCompany("companyId", "parts_view"),
      inCompany("companyId", "inventory_view")
    ),
    insert: inCompany("companyId", "inventory_create"),
    update: inCompany("companyId", "inventory_update"),
    delete: inCompany("companyId", "inventory_delete")
  }),
  demandForecast: company("inventory", {
    read: "inventory_view"
  }),
  demandForecastSource: company("inventory", {
    read: "inventory_view"
  }),
  demandProjection: company("inventory", {
    read: "inventory_view"
  }),
  department: company("people"),
  depreciationRun: company("accounting", { read: "accounting_view" }),
  depreciationRunLine: company("accounting", { read: "accounting_view" }),
  dimension: group("accounting"),
  dimensionValue: group("accounting"),
  document: custom(
    "bespoke: readGroups/writeGroups arrays via groups_for_user, plus has_valid_api_key_for_company",
    (t) => `
    CREATE POLICY "DELETE" ON ${t} AS PERMISSIVE FOR DELETE TO public USING ((("companyId" = ANY (( SELECT get_companies_with_employee_permission('documents_delete'::text) AS get_companies_with_employee_permission)::text[])) AND (has_valid_api_key_for_company("companyId") OR ((groups_for_user((( SELECT auth.uid() AS uid))::text) && "writeGroups") = true))));
    CREATE POLICY "INSERT" ON ${t} AS PERMISSIVE FOR INSERT TO public WITH CHECK ((("companyId" = ANY (( SELECT get_companies_with_employee_permission('documents_create'::text) AS get_companies_with_employee_permission)::text[])) AND (has_valid_api_key_for_company("companyId") OR ((groups_for_user((( SELECT auth.uid() AS uid))::text) && "writeGroups") = true))));
    CREATE POLICY "SELECT" ON ${t} AS PERMISSIVE FOR SELECT TO public USING ((("companyId" = ANY (( SELECT get_companies_with_employee_permission('documents_view'::text) AS get_companies_with_employee_permission)::text[])) AND (has_valid_api_key_for_company("companyId") OR ((groups_for_user((( SELECT auth.uid() AS uid))::text) && "readGroups") = true))));
    CREATE POLICY "UPDATE" ON ${t} AS PERMISSIVE FOR UPDATE TO public USING ((("companyId" = ANY (( SELECT get_companies_with_employee_permission('documents_update'::text) AS get_companies_with_employee_permission)::text[])) AND (has_valid_api_key_for_company("companyId") OR ((groups_for_user((( SELECT auth.uid() AS uid))::text) && "writeGroups") = true))));
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
  documentSection: company("settings"),
  documentTemplate: company("settings"),
  documentTransaction: policies({
    select: owner("userId"),
    insert: owner("userId")
  }),
  employee: company("users", { create: "users_update" }),
  employeeAbility: company("resources", { read: "resources_view" }),
  employeeJob: company("people"),
  employeePin: serviceOnly(),
  employeeShift: company("people", { read: "people_view" }),
  employeeType: company("users", {
    read: "users_update",
    create: "users_update",
    delete: "users_update"
  }),
  employeeTypePermission: policies({
    all: viaParent("employeeTypeId", "employeeType", "users_update")
  }),
  enforcementRule: policies({
    select: inCompany("companyId", "employee"),
    insert: or(
      and(
        where<"enforcementRule">((eb) => eb("family", "=", "storage")),
        inCompany("companyId", "inventory_create")
      ),
      and(
        where<"enforcementRule">((eb) => eb("family", "=", "sales")),
        inCompany("companyId", "sales_create")
      )
    ),
    update: or(
      and(
        where<"enforcementRule">((eb) => eb("family", "=", "storage")),
        inCompany("companyId", "inventory_update")
      ),
      and(
        where<"enforcementRule">((eb) => eb("family", "=", "sales")),
        inCompany("companyId", "sales_update")
      )
    ),
    delete: or(
      and(
        where<"enforcementRule">((eb) => eb("family", "=", "storage")),
        inCompany("companyId", "inventory_delete")
      ),
      and(
        where<"enforcementRule">((eb) => eb("family", "=", "sales")),
        inCompany("companyId", "sales_delete")
      )
    )
  }),
  enforcementRuleAcknowledgment: company("sales", {
    update: false,
    delete: false
  }),
  enforcementRuleItemAssignment: policies({
    select: inCompany("companyId", "employee"),
    insert: exists(
      "enforcementRule",
      "ruleId",
      or(
        and(
          where<"enforcementRule">((eb) => eb("family", "=", "storage")),
          inCompany("companyId", "parts_create")
        ),
        and(
          where<"enforcementRule">((eb) => eb("family", "=", "sales")),
          inCompany("companyId", "sales_create")
        )
      ),
      { sameCompany: true }
    ),
    update: exists(
      "enforcementRule",
      "ruleId",
      or(
        and(
          where<"enforcementRule">((eb) => eb("family", "=", "storage")),
          inCompany("companyId", "parts_update")
        ),
        and(
          where<"enforcementRule">((eb) => eb("family", "=", "sales")),
          inCompany("companyId", "sales_update")
        )
      ),
      { sameCompany: true }
    ),
    delete: exists(
      "enforcementRule",
      "ruleId",
      or(
        and(
          where<"enforcementRule">((eb) => eb("family", "=", "storage")),
          inCompany("companyId", "parts_delete")
        ),
        and(
          where<"enforcementRule">((eb) => eb("family", "=", "sales")),
          inCompany("companyId", "sales_delete")
        )
      ),
      { sameCompany: true }
    )
  }),
  enforcementRuleWorkCenterAssignment: policies({
    select: inCompany("companyId", "employee"),
    insert: exists(
      "enforcementRule",
      "ruleId",
      and(
        where<"enforcementRule">((eb) => eb("family", "=", "storage")),
        where<"enforcementRule">((eb) => eb("targetType", "=", "workCenter")),
        inCompany("companyId", "resources_create")
      ),
      { sameCompany: true }
    ),
    update: exists(
      "enforcementRule",
      "ruleId",
      and(
        where<"enforcementRule">((eb) => eb("family", "=", "storage")),
        where<"enforcementRule">((eb) => eb("targetType", "=", "workCenter")),
        inCompany("companyId", "resources_update")
      ),
      { sameCompany: true }
    ),
    delete: inCompany("companyId", "resources_delete")
  }),
  eventSystemSubscription: company("settings"),
  exchangeRate: policies({ select: always, to: "authenticated" }),
  exchangeRateOverride: company("accounting", {
    create: "accounting_update",
    delete: "accounting_update"
  }),
  externalIntegrationMapping: policies({
    select: inCompany("companyId", "employee"),
    insert: inCompany("companyId", "employee")
  }),
  externalLink: policies({
    select: inCompany("companyId", "employee"),
    insert: inCompany(
      "companyId",
      anyOf("sales_create", "purchasing_create", "quality_create")
    ),
    update: inCompany(
      "companyId",
      anyOf("sales_update", "purchasing_update", "quality_update")
    ),
    delete: inCompany(
      "companyId",
      anyOf("sales_delete", "purchasing_delete", "quality_delete")
    )
  }),
  feedback: serviceOnly(),
  fiscalYearSettings: company("settings", { read: "settings_view" }),
  fixedAsset: company("accounting", { read: "accounting_view" }),
  fixedAssetClass: company("accounting", { read: "accounting_view" }),
  fixedAssetDisposal: company("accounting", {
    read: "accounting_view",
    update: false,
    delete: false
  }),
  fixedAssetUsageLog: company("accounting", { read: "accounting_view" }),
  fixture: serviceOnly(),
  fulfillment: company("sales", {
    read: anyOf("inventory_view", "sales_view"),
    create: anyOf("inventory_create", "sales_create")
  }),
  gauge: company("quality"),
  gaugeCalibrationRecord: company("quality", { read: "quality_view" }),
  gaugeType: company("quality"),
  group: company("users"),
  holiday: company("people"),
  implementationCheckState: company("settings", {
    create: "employee",
    update: "employee"
  }),
  implementationFieldValue: company("settings", {
    create: "employee",
    update: "employee"
  }),
  implementationHub: company("settings", { update: "employee", column: "id" }),
  implementationRow: policies({ all: inCompany("companyId", "employee") }),
  industry: policies({ select: authenticated }),
  inspection: company("quality", { read: "quality_view" }),
  inspectionDocument: company("quality"),
  inspectionFeature: company("quality"),
  inspectionHistory: company("quality", {
    read: "quality_view",
    update: false,
    delete: false
  }),
  inspectionMeasurement: company("quality", { read: "quality_view" }),
  inspectionSample: company("quality", { read: "quality_view" }),
  inspectionSamplingPlan: company("quality", { read: "quality_view" }),
  integration: policies({ select: authenticated }),
  intercompanyEliminationLine: company("accounting"),
  intercompanyTransaction: policies({
    select: or(
      inCompany("sourceCompanyId", "accounting_create"),
      inCompany("targetCompanyId", "accounting_create")
    ),
    insert: or(
      inCompany("sourceCompanyId", "accounting_create"),
      inCompany("targetCompanyId", "accounting_create")
    ),
    update: or(
      inCompany("sourceCompanyId", "accounting_update"),
      inCompany("targetCompanyId", "accounting_update")
    ),
    delete: or(
      inCompany("sourceCompanyId", "accounting_delete"),
      inCompany("targetCompanyId", "accounting_delete")
    )
  }),
  inventoryCount: company("inventory", { read: "inventory_view" }),
  inventoryCountLine: company("inventory", { read: "inventory_view" }),
  invite: serviceOnly(),
  // Settlements change only while the payment and memo they apply are still Draft, in the
  // settlement's own company. (The imported policy compared each parent to itself —
  // p.id = p."paymentId" — so writes only passed when both ids were null.)
  invoiceSettlement: policies({
    select: inCompany("companyId", "employee"),
    insert: and(draftSettlement, inCompany("companyId", "invoicing_create")),
    update: and(draftSettlement, inCompany("companyId", "invoicing_update")),
    delete: and(draftSettlement, inCompany("companyId", "invoicing_delete"))
  }),
  itarCertification: policies({ select: inCompany("companyId", "employee") }),
  item: policies({
    select: or(
      inCompany("companyId", "employee"),
      through(
        "id",
        "supplierPart",
        "itemId",
        and(portal.supplier("supplierId", "parts_view"), isNotNull("itemId"))
      ),
      through(
        "id",
        "customerPartToItem",
        "itemId",
        and(portal.customer("customerId", "parts_view"), isNotNull("itemId"))
      )
    ),
    insert: inCompany("companyId", "parts_create"),
    update: or(
      inCompany("companyId", "parts_update"),
      through(
        "id",
        "supplierPart",
        "itemId",
        portal.supplier("supplierId", "parts_update")
      ),
      through(
        "id",
        "customerPartToItem",
        "itemId",
        portal.customer("customerId", "parts_update")
      )
    ),
    delete: or(
      inCompany("companyId", "parts_delete"),
      through(
        "id",
        "supplierPart",
        "itemId",
        portal.supplier("supplierId", "parts_delete")
      ),
      through(
        "id",
        "customerPartToItem",
        "itemId",
        portal.customer("customerId", "parts_delete")
      )
    )
  }),
  itemCost: policies({
    select: or(
      or(
        inCompany("companyId", "parts_view"),
        inCompany("companyId", "sales_view")
      ),
      through(
        "itemId",
        "supplierPart",
        "itemId",
        portal.supplier("supplierId", "parts_view")
      )
    ),
    insert: inCompany("companyId", "parts_create"),
    update: or(
      inCompany("companyId", "parts_update"),
      through(
        "itemId",
        "supplierPart",
        "itemId",
        portal.supplier("supplierId", "parts_update")
      ),
      through(
        "itemId",
        "customerPartToItem",
        "itemId",
        portal.customer("customerId", "parts_update")
      )
    )
  }),
  itemInspectionDocumentAssignment: company("quality", {
    read: "quality_view"
  }),
  itemLedger: policies({
    select: inCompany("companyId", anyOf("inventory_view", "accounting_view")),
    insert: inCompany(
      "companyId",
      anyOf("inventory_create", "accounting_create")
    )
  }),
  itemPlanning: company("parts", { read: "parts_view", delete: false }),
  itemPostingGroup: company("accounting", { read: "accounting_view" }),
  itemReplenishment: company("parts", { read: "parts_view" }),
  itemSerialSequence: company("settings"),
  itemShelfLife: company("parts", { read: "parts_view" }),
  itemStockQuantities: policies({ select: inCompany("companyId", "employee") }),
  itemSupersession: company("parts"),
  itemUnitSalePrice: company("parts", {
    read: anyOf("parts_view", "sales_view")
  }),
  job: company("production"),
  jobFavorite: policies({
    select: owner("userId"),
    insert: owner("userId"),
    delete: owner("userId")
  }),
  jobMakeMethod: company("production"),
  jobMaterial: company("production"),
  jobMaterialStep: policies({
    select: exists("jobMaterial", "jobMaterialId", "employee"),
    insert: exists("jobMaterial", "jobMaterialId", "production_create"),
    update: exists("jobMaterial", "jobMaterialId", "production_update"),
    delete: exists("jobMaterial", "jobMaterialId", "production_delete")
  }),
  jobOperation: company("production"),
  jobOperationBatch: company("production"),
  jobOperationDependency: policies({
    select: inCompany("companyId", "employee")
  }),
  jobOperationNote: company("production", { create: "employee" }),
  jobOperationParameter: company("production"),
  jobOperationStep: company("production"),
  jobOperationStepRecord: company("production", { create: "employee" }),
  jobOperationStepSlide: company("production"),
  jobOperationTool: company("production"),
  jobOperationToolStep: policies({
    select: exists("jobOperationTool", "jobOperationToolId", "employee"),
    insert: exists(
      "jobOperationTool",
      "jobOperationToolId",
      "production_create"
    ),
    update: exists(
      "jobOperationTool",
      "jobOperationToolId",
      "production_update"
    ),
    delete: exists(
      "jobOperationTool",
      "jobOperationToolId",
      "production_delete"
    )
  }),
  journal: company("accounting", {
    read: "accounting_view",
    where: {
      // Posted stays updatable only for the Posted -> Reversed transition, which the
      // journal_posted_immutable trigger enforces. The new row is always checked
      // against the company scope alone, so a journal can never move company.
      update: (eb) => eb("status", "in", ["Draft", "Posted"]),
      delete: (eb) => eb("status", "=", "Draft")
    }
  }),
  journalLine: policies({
    select: inCompany("companyId", "accounting_view"),
    insert: inCompany("companyId", "accounting_create"),
    update: and(
      inCompany("companyId", "accounting_update"),
      exists(
        "journal",
        "journalId",
        where<"journal">((eb) => eb("status", "=", "Draft"))
      )
    ),
    delete: and(
      inCompany("companyId", "accounting_delete"),
      exists(
        "journal",
        "journalId",
        where<"journal">((eb) => eb("status", "=", "Draft"))
      )
    )
  }),
  journalLineDimension: company("accounting", {
    read: "accounting_view",
    update: false
  }),
  kanban: company("inventory"),
  lessonCompletion: policies({
    select: owner("userId"),
    insert: owner("userId")
  }),
  location: company("resources"),
  maintenanceDispatch: company("resources", {
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
  maintenanceDispatchEvent: company("resources", {
    create: "employee",
    update: "employee"
  }),
  maintenanceDispatchItem: company("resources", { create: "employee" }),
  // Same rule as its sibling maintenanceDispatchItem. (The imported policy named
  // maintenance_update / maintenance_delete, which no one can hold.)
  maintenanceDispatchItemTrackedEntity: company("resources", {
    create: "employee"
  }),
  maintenanceDispatchWorkCenter: company("resources", { create: "employee" }),
  maintenanceFailureMode: company("resources"),
  maintenanceSchedule: company("resources", { read: "resources_view" }),
  maintenanceScheduleItem: company("resources", { create: "employee" }),
  makeMethod: company("parts", { read: "parts_view" }),
  material: company("parts"),
  materialDimension: policies({
    select: or(isNull("companyId"), inCompany("companyId", "parts_view")),
    insert: inCompany("companyId", "parts_create"),
    update: inCompany("companyId", "parts_update"),
    delete: inCompany("companyId", "parts_delete")
  }),
  materialFinish: policies({
    select: or(isNull("companyId"), inCompany("companyId", "parts_view")),
    insert: inCompany("companyId", "parts_create"),
    update: inCompany("companyId", "parts_update"),
    delete: inCompany("companyId", "parts_delete")
  }),
  materialForm: policies({
    select: or(isNull("companyId"), inCompany("companyId", "parts_view")),
    insert: inCompany("companyId", "parts_create"),
    update: inCompany("companyId", "parts_update"),
    delete: inCompany("companyId", "parts_delete")
  }),
  materialGrade: policies({
    select: or(isNull("companyId"), inCompany("companyId", "parts_view")),
    insert: inCompany("companyId", "parts_create"),
    update: inCompany("companyId", "parts_update"),
    delete: inCompany("companyId", "parts_delete")
  }),
  materialSubstance: policies({
    select: or(isNull("companyId"), inCompany("companyId", "parts_view")),
    insert: inCompany("companyId", "parts_create"),
    update: inCompany("companyId", "parts_update"),
    delete: inCompany("companyId", "parts_delete")
  }),
  materialType: policies({
    select: or(isNull("companyId"), inCompany("companyId", "parts_view")),
    insert: inCompany("companyId", "parts_create"),
    update: inCompany("companyId", "parts_update"),
    delete: inCompany("companyId", "parts_delete")
  }),
  membership: policies({
    select: viaParent("groupId", "group", "employee"),
    insert: viaParent("groupId", "group", "users_update"),
    update: viaParent("groupId", "group", "users_update"),
    delete: viaParent("groupId", "group", "users_update")
  }),
  memo: policies({
    select: inCompany("companyId", "employee"),
    insert: inCompany("companyId", "invoicing_create"),
    update: inCompany("companyId", "invoicing_update"),
    delete: and(
      where<"memo">((eb) => eb("status", "=", "Draft")),
      inCompany("companyId", "invoicing_delete")
    )
  }),
  methodMaterial: company("parts", { read: "parts_view" }),
  methodMaterialStep: policies({
    select: exists("methodMaterial", "methodMaterialId", "employee"),
    insert: exists("methodMaterial", "methodMaterialId", "parts_create"),
    update: exists("methodMaterial", "methodMaterialId", "parts_update"),
    delete: exists("methodMaterial", "methodMaterialId", "parts_delete")
  }),
  methodOperation: company("parts", { read: "parts_view" }),
  methodOperationParameter: company("parts"),
  methodOperationStep: company("production"),
  methodOperationStepSlide: company("production"),
  methodOperationTool: company("parts", { read: "parts_view" }),
  methodOperationToolStep: policies({
    select: exists("methodOperationTool", "methodOperationToolId", "employee"),
    insert: exists(
      "methodOperationTool",
      "methodOperationToolId",
      "parts_create"
    ),
    update: exists(
      "methodOperationTool",
      "methodOperationToolId",
      "parts_update"
    ),
    delete: exists(
      "methodOperationTool",
      "methodOperationToolId",
      "parts_delete"
    )
  }),
  modelUpload: company("parts"),
  nonConformance: company("quality", { read: "quality_view" }),
  nonConformanceActionProcess: company("quality", { read: "quality_view" }),
  nonConformanceActionTask: company("quality", { read: "quality_view" }),
  nonConformanceApprovalTask: company("quality", { read: "quality_view" }),
  nonConformanceCustomer: company("quality", { read: "quality_view" }),
  nonConformanceInspection: company("quality", { read: "quality_view" }),
  nonConformanceItem: company("quality", { read: "quality_view" }),
  nonConformanceItemTrackedEntity: company("quality", { read: "quality_view" }),
  nonConformanceJobOperation: company("quality", { read: "quality_view" }),
  nonConformancePurchaseOrderLine: company("quality", { read: "quality_view" }),
  nonConformancePurchaseReturnOrderLine: company("quality", {
    read: "quality_view"
  }),
  nonConformanceReceiptLine: company("quality", { read: "quality_view" }),
  nonConformanceRequiredAction: company("quality", { read: "quality_view" }),
  nonConformanceReviewer: company("quality", { read: "quality_view" }),
  nonConformanceSalesOrderLine: company("quality", { read: "quality_view" }),
  nonConformanceSalesReturnOrderLine: company("quality", {
    read: "quality_view"
  }),
  nonConformanceShipmentLine: company("quality", { read: "quality_view" }),
  nonConformanceSupplier: company("quality", { read: "quality_view" }),
  nonConformanceTrackedEntity: company("quality", { read: "quality_view" }),
  nonConformanceType: company("quality"),
  nonConformanceWorkflow: company("quality", { read: "quality_view" }),
  noQuoteReason: company("sales", { read: "sales_view" }),
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
  notificationPreference: policies({
    select: and(owner("userId"), member("companyId")),
    insert: and(owner("userId"), member("companyId")),
    update: {
      using: owner("userId"),
      check: and(owner("userId"), member("companyId"))
    },
    delete: and(owner("userId"), member("companyId"))
  }),
  oauthClient: serviceOnly(),
  oauthCode: serviceOnly(),
  oauthToken: serviceOnly(),
  opportunity: company("sales", { read: "sales_view", delete: false }),
  part: company("parts"),
  partner: company("resources"),
  passkeyCredential: policies({ all: owner("userId") }),
  payment: policies({
    select: inCompany("companyId", "employee"),
    insert: inCompany("companyId", "invoicing_create"),
    update: inCompany("companyId", "invoicing_update"),
    delete: and(
      where<"payment">((eb) => eb("status", "=", "Draft")),
      inCompany("companyId", "invoicing_delete")
    )
  }),
  paymentTerm: company("accounting", {
    read: anyOf("accounting_view", "sales_view", "purchasing_view")
  }),
  peopleAbsence: company("production"),
  peopleAssignment: company("production"),
  period: policies({ select: authenticated }),
  periodCloseTask: company("accounting"),
  periodCloseTaskDefinition: company("accounting"),
  pickingList: company("inventory", { read: "inventory_view" }),
  pickingListLine: company("inventory", { read: "inventory_view" }),
  pickingListLineTrackedEntity: policies({
    select: exists("pickingListLine", "pickingListLineId", "inventory_view"),
    insert: exists("pickingListLine", "pickingListLineId", "inventory_create"),
    update: exists("pickingListLine", "pickingListLineId", "inventory_update"),
    delete: exists("pickingListLine", "pickingListLineId", "inventory_delete")
  }),
  pickMethod: company("parts", { read: "parts_view", delete: false }),
  plan: policies({ select: authenticated }),
  pricingRule: company("sales"),
  printerRoute: company("printing", { read: "printing_view" }),
  printJob: company("printing", { read: "printing_view" }),
  procedure: company("production"),
  procedureParameter: company("production"),
  procedureStep: company("production"),
  process: company("resources"),
  productionEvent: company("production", { read: "production_view" }),
  productionQuantity: company("production"),
  project: company("accounting"),
  purchaseInvoice: company("invoicing", { read: "invoicing_view" }),
  purchaseInvoiceDelivery: company("invoicing", { read: "invoicing_view" }),
  purchaseInvoiceLine: company("invoicing", { read: "invoicing_view" }),
  purchaseInvoicePriceChange: policies({
    select: viaParent("invoiceId", "purchaseInvoice", "invoicing_view")
  }),
  purchaseInvoiceStatusHistory: policies({
    select: viaParent("invoiceId", "purchaseInvoice", "invoicing_view")
  }),
  purchaseOrder: company("purchasing", {
    read: anyOf("purchasing_view", "inventory_view", "invoicing_view")
  }),
  purchaseOrderDelivery: company("purchasing", { read: "purchasing_view" }),
  purchaseOrderFavorite: policies({
    select: owner("userId"),
    insert: owner("userId"),
    delete: owner("userId")
  }),
  purchaseOrderLine: company("purchasing", { read: "purchasing_view" }),
  purchaseOrderPayment: company("purchasing", { read: "purchasing_view" }),
  purchaseOrderStatusHistory: policies({
    select: viaParent("purchaseOrderId", "purchaseOrder", "purchasing_view")
  }),
  purchaseOrderTransaction: policies({
    select: viaParent("purchaseOrderId", "purchaseOrder", "purchasing_view"),
    insert: viaParent("purchaseOrderId", "purchaseOrder", "purchasing_update")
  }),
  purchaseReturnOrder: company("purchasing"),
  purchaseReturnOrderCreditLine: company("invoicing"),
  purchaseReturnOrderLine: company("purchasing"),
  purchaseReturnOrderLineTrackedEntity: company("purchasing"),
  purchasingRfq: company("purchasing", { read: "purchasing_view" }),
  purchasingRfqFavorite: policies({
    select: owner("userId"),
    insert: owner("userId"),
    delete: owner("userId")
  }),
  purchasingRfqLine: company("purchasing", { read: "purchasing_view" }),
  purchasingRfqSupplier: company("purchasing", { read: "purchasing_view" }),
  purchasingRfqToPurchaseOrder: company("purchasing", {
    read: "purchasing_view",
    update: false,
    delete: false
  }),
  purchasingRfqToSupplierQuote: company("purchasing", {
    read: "purchasing_view",
    update: false,
    delete: false
  }),
  qualityDocument: company("quality"),
  qualityDocumentStep: company("production"),
  quote: company("sales", { read: "sales_view" }),
  quoteFavorite: policies({
    select: owner("userId"),
    insert: owner("userId"),
    delete: owner("userId")
  }),
  quoteLine: company("sales", { read: "sales_view" }),
  quoteLinePrice: policies({
    select: viaParent("quoteLineId", "quoteLine", "sales_view"),
    insert: viaParent("quoteLineId", "quoteLine", "sales_create"),
    update: viaParent("quoteLineId", "quoteLine", "sales_update"),
    delete: viaParent("quoteLineId", "quoteLine", "sales_delete")
  }),
  quoteMakeMethod: company("sales", { read: "sales_view" }),
  quoteMaterial: company("sales", { read: "sales_view" }),
  quoteMaterialStep: policies({
    select: exists("quoteMaterial", "quoteMaterialId", "employee"),
    insert: exists("quoteMaterial", "quoteMaterialId", "sales_create"),
    update: exists("quoteMaterial", "quoteMaterialId", "sales_update"),
    delete: exists("quoteMaterial", "quoteMaterialId", "sales_delete")
  }),
  quoteOperation: company("sales", { read: "sales_view" }),
  quoteOperationParameter: company("parts"),
  quoteOperationStep: company("production"),
  quoteOperationStepSlide: company("production"),
  quoteOperationTool: company("sales"),
  quoteOperationToolStep: policies({
    select: exists("quoteOperationTool", "quoteOperationToolId", "employee"),
    insert: exists(
      "quoteOperationTool",
      "quoteOperationToolId",
      "sales_create"
    ),
    update: exists(
      "quoteOperationTool",
      "quoteOperationToolId",
      "sales_update"
    ),
    delete: exists("quoteOperationTool", "quoteOperationToolId", "sales_delete")
  }),
  quotePayment: policies({
    select: or(
      inCompany("companyId", "sales_view"),
      exists("quote", "id", portal.customer("customerId", "sales_view"))
    ),
    insert: or(
      inCompany("companyId", "sales_create"),
      exists("quote", "id", portal.customer("customerId", "sales_create"))
    ),
    update: or(
      inCompany("companyId", "sales_update"),
      exists("quote", "id", portal.customer("customerId", "sales_update"))
    ),
    delete: or(
      inCompany("companyId", "sales_delete"),
      exists("quote", "id", portal.customer("customerId", "sales_delete"))
    )
  }),
  quoteShipment: policies({
    select: or(
      inCompany("companyId", "sales_view"),
      exists("quote", "id", portal.customer("customerId", "sales_view"))
    ),
    insert: or(
      inCompany("companyId", "sales_create"),
      exists("quote", "id", portal.customer("customerId", "sales_create"))
    ),
    update: or(
      inCompany("companyId", "sales_update"),
      exists("quote", "id", portal.customer("customerId", "sales_update"))
    ),
    delete: or(
      inCompany("companyId", "sales_delete"),
      exists("quote", "id", portal.customer("customerId", "sales_delete"))
    )
  }),
  receipt: company("inventory", { read: "inventory_view" }),
  receiptFixedAssetLine: company("inventory", { read: "inventory_view" }),
  receiptLine: company("inventory", { read: "inventory_view" }),
  reimbursement: policies({
    select: inCompany("companyId", "employee"),
    insert: and(
      where<"reimbursement">((eb) => eb("status", "=", "Draft")),
      inCompany("companyId", "invoicing_create")
    ),
    update: and(
      where<"reimbursement">((eb) => eb("status", "=", "Draft")),
      inCompany("companyId", "invoicing_update")
    ),
    delete: and(
      where<"reimbursement">((eb) => eb("status", "=", "Draft")),
      inCompany("companyId", "invoicing_delete")
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
      inCompany("companyId", "invoicing_create")
    ),
    update: and(
      exists(
        "reimbursement",
        "reimbursementId",
        where<"reimbursement">((eb) => eb("status", "=", "Draft")),
        { sameCompany: true }
      ),
      inCompany("companyId", "invoicing_update")
    ),
    delete: and(
      exists(
        "reimbursement",
        "reimbursementId",
        where<"reimbursement">((eb) => eb("status", "=", "Draft")),
        { sameCompany: true }
      ),
      inCompany("companyId", "invoicing_delete")
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
    CREATE POLICY "INSERT" ON ${t} AS PERMISSIVE FOR INSERT TO public WITH CHECK ((EXISTS (SELECT 1 FROM public."reimbursementLine" l JOIN public."reimbursement" h ON ((h.id = l."reimbursementId") AND (h."companyId" = l."companyId")) WHERE ((l.id = ${t}."reimbursementLineId") AND (l."companyId" = ${t}."companyId") AND (h.status = 'Draft'::"reimbursementStatus"))) AND ("companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing_create'::text))::text[]))));
    CREATE POLICY "DELETE" ON ${t} AS PERMISSIVE FOR DELETE TO public USING ((EXISTS (SELECT 1 FROM public."reimbursementLine" l JOIN public."reimbursement" h ON ((h.id = l."reimbursementId") AND (h."companyId" = l."companyId")) WHERE ((l.id = ${t}."reimbursementLineId") AND (l."companyId" = ${t}."companyId") AND (h.status = 'Draft'::"reimbursementStatus"))) AND ("companyId" = ANY ((SELECT get_companies_with_employee_permission('invoicing_delete'::text))::text[]))));
  `
  ),
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
  returnReason: company("sales"),
  rework: company("production", { read: "production_view" }),
  riskRegister: company("quality", { create: "employee" }),
  salesInvoice: company("invoicing", { read: "invoicing_view" }),
  salesInvoiceLine: company("invoicing", { read: "invoicing_view" }),
  salesInvoiceShipment: company("invoicing", { read: "invoicing_view" }),
  salesOrder: company("sales", {
    read: anyOf("sales_view", "inventory_view", "invoicing_view")
  }),
  salesOrderFavorite: policies({
    select: owner("userId"),
    insert: owner("userId"),
    delete: owner("userId")
  }),
  salesOrderLine: company("sales", { read: "sales_view" }),
  salesOrderPayment: policies({
    select: or(
      inCompany("companyId", "sales_view"),
      exists("salesOrder", "id", portal.customer("customerId", "sales_view"))
    ),
    insert: or(
      inCompany("companyId", "sales_create"),
      exists("salesOrder", "id", portal.customer("customerId", "sales_create"))
    ),
    update: or(
      inCompany("companyId", "sales_update"),
      exists("salesOrder", "id", portal.customer("customerId", "sales_update"))
    ),
    delete: or(
      inCompany("companyId", "sales_delete"),
      exists("salesOrder", "id", portal.customer("customerId", "sales_delete"))
    )
  }),
  salesOrderShipment: policies({
    select: or(
      inCompany("companyId", "sales_view"),
      exists("salesOrder", "id", portal.customer("customerId", "sales_view"))
    ),
    insert: or(
      inCompany("companyId", "sales_create"),
      exists("salesOrder", "id", portal.customer("customerId", "sales_create"))
    ),
    update: or(
      inCompany("companyId", "sales_update"),
      exists("salesOrder", "id", portal.customer("customerId", "sales_update"))
    ),
    delete: or(
      inCompany("companyId", "sales_delete"),
      exists("salesOrder", "id", portal.customer("customerId", "sales_delete"))
    )
  }),
  salesOrderStatusHistory: policies({
    select: viaParent("salesOrderId", "salesOrder", "sales_view")
  }),
  salesOrderTransaction: policies({
    select: viaParent("salesOrderId", "salesOrder", "sales_view"),
    insert: viaParent("salesOrderId", "salesOrder", "sales_update")
  }),
  salesReturnOrder: company("sales"),
  salesReturnOrderCreditLine: company("invoicing"),
  salesReturnOrderLine: company("sales"),
  salesReturnOrderLineTrackedEntity: company("sales"),
  salesRfq: company("sales", { read: "sales_view" }),
  salesRfqFavorite: policies({
    select: owner("userId"),
    insert: owner("userId"),
    delete: owner("userId")
  }),
  salesRfqLine: company("sales", { read: "sales_view" }),
  scrapReason: company("production"),
  scriptRun: policies({ select: authenticated }),
  searchIndexRegistry: serviceOnly(),
  sequence: company("settings", { read: "settings_view" }),
  service: company("parts"),
  shift: company("people"),
  shipment: company("inventory", {
    read: anyOf("inventory_view", "sales_view"),
    create: anyOf("inventory_create", "sales_create")
  }),
  shipmentFixedAssetLine: company("inventory", { read: "inventory_view" }),
  shipmentLine: company("sales", {
    read: anyOf("inventory_view", "sales_view"),
    create: anyOf("inventory_create", "sales_create")
  }),
  shippingMethod: company("inventory"),
  shippingTerm: company("inventory"),
  slackDocumentThread: serviceOnly(),
  ssoConnection: company("settings", {
    create: "settings_update",
    delete: "settings_update"
  }),
  ssoDomain: company("settings", {
    create: "settings_update",
    delete: "settings_update"
  }),
  ssoReservedDomain: policies({ select: authenticated }),
  stockTransfer: company("inventory"),
  stockTransferLine: company("inventory"),
  storageType: company("parts"),
  storageUnit: company("parts"),
  suggestion: company("resources", {
    read: "resources_view",
    create: "employee"
  }),
  supplier: company("purchasing", { read: "purchasing_view" }),
  supplierAccount: company("purchasing", { read: "purchasing_view" }),
  supplierBankAccount: company("accounting", { read: "accounting_view" }),
  supplierContact: policies({
    select: viaParent("supplierId", "supplier", "purchasing_view"),
    insert: viaParent("supplierId", "supplier", "purchasing_create"),
    update: viaParent("supplierId", "supplier", "purchasing_update"),
    delete: viaParent("supplierId", "supplier", "purchasing_delete")
  }),
  supplierInteraction: company("purchasing", { read: "purchasing_view" }),
  supplierLedger: company("accounting", {
    read: "accounting_view",
    create: false,
    update: false,
    delete: false
  }),
  supplierLocation: policies({
    select: viaParent("supplierId", "supplier", "purchasing_view"),
    insert: viaParent("supplierId", "supplier", "purchasing_create"),
    update: viaParent("supplierId", "supplier", "purchasing_update"),
    delete: viaParent("supplierId", "supplier", "purchasing_delete")
  }),
  supplierPart: company("parts", {
    read: anyOf("parts_view", "purchasing_view")
  }),
  supplierPartPrice: company("parts", {
    read: anyOf("parts_view", "purchasing_view")
  }),
  supplierPayment: company("purchasing", {
    read: "purchasing_view",
    create: false,
    delete: false
  }),
  supplierProcess: company("resources", {
    read: anyOf("purchasing_view", "resources_view", "sales_view"),
    create: anyOf("purchasing_update", "resources_update"),
    delete: anyOf("purchasing_delete", "resources_delete")
  }),
  supplierQuote: company("purchasing", { read: "purchasing_view" }),
  supplierQuoteFavorite: policies({
    select: owner("userId"),
    insert: owner("userId"),
    delete: owner("userId")
  }),
  supplierQuoteLine: company("purchasing", { read: "purchasing_view" }),
  supplierQuoteLinePrice: policies({
    select: viaParent("supplierQuoteId", "supplierQuote", "purchasing_view"),
    insert: viaParent("supplierQuoteId", "supplierQuote", "purchasing_create"),
    update: viaParent("supplierQuoteId", "supplierQuote", "purchasing_update"),
    delete: viaParent("supplierQuoteId", "supplierQuote", "purchasing_delete")
  }),
  supplierShipping: company("purchasing", {
    read: "purchasing_view",
    create: false,
    delete: false
  }),
  supplierTax: company("purchasing", {
    read: "purchasing_view",
    create: false,
    delete: false
  }),
  supplierType: company("purchasing", { read: "member" }),
  supplyActual: policies({
    select: or(
      inCompany("companyId", "parts_view"),
      inCompany("companyId", "inventory_view")
    ),
    insert: inCompany("companyId", "inventory_create"),
    update: inCompany("companyId", "inventory_update"),
    delete: inCompany("companyId", "inventory_delete")
  }),
  supplyForecast: company("inventory", {
    read: "inventory_view"
  }),
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
  tag: company("settings", {
    create: "employee",
    update: false,
    delete: "settings_update"
  }),
  terms: company("settings", {
    read: anyOf("purchasing_view", "sales_view", "settings_view"),
    create: false,
    delete: false,
    column: "id"
  }),
  timeCardEntry: policies({
    select: or(
      and(owner("employeeId"), inCompany("companyId", "employee")),
      inCompany("companyId", "people_view")
    ),
    insert: or(
      and(owner("employeeId"), inCompany("companyId", "employee")),
      inCompany("companyId", "people_create")
    ),
    update: or(
      and(owner("employeeId"), inCompany("companyId", "employee")),
      inCompany("companyId", "people_update")
    ),
    delete: inCompany("companyId", "people_delete")
  }),
  tool: company("parts"),
  trackedActivity: company("inventory", { create: "employee" }),
  trackedActivityInput: company("inventory", { create: "employee" }),
  trackedActivityOutput: company("inventory", { create: "employee" }),
  trackedEntity: company("inventory", { create: "employee" }),
  training: company("resources"),
  trainingAssignment: company("people", { read: "people_view" }),
  trainingCompletion: policies({
    select: inCompany("companyId", "resources_view"),
    insert: or(
      inCompany("companyId", "people_create"),
      and(owner("employeeId"), inCompany("companyId", "employee"))
    ),
    update: inCompany("companyId", "resources_update"),
    delete: inCompany("companyId", "resources_delete")
  }),
  trainingQuestion: company("people"),
  unitOfMeasure: company("parts", { read: "member" }),
  user: custom(
    "bespoke: five overlapping policies — self, shared company membership, employee/customer/supplier accounts, users_update, and an API-key EXISTS on userToCompany",
    (t) => `
    CREATE POLICY "Employees can view users with an account in their company" ON ${t} AS PERMISSIVE FOR SELECT TO public USING (((id IN ( SELECT employee.id
   FROM employee
  WHERE (employee."companyId" = ANY (( SELECT get_companies_with_employee_role() AS get_companies_with_employee_role)::text[])))) OR (id IN ( SELECT "customerAccount".id
   FROM "customerAccount"
  WHERE ("customerAccount"."companyId" = ANY (( SELECT get_companies_with_employee_role() AS get_companies_with_employee_role)::text[])))) OR (id IN ( SELECT "supplierAccount".id
   FROM "supplierAccount"
  WHERE ("supplierAccount"."companyId" = ANY (( SELECT get_companies_with_employee_role() AS get_companies_with_employee_role)::text[]))))));
    CREATE POLICY "Employees with users_update can update users in their company" ON ${t} AS PERMISSIVE FOR UPDATE TO public USING ((id IN ( SELECT "userToCompany"."userId"
   FROM "userToCompany"
  WHERE ("userToCompany"."companyId" = ANY (( SELECT get_companies_with_employee_permission('users_update'::text) AS get_companies_with_employee_permission)::text[]))))) WITH CHECK ((id IN ( SELECT "userToCompany"."userId"
   FROM "userToCompany"
  WHERE ("userToCompany"."companyId" = ANY (( SELECT get_companies_with_employee_permission('users_update'::text) AS get_companies_with_employee_permission)::text[])))));
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
  // resources_view; every other attribute still needs it.
  userAttribute: policies({
    select: or(
      through(
        "userAttributeCategoryId",
        "userAttributeCategory",
        "id",
        inCompany("companyId", "resources_view")
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
      inCompany("companyId", "resources_create")
    ),
    update: through(
      "userAttributeCategoryId",
      "userAttributeCategory",
      "id",
      inCompany("companyId", "resources_update")
    ),
    delete: through(
      "userAttributeCategoryId",
      "userAttributeCategory",
      "id",
      inCompany("companyId", "resources_delete")
    )
  }),
  // Any employee reads the categories (names only): userAttribute's self-service read goes
  // through them, and they cannot look back at userAttribute without a policy cycle.
  userAttributeCategory: policies({
    select: inCompany("companyId", "employee"),
    insert: inCompany("companyId", "resources_create"),
    update: inCompany("companyId", "resources_update"),
    delete: inCompany("companyId", "resources_delete")
  }),
  // A user reads, writes and clears their own values of self-managed attributes, in a
  // company they belong to; resources_update manages everyone's. (The imported "insert"
  // policy was FOR UPDATE with no USING, so the account page could not save a value without
  // resources_update.)
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
  userToCompany: company("users", { create: false, update: false }),
  warehouse: company("parts"),
  warehouseTransfer: company("inventory", { read: "inventory_view" }),
  warehouseTransferLine: company("inventory", { read: "inventory_view" }),
  webhook: company("settings", { read: "settings_view" }),
  webhookTable: policies({ select: authenticated }),
  workCenter: company("resources"),
  workCenterProcess: company("resources"),
  workCenterReplacementPart: company("resources", { read: "resources_view" }),
  workCenterShift: company("resources"),
  workflow: company("workflows", { read: "workflows_view" }),
  workflowRun: company("workflows", {
    read: "workflows_view",
    create: false,
    update: false,
    delete: false
  }),
  workflowStepRun: company("workflows", {
    read: "workflows_view",
    create: false,
    update: false,
    delete: false
  }),
  workflowTriggerEvent: company("workflows", {
    read: "workflows_view",
    create: "workflows_update",
    update: false,
    delete: "workflows_update"
  }),
  workflowVersion: company("workflows", { read: "workflows_view" })
} satisfies Manifest;
