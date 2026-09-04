import type { Database } from "@carbon/database";
import z from "zod";
import type {
  AccountingEntity,
  AccountingEntityType,
  EntityDefinition,
  GlobalSyncConfig
} from "./types";

function withNullable<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === undefined ? null : v), schema.nullish());
}

export enum ProviderID {
  XERO = "xero",
  QUICKBOOKS = "quickbooks",
  RILLET = "rillet"
  // SAGE = "sage",
}

/**
 * Schemas for shared provider entities and credentials.
 */

export const ProviderCredentialsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("oauth2"),
    accessToken: z.string(),
    refreshToken: z.string().optional(),
    expiresAt: z.string().datetime().optional(),
    scope: z.array(z.string()).optional(),
    providerMetadata: z.record(z.string(), z.unknown()).optional() // xero: { tenantId, tenantName }; qbo: { realmId }
  }),
  z.object({
    type: z.literal("apiKey"),
    apiKey: z.string().min(1),
    /** Which host the key belongs to — API keys are environment-specific. */
    environment: z.enum(["production", "sandbox"]).default("production"),
    // rillet: { subsidiaryId?, webhookToken? }
    providerMetadata: z.record(z.string(), z.unknown()).optional()
  }),
  z.object({
    type: z.literal("bridge"),
    vendor: z.string(), // e.g. "conductor"
    externalConnectionId: z.string() // e.g. Conductor end-user id
  })
]);

/**
 * Legacy stored oauth2 credentials kept provider-specific fields
 * (`tenantId`/`tenantName`) at the top level. Fold them into
 * `providerMetadata` before parsing — zod strips unknown keys, so parsing
 * the flat shape directly against the union would silently drop the tenant.
 */
function normalizeStoredCredentials(raw: unknown): unknown {
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as Record<string, unknown>).type !== "oauth2" ||
    (!("tenantId" in raw) && !("tenantName" in raw))
  ) {
    return raw;
  }

  const { tenantId, tenantName, providerMetadata, ...rest } = raw as Record<
    string,
    unknown
  >;

  return {
    ...rest,
    providerMetadata: {
      ...(tenantId !== undefined ? { tenantId } : {}),
      ...(tenantName !== undefined ? { tenantName } : {}),
      ...(typeof providerMetadata === "object" && providerMetadata !== null
        ? providerMetadata
        : {})
    }
  };
}

/**
 * Credentials as they are stored on `companyIntegration.metadata` — reads the
 * new discriminated union, transparently upgrading the legacy flat oauth2
 * shape. Writes always use the new shape.
 */
export const StoredProviderCredentialsSchema = z.preprocess(
  normalizeStoredCredentials,
  ProviderCredentialsSchema
);

/**
 * Parse credentials read from storage. Accepts the new union and the legacy
 * flat oauth2 shape (mapped into `providerMetadata`). Throws if neither
 * parses.
 */
export function parseStoredCredentials(
  raw: unknown
): z.output<typeof ProviderCredentialsSchema> {
  return StoredProviderCredentialsSchema.parse(raw);
}

/**
 * Direction of data flow.
 */
export const SyncDirectionSchema = z.enum([
  "two-way",
  "push-to-accounting",
  "pull-from-accounting"
]);

export const AccountingSyncSchema = z.object({
  companyId: z.string(),
  provider: z.nativeEnum(ProviderID),
  syncType: z.enum(["webhook", "scheduled", "trigger"]),
  syncDirection: SyncDirectionSchema,
  entities: z.array(z.custom<AccountingEntity>()),
  metadata: z.record(z.any()).optional()
});

export const ENTITY_DEFINITIONS: Record<
  AccountingEntityType,
  EntityDefinition
> = {
  customer: {
    label: "Customers",
    type: "master",
    supportedDirections: [
      "two-way",
      "push-to-accounting",
      "pull-from-accounting"
    ]
  },
  vendor: {
    label: "Vendors",
    type: "master",
    supportedDirections: [
      "two-way",
      "push-to-accounting",
      "pull-from-accounting"
    ]
  },
  item: {
    label: "Items / Products",
    type: "master",
    supportedDirections: ["two-way", "push-to-accounting"]
  },
  employee: {
    label: "Employees",
    type: "master",
    supportedDirections: ["two-way", "push-to-accounting"]
  },
  purchaseOrder: {
    label: "Purchase Orders",
    type: "transaction",
    dependsOn: ["vendor", "item"],
    supportedDirections: ["push-to-accounting"]
  },
  bill: {
    label: "Bills (Purchase Invoices)",
    type: "transaction",
    dependsOn: ["vendor", "item"],
    supportedDirections: ["two-way", "push-to-accounting"]
  },
  salesOrder: {
    label: "Sales Orders",
    type: "transaction",
    dependsOn: ["customer", "item"],
    supportedDirections: ["push-to-accounting"]
  },
  invoice: {
    label: "Sales Invoices",
    type: "transaction",
    dependsOn: ["customer", "item"],
    supportedDirections: ["two-way", "push-to-accounting"]
  },
  payment: {
    label: "Payments",
    type: "transaction",
    dependsOn: ["invoice", "bill"],
    // Two-way: provider-recorded payments pull back (Phase F), and Carbon-born
    // Posted payments push out as provider payment documents (Phase G). Routing
    // is per-record by origin (the payment mapping), not a static direction.
    supportedDirections: [
      "two-way",
      "pull-from-accounting",
      "push-to-accounting"
    ]
  },
  inventoryAdjustment: {
    label: "Inventory Adjustments",
    type: "transaction",
    dependsOn: ["item"],
    supportedDirections: ["push-to-accounting"]
  },
  journalEntry: {
    label: "Journal Entries",
    type: "transaction",
    supportedDirections: ["push-to-accounting"]
  }
};

/**
 * Default Safe Configuration
 */
export const DEFAULT_SYNC_CONFIG: GlobalSyncConfig = {
  entities: {
    customer: {
      enabled: true,
      direction: "two-way",
      owner: "accounting"
    },
    vendor: { enabled: true, direction: "two-way", owner: "accounting" },
    item: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    employee: {
      enabled: false, // https://developer.xero.com/documentation/api/accounting/employees
      direction: "two-way",
      owner: "carbon"
    },
    purchaseOrder: {
      enabled: true,
      direction: "push-to-accounting",
      owner: "carbon"
    },
    bill: { enabled: true, direction: "two-way", owner: "accounting" },
    salesOrder: {
      enabled: false,
      direction: "push-to-accounting",
      owner: "carbon"
    },
    invoice: { enabled: true, direction: "two-way", owner: "accounting" },
    payment: {
      enabled: false,
      direction: "pull-from-accounting",
      owner: "accounting"
    },
    inventoryAdjustment: {
      enabled: false,
      direction: "push-to-accounting",
      owner: "carbon"
    },
    journalEntry: {
      // Always-on: automated postings ARE the sync (the always-on model) —
      // connecting an accounting integration means Carbon's automated GL
      // postings mirror to it. Manual journals are excluded by POSTING_POLICY
      // (syncable: false), not by this flag.
      enabled: true,
      direction: "push-to-accounting",
      owner: "carbon"
    }
  }
};

// /********************************************************\
// *              Posting Sync (journalEntry)               *
// \********************************************************/

export type JournalEntrySourceType =
  Database["public"]["Enums"]["journalEntrySourceType"];

/** How a source type CAN be represented in the provider (structural). */
export type JournalRepresentation = "journal" | "document";

export type PostingGranularity = "individual" | "daily-summary";

/**
 * Which per-company family setting decides a document-represented type:
 * AR (invoice-side), AP (bill-side), or resolved per journal from its
 * control-account lines (Payment spans both sides).
 */
export type PostingSourceFamily = "ar" | "ap" | "per-line";

export type PostingPolicyEntry = {
  representation: JournalRepresentation;
  /** Only document-represented types carry a family. */
  family?: PostingSourceFamily;
  /**
   * For document-represented types: the entity whose DOCUMENT sync carries
   * the journal's amounts into the provider ("invoice" | "bill" | "payment"),
   * or null when no document representation exists yet (memos/returns) —
   * those park loudly in documents mode instead of excluding silently.
   */
  backingEntityType?: "invoice" | "bill" | "payment" | null;
  /**
   * `false` ONLY for `Manual` — manual journals are NEVER synced in any engine.
   * They can touch arbitrary/unmapped accounts, and the external ledger owns
   * manual journals (payroll, etc.); Carbon syncs only its automated postings.
   * Omitted ⇒ syncable (every automated posting type).
   */
  syncable?: boolean;
  defaultEnabled: boolean;
  defaultGranularity: PostingGranularity;
};

/**
 * The total posting policy: EVERY "journalEntrySourceType" enum value has a
 * row (Record<> makes omission a compile error — adding an enum value
 * without deciding its policy breaks typecheck, not production).
 * Spec: .ai/specs/2026-08-02-accounting-sync-engine-v3.md §2.
 */
export const POSTING_POLICY: Record<
  JournalEntrySourceType,
  PostingPolicyEntry
> = {
  Manual: {
    representation: "journal",
    syncable: false,
    defaultEnabled: false,
    defaultGranularity: "individual"
  },
  // Opening balances are a one-time setup artifact that touches arbitrary
  // accounts; the external ledger owns its own opening balances (connecting a
  // provider brings theirs), so Carbon's opening-balance journal NEVER syncs —
  // same policy as Manual, to avoid double-counting.
  "Opening Balance": {
    representation: "journal",
    syncable: false,
    defaultEnabled: false,
    defaultGranularity: "individual"
  },
  "Purchase Receipt": {
    representation: "journal",
    defaultEnabled: true,
    defaultGranularity: "individual"
  },
  "Transfer Receipt": {
    representation: "journal",
    defaultEnabled: true,
    defaultGranularity: "individual"
  },
  "Sales Shipment": {
    representation: "journal",
    defaultEnabled: true,
    defaultGranularity: "individual"
  },
  "Inventory Adjustment": {
    representation: "journal",
    defaultEnabled: true,
    defaultGranularity: "individual"
  },
  "Production Order": {
    representation: "journal",
    defaultEnabled: true,
    defaultGranularity: "individual"
  },
  "Production Event": {
    representation: "journal",
    defaultEnabled: true,
    defaultGranularity: "daily-summary"
  },
  "Job Consumption": {
    representation: "journal",
    defaultEnabled: true,
    defaultGranularity: "daily-summary"
  },
  "Job Receipt": {
    representation: "journal",
    defaultEnabled: true,
    defaultGranularity: "individual"
  },
  "Job Close": {
    representation: "journal",
    defaultEnabled: true,
    defaultGranularity: "individual"
  },
  "Asset Depreciation": {
    representation: "journal",
    defaultEnabled: true,
    defaultGranularity: "individual"
  },
  "Asset Disposal": {
    representation: "journal",
    defaultEnabled: true,
    defaultGranularity: "individual"
  },
  "Non-Conformance": {
    representation: "journal",
    defaultEnabled: true,
    defaultGranularity: "individual"
  },
  "Inbound Inspection": {
    representation: "journal",
    defaultEnabled: true,
    defaultGranularity: "individual"
  },
  "Sales Invoice": {
    representation: "document",
    family: "ar",
    backingEntityType: "invoice",
    defaultEnabled: false,
    defaultGranularity: "individual"
  },
  "Credit Memo": {
    representation: "document",
    family: "ar",
    backingEntityType: null,
    defaultEnabled: false,
    defaultGranularity: "individual"
  },
  "Sales Return": {
    representation: "document",
    family: "ar",
    backingEntityType: null,
    defaultEnabled: false,
    defaultGranularity: "individual"
  },
  "Purchase Invoice": {
    representation: "document",
    family: "ap",
    backingEntityType: "bill",
    defaultEnabled: false,
    defaultGranularity: "individual"
  },
  "Debit Memo": {
    representation: "document",
    family: "ap",
    backingEntityType: null,
    defaultEnabled: false,
    defaultGranularity: "individual"
  },
  "Purchase Return": {
    representation: "document",
    family: "ap",
    backingEntityType: null,
    defaultEnabled: false,
    defaultGranularity: "individual"
  },
  Payment: {
    representation: "document",
    family: "per-line",
    backingEntityType: "payment",
    defaultEnabled: false,
    defaultGranularity: "individual"
  }
};

export const JOURNAL_ENTRY_SOURCE_TYPES = Object.keys(
  POSTING_POLICY
) as JournalEntrySourceType[];

/**
 * Machine reasons recorded on terminal `Excluded` operations — the policy
 * decided a posted journal is not pushed as a journal, and why.
 */
export const POSTING_DECISION_REASON_CODES = [
  "DOC_BACKED",
  "FAMILY_OFF",
  "SOURCE_TYPE_DISABLED",
  "MANUAL_DISABLED"
] as const;

export type PostingDecisionReasonCode =
  (typeof POSTING_DECISION_REASON_CODES)[number];

/**
 * @deprecated Derived from POSTING_POLICY (journal-represented types enabled
 * by default). Read the policy directly for new code.
 */
export const POSTING_SYNC_DEFAULT_SOURCE_TYPES =
  JOURNAL_ENTRY_SOURCE_TYPES.filter(
    (sourceType) =>
      POSTING_POLICY[sourceType].representation === "journal" &&
      POSTING_POLICY[sourceType].defaultEnabled
  );

/**
 * @deprecated Derived from POSTING_POLICY (document-represented types).
 * Whether a document-represented journal is DOC_BACKED, parked, or pushed
 * now depends on the company's family representation setting — read the
 * policy + settings through getJournalPostingPolicyDecision instead.
 */
export const POSTING_SYNC_EXCLUDED_SOURCE_TYPES =
  JOURNAL_ENTRY_SOURCE_TYPES.filter(
    (sourceType) => POSTING_POLICY[sourceType].representation === "document"
  );

export const PostingSyncFamilyModeSchema = z.enum([
  "documents",
  "journals",
  "none"
]);

export type PostingSyncFamilyMode = z.infer<typeof PostingSyncFamilyModeSchema>;

export const PostingSyncGranularitySchema = z.enum([
  "individual",
  "daily-summary"
]);

export const PostingSyncDimensionSlotSchema = z.object({
  dimensionId: z.string(),
  /** Provider-specific target id (e.g. "class", "tracking:<id>", "field:<id>"). */
  target: z.string(),
  /**
   * Create missing provider options by name at push time. Optional so a
   * stored slot without the flag resolves to the PROVIDER default at the
   * point of use (Rillet: on — Field-value upsert is the expected flow;
   * QBO/Xero: off — opt-in avoids surprise writes to their lists). See
   * resolveDimensionSlotAutoCreate (core/dimension-mapping.ts).
   */
  autoCreate: z.boolean().optional()
});

export type PostingSyncDimensionSlot = z.infer<
  typeof PostingSyncDimensionSlotSchema
>;

const PostingSyncSourceTypeConfigSchema = z.object({
  enabled: z.boolean(),
  granularity: PostingSyncGranularitySchema
});

/**
 * Upgrade a stored v2 posting-sync fragment (flat `sourceTypes: string[]`,
 * global `consolidation`, `includeManual`) to the v3 per-source-type shape.
 * Behavior parity: the v2 enabled set carries over exactly, the global
 * consolidation becomes every type's granularity, and `includeManual` maps
 * to `sourceTypes.Manual.enabled`. v3 fragments pass through untouched.
 * Write-back in the new shape happens on the next settings save.
 */
function normalizeStoredPostingSyncSettings(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const record = raw as Record<string, unknown>;

  const isV2 =
    Array.isArray(record.sourceTypes) ||
    "consolidation" in record ||
    "includeManual" in record;
  if (!isV2) return raw;

  const enabledList = Array.isArray(record.sourceTypes)
    ? record.sourceTypes.filter((v): v is string => typeof v === "string")
    : (POSTING_SYNC_DEFAULT_SOURCE_TYPES as readonly string[]);
  const granularity =
    record.consolidation === "daily" ? "daily-summary" : "individual";

  const sourceTypes: Record<string, { enabled: boolean; granularity: string }> =
    {};
  for (const sourceType of JOURNAL_ENTRY_SOURCE_TYPES) {
    const policy = POSTING_POLICY[sourceType];
    const enabled =
      sourceType === "Manual"
        ? record.includeManual === true
        : policy.representation === "journal" &&
          enabledList.includes(sourceType);
    sourceTypes[sourceType] = { enabled, granularity };
  }

  const {
    consolidation: _consolidation,
    includeManual: _includeManual,
    sourceTypes: _sourceTypes,
    ...rest
  } = record;
  return { ...rest, sourceTypes };
}

const PostingSyncStoredSchema = z.object({
  /**
   * Kept for backward-compatible parsing of stored fragments ONLY (D2:
   * keep-but-ignore). The decision core no longer reads it — posting sync is
   * always-on when an accounting integration is connected.
   */
  enabled: z.boolean().default(true),
  syncFromDate: z.string().optional(),
  /**
   * AR/AP family representation (spec §2): documents (default — native
   * provider documents; journals are DOC_BACKED), journals (documents NOT
   * pushed; the journals push, forced individual), none (explicit opt-out —
   * journals record FAMILY_OFF). Explicit, never derived from entity sync
   * toggles.
   */
  families: z
    .object({
      ar: PostingSyncFamilyModeSchema.default("documents"),
      ap: PostingSyncFamilyModeSchema.default("documents")
    })
    .default({ ar: "documents", ap: "documents" }),
  /** Partial per-source-type overrides; missing entries fill from POSTING_POLICY. */
  sourceTypes: z
    .record(z.string(), PostingSyncSourceTypeConfigSchema)
    .default({}),
  /** Dimension slot config (Phase 2) — empty until dimension sync ships. */
  dimensionSlots: z.array(PostingSyncDimensionSlotSchema).default([]),
  onUnmappedDimensionValue: z.enum(["warn", "drop"]).default("warn"),
  /** park = journals dated in a locked period land Warning; redate = push at lock date + 1 with the original date in the narration. */
  periodLockPolicy: z.enum(["park", "redate"]).default("park"),
  /** Manually captured provider lock date (YYYY-MM-DD) — required for providers whose API cannot report it (QBO); merged with the provider-reported lock date when both exist. */
  lockDate: z.string().optional()
});

/**
 * Per-company posting-sync settings fragment stored at
 * `companyIntegration.metadata.settings.postingSync`. Resolved with
 * `resolvePostingSyncSettings` (core/posting.ts) — never parsed directly
 * from storage, and a bad stored fragment must never break sync. Reads the
 * v3 shape, transparently upgrading stored v2 fragments (see
 * normalizeStoredPostingSyncSettings). The output's `sourceTypes` is TOTAL
 * over the enum (missing entries filled from POSTING_POLICY).
 *
 * `consolidation` in the output is a transitional derived field for the
 * drain/cron hold: "daily" only when every enabled journal-represented type
 * is daily-summary (pure v2-daily shims). Removed once the per-granularity
 * claim filter lands (plan task 1.5).
 */
export const PostingSyncSettingsSchema = z.preprocess(
  normalizeStoredPostingSyncSettings,
  PostingSyncStoredSchema.transform((value) => {
    const sourceTypes = {} as Record<
      JournalEntrySourceType,
      z.infer<typeof PostingSyncSourceTypeConfigSchema>
    >;
    for (const sourceType of JOURNAL_ENTRY_SOURCE_TYPES) {
      sourceTypes[sourceType] = value.sourceTypes[sourceType] ?? {
        enabled: POSTING_POLICY[sourceType].defaultEnabled,
        granularity: POSTING_POLICY[sourceType].defaultGranularity
      };
    }

    // Always-on: the set of syncing journal types is defined by POSTING_POLICY
    // (journal-represented, non-Manual), never by stored per-type enables.
    const enabledJournalTypes = JOURNAL_ENTRY_SOURCE_TYPES.filter(
      (sourceType) =>
        POSTING_POLICY[sourceType].representation === "journal" &&
        POSTING_POLICY[sourceType].syncable !== false
    );
    const consolidation: "individual" | "daily" =
      enabledJournalTypes.length > 0 &&
      enabledJournalTypes.every(
        (sourceType) => sourceTypes[sourceType].granularity === "daily-summary"
      )
        ? "daily"
        : "individual";

    return { ...value, sourceTypes, consolidation };
  })
);

// ============================================================================
// 4. VALIDATION LOGIC
// ============================================================================

export function validateSyncConfig(config: GlobalSyncConfig): string[] {
  const errors: string[] = [];

  // 1. Validate Dependencies (Always Enforced)
  (Object.keys(config.entities) as AccountingEntityType[]).forEach((entity) => {
    const entityConfig = config.entities[entity];
    const definition = ENTITY_DEFINITIONS[entity];

    if (entityConfig.enabled && definition.dependsOn) {
      definition.dependsOn.forEach((dependency) => {
        if (!config.entities[dependency].enabled) {
          errors.push(
            `Cannot enable '${definition.label}': Missing dependency '${ENTITY_DEFINITIONS[dependency].label}'.`
          );
        }
      });
    }
  });

  // 2. Validate Directions
  (Object.keys(config.entities) as AccountingEntityType[]).forEach((entity) => {
    const entityConfig = config.entities[entity];
    const definition = ENTITY_DEFINITIONS[entity];

    if (
      entityConfig.enabled &&
      !definition.supportedDirections.includes(entityConfig.direction)
    ) {
      errors.push(
        `Entity '${definition.label}' does not support direction '${
          entityConfig.direction
        }'. Supported: ${definition.supportedDirections.join(", ")}`
      );
    }
  });

  return errors;
}

const createEntityConfigSchema = () =>
  z.object({
    enabled: z.boolean().optional().default(true),
    direction: SyncDirectionSchema.optional().default("two-way"),
    owner: z.enum(["carbon", "accounting"]).optional().default("accounting"),
    syncFromDate: z.string().datetime().optional()
  });

export const SyncConfigSchema = z
  .object({
    entities: z
      .object({
        customer: createEntityConfigSchema().optional(),
        vendor: createEntityConfigSchema().optional(),
        item: createEntityConfigSchema().optional(),
        employee: createEntityConfigSchema().optional(),
        purchaseOrder: createEntityConfigSchema().optional(),
        bill: createEntityConfigSchema().optional(),
        salesOrder: createEntityConfigSchema().optional(),
        invoice: createEntityConfigSchema().optional(),
        payment: createEntityConfigSchema().optional(),
        inventoryAdjustment: createEntityConfigSchema().optional(),
        journalEntry: createEntityConfigSchema().optional()
      })
      .optional()
  })
  .optional();

export const ProviderIntegrationMetadataSchema = z.object({
  syncConfig: SyncConfigSchema.optional(),
  credentials: StoredProviderCredentialsSchema.optional(),
  // Per-company integration settings (e.g. settings.postingSync). Kept as a
  // permissive record so parsing never strips or rewrites stored keys —
  // fragments are validated where they are consumed (resolvePostingSyncSettings)
  settings: z.record(z.string(), z.unknown()).optional(),
  // Integration-specific settings (e.g., default account codes for Xero)
  // These are stored at the top level of metadata and passed through to the provider
  defaultSalesAccountCode: z.string().optional(),
  defaultPurchaseAccountCode: z.string().optional()
});

// /********************************************************\
// *              Sync Operation Schemas                    *
// \********************************************************/

/**
 * Status lifecycle of a sync operation (matches the "syncOperationStatus"
 * Postgres enum): Pending → In Flight → Completed | Failed | Warning |
 * Skipped | Excluded. `Excluded` is a terminal disposition decided by the
 * posting policy (doc-backed, family off, source type disabled) — recorded
 * so completeness is a query; `Skipped` remains the human opt-out.
 */
export const SyncOperationStatusSchema = z.enum([
  "Pending",
  "In Flight",
  "Completed",
  "Failed",
  "Warning",
  "Skipped",
  "Excluded"
]);

export const SyncOperationDirectionSchema = z.enum([
  "push-to-accounting",
  "pull-from-accounting"
]);

export const SyncOperationTriggerSchema = z.enum([
  "event",
  "webhook",
  "backfill",
  "manual",
  "posting",
  "retry",
  // v5: state-derived reconcile decisions (never cooldown-gated)
  "reconcile"
]);

/**
 * A row of the "accountingSyncOperation" ledger: one attempted sync of one
 * entity in one direction.
 */
export const SyncOperationSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  integration: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  direction: SyncOperationDirectionSchema,
  trigger: SyncOperationTriggerSchema,
  status: SyncOperationStatusSchema,
  idempotencyKey: z.string(),
  attemptCount: z.number().int(),
  lastAttemptAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  externalId: z.string().nullable(),
  metadata: z.record(z.any()).nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string().nullable()
});

/**
 * UI-driven status transitions: Retry (Failed/Warning/Skipped → Pending
 * — Skipped covers both a human opt-out and the drain's machine no-op
 * close, either of which a user may re-drive), Skip (Failed/Warning/
 * Pending → Skipped), Re-send (Completed/Excluded → Pending — an
 * Excluded journal re-decides against the current policy config).
 * Everything else is invalid.
 */
export const SYNC_OPERATION_ALLOWED_TRANSITIONS: Record<
  z.infer<typeof SyncOperationStatusSchema>,
  ReadonlyArray<z.infer<typeof SyncOperationStatusSchema>>
> = {
  Pending: ["Skipped"],
  "In Flight": [],
  Completed: ["Pending"],
  Failed: ["Pending", "Skipped"],
  Warning: ["Pending", "Skipped"],
  Skipped: ["Pending"],
  Excluded: ["Pending"]
};

export const SyncOperationTransitionSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  to: SyncOperationStatusSchema,
  userId: z.string()
});

// /********************************************************\
// *               Account Mapping Schemas                  *
// \********************************************************/

/**
 * An account in the provider's chart of accounts as fetched from the
 * provider API (e.g. Xero GET /Accounts). `code` is the provider-side
 * account code that matchAccountsByCode compares against Carbon
 * `account.number`.
 */
export const ProviderChartAccountSchema = z.object({
  id: z.string(),
  code: z.string().nullish(),
  name: z.string().nullish()
});

/**
 * Payload for upserting an account mapping (Carbon account.id → provider
 * account id). externalCode/externalName are stored in the mapping
 * metadata for display only — the mapping itself is by id on both sides.
 */
export const UpsertAccountMappingSchema = z.object({
  companyId: z.string(),
  integration: z.string(),
  accountId: z.string(),
  externalId: z.string(),
  externalCode: z.string().optional(),
  externalName: z.string().optional(),
  userId: z.string()
});

// /********************************************************\
// *               Accounting Entity Schemas                *
// \********************************************************/

export const ContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  companyId: z.string(),
  email: z.string().optional(),
  website: withNullable(z.string().url()),
  taxId: withNullable(z.string()),
  currencyCode: z.string().default("USD"),
  balance: z.number().nullish(),
  creditLimit: z.number().nullish(),
  paymentTerms: z.string().nullish(),
  updatedAt: z.string().datetime(),
  workPhone: withNullable(z.string()),
  mobilePhone: withNullable(z.string()),
  fax: withNullable(z.string()),
  homePhone: withNullable(z.string()),
  isVendor: z.boolean(),
  isCustomer: z.boolean(),
  addresses: z.array(
    z.object({
      label: z.string().nullish(),
      type: z.string().nullish(),
      line1: z.string().nullish(),
      line2: z.string().nullish(),
      city: z.string().nullish(),
      country: z.string().nullish(),
      region: z.string().nullish(),
      postalCode: z.string().nullish()
    })
  ),
  raw: z.record(z.any())
});

export const EmployeeSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  fullName: withNullable(z.string()),
  email: withNullable(z.string().email()),
  active: z.boolean().default(true),
  // Job-related fields from employeeJob
  title: withNullable(z.string()),
  departmentId: withNullable(z.string()),
  locationId: withNullable(z.string()),
  managerId: withNullable(z.string()),
  startDate: withNullable(z.string()),
  // External link (used by Xero)
  externalLink: z
    .object({
      url: withNullable(z.string().url()),
      description: withNullable(z.string())
    })
    .optional(),
  updatedAt: z.string().datetime(),
  raw: z.record(z.any()).optional()
});

// ============================================================================
// SALES ORDER (push-only to accounting as Xero Quotes)
// ============================================================================

export const SalesOrderLineSchema = z.object({
  id: z.string(),
  salesOrderLineType: z.string(),
  itemId: withNullable(z.string()),
  itemCode: withNullable(z.string()), // item.readableIdWithRevision
  description: withNullable(z.string()),
  quantity: z.number(),
  unitPrice: z.number(),
  setupPrice: z.number(),
  accountNumber: withNullable(z.string()),
  lineAmount: z.number()
});

export const SalesOrderSchema = z.object({
  id: z.string(),
  salesOrderId: z.string(), // Human-readable SO number
  companyId: z.string(),
  customerId: z.string(),
  customerExternalId: withNullable(z.string()), // Xero ContactID for the customer
  status: z.enum([
    "Draft",
    "Needs Approval",
    "Confirmed",
    "In Progress",
    "To Ship and Invoice",
    "To Ship",
    "To Invoice",
    "Completed",
    "Invoiced",
    "Cancelled",
    "Closed"
  ]),
  orderDate: withNullable(z.string()),
  currencyCode: z.string(),
  exchangeRate: z.number(),
  customerReference: withNullable(z.string()),
  lines: z.array(SalesOrderLineSchema),
  updatedAt: z.string().datetime(),
  raw: z.record(z.any()).optional()
});

// Sales Invoice schemas
export const SalesInvoiceLineSchema = z.object({
  id: z.string(),
  invoiceLineType: z.string(),
  itemId: withNullable(z.string()),
  itemCode: withNullable(z.string()), // readableIdWithRevision
  description: withNullable(z.string()),
  quantity: z.number(),
  // BASE currency, matching the stored column.
  unitPrice: z.number(),
  // The document-currency mirror (unitPrice * exchangeRate). Optional because
  // not every provider selects it; push this to any payload that declares a
  // currency code, since unitPrice above is base.
  convertedUnitPrice: withNullable(z.number()).optional(),
  taxPercent: z.number(),
  lineAmount: z.number()
});

export const SalesInvoiceSchema = z.object({
  id: z.string(),
  invoiceId: z.string(), // readable ID like "INV-0001"
  companyId: z.string(),
  customerId: z.string(),
  customerExternalId: withNullable(z.string()), // Xero ContactID for the customer
  status: z.enum([
    "Draft",
    "Pending",
    "Submitted",
    "Partially Paid",
    "Paid",
    "Overdue",
    "Voided",
    "Credit Note Issued",
    "Return"
  ]),
  currencyCode: z.string(),
  exchangeRate: z.number(),
  dateIssued: withNullable(z.string()),
  dateDue: withNullable(z.string()),
  datePaid: withNullable(z.string()),
  customerReference: withNullable(z.string()),
  subtotal: z.number(),
  totalTax: z.number(),
  totalDiscount: z.number(),
  totalAmount: z.number(),
  balance: z.number(),
  lines: z.array(SalesInvoiceLineSchema),
  updatedAt: z.string().datetime(),
  raw: z.record(z.any()).optional()
});

// Bill (Purchase Invoice) schemas
export const BillLineSchema = z.object({
  id: z.string(),
  description: withNullable(z.string()),
  quantity: z.number(),
  unitPrice: z.number(),
  itemId: withNullable(z.string()),
  itemCode: withNullable(z.string()),
  /** Carbon account.id FK — needed by providers that resolve G/L lines through the account-mapping service (QBO AccountRef). */
  accountId: withNullable(z.string()),
  accountNumber: withNullable(z.string()),
  taxPercent: withNullable(z.number()),
  taxAmount: withNullable(z.number()),
  totalAmount: z.number(),
  purchaseOrderLineId: withNullable(z.string())
});

export const BillSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  invoiceId: z.string(), // Human-readable invoice number
  supplierId: withNullable(z.string()),
  supplierExternalId: withNullable(z.string()), // Xero ContactID for the supplier
  status: z.enum([
    "Draft",
    "Pending",
    "Open",
    "Return",
    "Debit Note Issued",
    "Paid",
    "Partially Paid",
    "Overdue",
    "Voided"
  ]),
  dateIssued: withNullable(z.string()),
  dateDue: withNullable(z.string()),
  datePaid: withNullable(z.string()),
  currencyCode: z.string(),
  exchangeRate: z.number(),
  subtotal: z.number(),
  totalTax: z.number(),
  totalDiscount: z.number(),
  totalAmount: z.number(),
  balance: z.number(),
  supplierReference: withNullable(z.string()),
  lines: z.array(BillLineSchema),
  updatedAt: z.string().datetime(),
  raw: z.record(z.any()).optional()
});

// Purchase Order schemas
export const PurchaseOrderLineSchema = z.object({
  id: z.string(),
  description: withNullable(z.string()),
  quantity: z.number(),
  unitPrice: z.number(),
  itemId: withNullable(z.string()),
  itemCode: withNullable(z.string()),
  /** Carbon account.id FK — needed by providers that resolve G/L lines through the account-mapping service (QBO AccountRef). */
  accountId: withNullable(z.string()),
  accountNumber: withNullable(z.string()),
  taxPercent: withNullable(z.number()),
  taxAmount: withNullable(z.number()),
  totalAmount: z.number(),
  quantityReceived: withNullable(z.number()),
  quantityInvoiced: withNullable(z.number())
});

export const PurchaseOrderSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  purchaseOrderId: z.string(), // Human-readable PO number
  supplierId: z.string(),
  supplierExternalId: withNullable(z.string()), // Xero ContactID for the supplier
  status: z.enum([
    "Draft",
    "Needs Approval",
    "To Review",
    "Rejected",
    "To Receive",
    "To Receive and Invoice",
    "To Invoice",
    "Completed",
    "Closed",
    "Planned"
  ]),
  orderDate: withNullable(z.string()),
  deliveryDate: withNullable(z.string()),
  deliveryAddress: withNullable(z.string()),
  deliveryInstructions: withNullable(z.string()),
  currencyCode: withNullable(z.string()),
  exchangeRate: withNullable(z.number()),
  subtotal: z.number(),
  totalTax: z.number(),
  totalAmount: z.number(),
  supplierReference: withNullable(z.string()),
  lines: z.array(PurchaseOrderLineSchema),
  updatedAt: z.string().datetime(),
  raw: z.record(z.any()).optional()
});

// ============================================================================
// ITEM (Carbon item synced to accounting system)
// ============================================================================

export const ItemSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: withNullable(z.string()),
  companyId: z.string(),
  // Mirrors the "itemType" Postgres enum. "Service" distinguishes service
  // items for providers whose item objects are typed (QBO Service vs
  // NonInventory).
  type: z.enum([
    "Part",
    "Material",
    "Tool",
    "Service",
    "Consumable",
    "Fixture"
  ]),
  unitOfMeasureCode: withNullable(z.string()),
  unitCost: z.number(),
  unitSalePrice: z.number(),
  isPurchased: z.boolean(),
  isSold: z.boolean(),
  isTrackedAsInventory: z.boolean(),
  updatedAt: z.string(),
  raw: z.record(z.any()).optional()
});

// ============================================================================
// INVENTORY ADJUSTMENT (itemLedger-based, push-only to accounting)
// ============================================================================

export const InventoryAdjustmentSchema = z.object({
  id: z.string(),
  entryNumber: z.number(),
  postingDate: z.string(),
  entryType: z.enum(["Positive Adjmt.", "Negative Adjmt."]),
  itemId: z.string(),
  locationId: withNullable(z.string()),
  quantity: z.number(), // positive for positive adj, negative for negative adj
  companyId: z.string(),
  unitCost: z.number(), // from itemCost table
  inventoryAccount: z.string(), // resolved GL account from accountDefault (rawMaterialsAccount for Buy items, finishedGoodsAccount for Make / Buy and Make)
  adjustmentVarianceAccount: z.string(), // GL account code from accountDefault
  updatedAt: z.string().datetime(),
  raw: z.record(z.any()).optional()
});

// ============================================================================
// JOURNAL ENTRY (posting sync — journal + journalLine, push-only)
// ============================================================================

/**
 * One analytical dimension stamped on a journal line
 * (`journalLineDimension` row). `valueId` is Carbon's INTERNAL id and is
 * polymorphic across entity-typed dimensions (location.id, supplier.id,
 * item.id, dimensionValue.id, …) — what crosses the wire to a provider is
 * always the RESOLVED provider option id from the dimension value mapping
 * (entityType "dimensionValue"), never this id.
 */
export const JournalEntryLineDimensionSchema = z.object({
  dimensionId: z.string(),
  valueId: z.string()
});

export const JournalEntryLineSchema = z.object({
  id: z.string(),
  accountId: withNullable(z.string()),
  /** Signed: positive = debit, negative = credit. */
  amount: z.number(),
  description: withNullable(z.string()),
  /** Line dimensions (absent when the line carries none). */
  dimensions: z.array(JournalEntryLineDimensionSchema).optional()
});

export const JournalEntrySchema = z.object({
  /** journal.id (Carbon internal id). */
  id: z.string(),
  companyId: z.string(),
  /** Human-readable journal entry number (journal.journalEntryId). */
  journalEntryId: z.string(),
  description: withNullable(z.string()),
  postingDate: z.string(), // YYYY-MM-DD
  status: z.enum(["Draft", "Posted", "Reversed"]),
  sourceType: withNullable(z.string()), // journalEntrySourceType enum value
  reversalOfId: withNullable(z.string()),
  reversedById: withNullable(z.string()),
  /**
   * True when this fetch is a reversal push (entity id carried the
   * ":reversal" suffix): the syncer pushes negated line amounts for the
   * original journal instead of the journal itself.
   */
  reversal: z.boolean(),
  lines: z.array(JournalEntryLineSchema),
  updatedAt: z.string(),
  raw: z.record(z.any()).optional()
});
