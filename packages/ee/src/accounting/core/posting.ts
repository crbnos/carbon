import type z from "zod";
import {
  type JournalEntryLineDimensionSchema,
  type JournalEntrySourceType,
  POSTING_POLICY,
  type PostingDecisionReasonCode,
  type PostingGranularity,
  PostingSyncSettingsSchema
} from "./models";
import type { Accounting } from "./types";

export type JournalLineDimensionRef = z.infer<
  typeof JournalEntryLineDimensionSchema
>;

/**
 * Shared posting-sync helpers (Phase B journal push, reused by every
 * provider's JournalEntrySyncer): per-company settings resolution, the
 * machine-readable pre-flight failure envelope, and the pure pre-flight
 * rules (account mapping, AR/AP control accounts, period lock, balance).
 *
 * Everything here is provider-agnostic — provider-specific inputs (the
 * account-code map, the org lock date) are resolved by the syncer and
 * passed in.
 */

export type PostingSyncSettings = z.output<typeof PostingSyncSettingsSchema>;

export const DEFAULT_POSTING_SYNC_SETTINGS: PostingSyncSettings =
  PostingSyncSettingsSchema.parse({});

/**
 * Resolve the per-company posting-sync settings stored at
 * `companyIntegration.metadata.settings.postingSync`. Missing or invalid
 * fragments resolve to the defaults (posting sync disabled) with a warning
 * — a bad stored config must never break sync (same contract as
 * resolveSyncConfig).
 */
export function resolvePostingSyncSettings(
  metadata: unknown
): PostingSyncSettings {
  if (typeof metadata !== "object" || metadata === null) {
    return { ...DEFAULT_POSTING_SYNC_SETTINGS };
  }

  const settings = (metadata as { settings?: unknown }).settings;
  if (typeof settings !== "object" || settings === null) {
    return { ...DEFAULT_POSTING_SYNC_SETTINGS };
  }

  const fragment = (settings as { postingSync?: unknown }).postingSync;
  if (fragment === undefined) {
    return { ...DEFAULT_POSTING_SYNC_SETTINGS };
  }

  const parsed = PostingSyncSettingsSchema.safeParse(fragment);
  if (!parsed.success) {
    console.warn(
      "Ignoring invalid stored postingSync settings:",
      parsed.error.issues
    );
    return { ...DEFAULT_POSTING_SYNC_SETTINGS };
  }

  return parsed.data;
}

/**
 * Whether inbound payment sync-back is allowed for an AR/AP family: true
 * ONLY when that family is in `documents` mode. Payments settle the pushed
 * documents, so pulling provider payments back is coherent only when Carbon
 * owns the documents (documents mode). `journals`/`none` families do not pull
 * payments. A missing/invalid config resolves to the defaults (documents for
 * both families), so an unconfigured integration keeps sync-back ENABLED —
 * preserving today's Rillet AR behavior.
 */
export function isPaymentSyncbackEnabled(
  integrationMetadata: unknown,
  family: "ar" | "ap"
): boolean {
  return (
    resolvePostingSyncSettings(integrationMetadata).families[family] ===
    "documents"
  );
}

// /********************************************************\
// *              Posting policy decision (v3)              *
// \********************************************************/

/**
 * Whether each backing DOCUMENT entity sync is enabled in the company's
 * resolved sync config — decides delivery for document-represented source
 * types in `documents` family mode.
 */
export type PostingSyncDocumentSyncFlags = {
  invoiceEnabled: boolean;
  billEnabled: boolean;
};

export type JournalPostingPolicyDecision =
  | { kind: "push"; granularity: PostingGranularity }
  | {
      kind: "exclude";
      reason: PostingDecisionReasonCode;
      message: string;
      /** The synced entity that carries this journal's amounts (DOC_BACKED). */
      backingDocument?: { entityType: string };
    }
  | {
      kind: "warn";
      code:
        | "DOC_SYNC_DISABLED"
        | "DOUBLE_REPRESENTATION"
        | "PAYMENT_FAMILY_UNRESOLVED";
      message: string;
    };

/**
 * The v3 posting policy decision for one posted journal (spec §1–2): every
 * journal gets exactly one disposition. Pure — the caller resolves the
 * settings, the doc-sync flags, and (for Payment journals when the AR/AP
 * family modes diverge) which side the journal's control-account lines
 * touch.
 *
 * - journal-represented types: push per the per-source-type config
 *   (Manual → MANUAL_DISABLED when off; others → SOURCE_TYPE_DISABLED);
 * - "Inventory Adjustment" while the inventoryAdjustment ENTITY sync is
 *   enabled → DOC_BACKED (the entity syncer pushes the same economic event;
 *   pushing the journal too would double-post);
 * - document-represented types follow the family mode:
 *   `documents` → DOC_BACKED when the backing document actually syncs
 *   (invoice/bill enabled; Payment is provider-native cash application),
 *   `Warning/DOC_SYNC_DISABLED` when it does not (a silent delivery hole is
 *   the one outcome this system must not produce);
 *   `journals` → push (forced individual granularity), or
 *   `Warning/DOUBLE_REPRESENTATION` if the document sync is somehow also on;
 *   `none` → FAMILY_OFF (explicit, visible opt-out).
 */
export function getJournalPostingPolicyDecision(args: {
  sourceType: string | null | undefined;
  settings: PostingSyncSettings;
  docSync: PostingSyncDocumentSyncFlags;
  /**
   * "ar" | "ap" for Payment journals, resolved from which control account
   * the lines touch; null when unresolved. Ignored for static-family types.
   */
  paymentFamily?: "ar" | "ap" | null;
  inventoryAdjustmentEntitySyncEnabled?: boolean;
}): JournalPostingPolicyDecision {
  const { settings } = args;

  if (!args.sourceType) {
    return {
      kind: "exclude",
      reason: "SOURCE_TYPE_DISABLED",
      message:
        "Journal has no source type; only configured source types are pushed"
    };
  }

  const sourceType = args.sourceType as JournalEntrySourceType;
  const policy = POSTING_POLICY[sourceType];

  if (!policy) {
    return {
      kind: "exclude",
      reason: "SOURCE_TYPE_DISABLED",
      message: `Source type "${args.sourceType}" is not enabled for posting sync`
    };
  }

  if (
    sourceType === "Inventory Adjustment" &&
    args.inventoryAdjustmentEntitySyncEnabled
  ) {
    return {
      kind: "exclude",
      reason: "DOC_BACKED",
      message:
        'Source type "Inventory Adjustment" is excluded while inventory-adjustment entity sync is enabled (the entity syncer already pushes it; pushing the journal too would double-post)',
      backingDocument: { entityType: "inventoryAdjustment" }
    };
  }

  const config = settings.sourceTypes[sourceType];

  if (policy.representation === "journal") {
    // Manual journals are NEVER synced — the external ledger owns manual
    // journals (payroll, etc.) and they can touch arbitrary/unmapped accounts.
    // Every other automated journal-represented posting always pushes; there is
    // no per-source-type on/off (granularity remains configurable).
    if (policy.syncable === false) {
      return {
        kind: "exclude",
        reason: "MANUAL_DISABLED",
        message:
          "Manual journals are never synced — the external ledger owns manual journals; Carbon syncs only its automated postings"
      };
    }
    return { kind: "push", granularity: config.granularity };
  }

  // Document-represented: resolve the family, then the family mode.
  const family =
    policy.family === "per-line" ? (args.paymentFamily ?? null) : policy.family;

  if (!family) {
    // Payment with modes diverging and no resolvable side. Unreachable when
    // both families share a mode (callers may skip line inspection then).
    if (settings.families.ar === settings.families.ap) {
      return decideDocumentFamily({
        sourceType,
        policy,
        mode: settings.families.ar,
        docSync: args.docSync
      });
    }
    return {
      kind: "warn",
      code: "PAYMENT_FAMILY_UNRESOLVED",
      message: `Journal source type "Payment" could not be resolved to AR or AP from its control-account lines while the family modes diverge (ar: ${settings.families.ar}, ap: ${settings.families.ap}); resolve the payment's side or align the family modes, then retry.`
    };
  }

  return decideDocumentFamily({
    sourceType,
    policy,
    mode: settings.families[family],
    docSync: args.docSync
  });
}

function decideDocumentFamily(args: {
  sourceType: JournalEntrySourceType;
  policy: (typeof POSTING_POLICY)[JournalEntrySourceType];
  mode: PostingSyncSettings["families"]["ar"];
  docSync: PostingSyncDocumentSyncFlags;
}): JournalPostingPolicyDecision {
  const backingEntityType = args.policy.backingEntityType ?? null;
  const documentSyncEnabled =
    backingEntityType === "invoice"
      ? args.docSync.invoiceEnabled
      : backingEntityType === "bill"
        ? args.docSync.billEnabled
        : backingEntityType === "payment"
          ? true // cash application is provider-native, not a Carbon-pushed document
          : false; // memos/returns have no document representation yet

  if (args.mode === "none") {
    return {
      kind: "exclude",
      reason: "FAMILY_OFF",
      message: `Source type "${args.sourceType}" is excluded: its AR/AP family is set to "none" (this family is handled outside the sync).`
    };
  }

  if (args.mode === "journals") {
    if (backingEntityType && backingEntityType !== "payment") {
      // journals mode requires the family's document sync to be OFF; a
      // contradictory config must be loud, never a double-post.
      if (documentSyncEnabled) {
        return {
          kind: "warn",
          code: "DOUBLE_REPRESENTATION",
          message: `Source type "${args.sourceType}" is set to journal representation, but the ${backingEntityType} document sync is also enabled — pushing both would double-post. Disable the document sync or switch the family back to documents, then retry.`
        };
      }
    }
    // AR/AP journals are forced individual: provider constraints (QBO's one
    // AR/AP line per JE with a party ref) make cross-document summaries
    // structurally impossible.
    return { kind: "push", granularity: "individual" };
  }

  // documents mode
  if (!documentSyncEnabled) {
    const detail =
      backingEntityType === null
        ? `Source type "${args.sourceType}" has no document representation yet (credit/debit memos and returns are not pushed as provider documents), so its amounts have NOT reached the external GL. Switch the family to journal representation when available, or handle these in the provider.`
        : `Source type "${args.sourceType}" is document-represented, but the ${backingEntityType} document sync is disabled — its amounts would never reach the external GL. Enable the ${backingEntityType} sync (or switch the family representation), then retry.`;
    return { kind: "warn", code: "DOC_SYNC_DISABLED", message: detail };
  }

  return {
    kind: "exclude",
    reason: "DOC_BACKED",
    message: `Source type "${args.sourceType}" is document-backed and excluded from posting sync (the synced document already books it)`,
    ...(backingEntityType
      ? { backingDocument: { entityType: backingEntityType } }
      : {})
  };
}

/**
 * Backstop source-type gate used by the provider journal syncers at drain
 * time (the authoritative disposition is recorded at enqueue by
 * getJournalPostingPolicyDecision — this keeps a conservatively-excluding
 * second gate in front of any provider call). Returns a human-readable skip
 * reason, or null when the journal is pushable. The backstop lacks the
 * resolved sync config, so it assumes a SELF-CONSISTENT one (document sync
 * on exactly for documents-mode families) — contradictions are the enqueue
 * decision's job to surface; the backstop's job is never pushing a
 * doc-backed or family-off journal.
 */
/**
 * Convert a Carbon journalLine amount to the engine's debit-signed
 * convention (positive = debit, negative = credit).
 *
 * Carbon's post-* edge functions sign amounts by the account's NATURAL
 * balance (`credit("liability", x)` stores +x; `debit("liability", x)`
 * stores -x — see functions/lib/utils.ts), so a Carbon journal balances
 * as debits == credits, not as a signed sum of zero. The engine's
 * preflight, netting, consolidation and provider mappers all assume
 * debit-signed amounts, so every journal fetch converts at the edge using
 * the line's account class: Asset/Expense amounts keep their sign (natural
 * balance IS debit), Liability/Equity/Revenue amounts negate. A missing
 * class (no account on the line) passes through unchanged — those lines
 * already fail preflight as unmapped.
 */
/**
 * Normalize a journal.postingDate read through Kysely to YYYY-MM-DD. The
 * pg driver parses DATE columns into JS Date objects at LOCAL midnight, so
 * local components (not toISOString, which can shift a calendar day by the
 * runtime timezone) recover the stored date; strings pass through sliced.
 */
export function toPostingDateString(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) {
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${month}-${day}`;
  }
  return String(value);
}

export function toDebitSignedAmount(
  accountClass: string | null | undefined,
  amount: number
): number {
  switch (accountClass) {
    case "Liability":
    case "Equity":
    case "Revenue":
      return -amount;
    default:
      return amount;
  }
}

export function getPostingSyncSourceTypeSkipReason(
  sourceType: string | null | undefined,
  settings: PostingSyncSettings,
  options?: { inventoryAdjustmentEntitySyncEnabled?: boolean }
): string | null {
  const decision = getJournalPostingPolicyDecision({
    sourceType,
    settings,
    docSync: {
      invoiceEnabled: settings.families.ar === "documents",
      billEnabled: settings.families.ap === "documents"
    },
    paymentFamily: null,
    inventoryAdjustmentEntitySyncEnabled:
      options?.inventoryAdjustmentEntitySyncEnabled ?? false
  });

  if (decision.kind === "push") return null;
  return decision.message;
}

// /********************************************************\
// *              Reversal entity-id contract               *
// \********************************************************/

/**
 * Reversal pushes reuse the journal syncer with the ORIGINAL journal id
 * suffixed ":reversal" as the sync entity id (matches the operation
 * idempotencyKey "<journal.id>:reversal"): the syncer negates the line
 * amounts, and the reversal's provider mapping is stored under the
 * suffixed id so the original push's mapping is untouched.
 */
export const JOURNAL_ENTRY_REVERSAL_SUFFIX = ":reversal";

/** Entity id the drain passes to the journal syncer for a sync operation. */
export function getJournalEntrySyncEntityId(
  journalId: string,
  reversal: boolean
): string {
  return reversal ? `${journalId}${JOURNAL_ENTRY_REVERSAL_SUFFIX}` : journalId;
}

/** Split a journal sync entity id back into the journal id + reversal flag. */
export function parseJournalEntrySyncEntityId(entityId: string): {
  journalId: string;
  reversal: boolean;
} {
  if (entityId.endsWith(JOURNAL_ENTRY_REVERSAL_SUFFIX)) {
    return {
      journalId: entityId.slice(
        0,
        entityId.length - JOURNAL_ENTRY_REVERSAL_SUFFIX.length
      ),
      reversal: true
    };
  }
  return { journalId: entityId, reversal: false };
}

// /********************************************************\
// *          Pre-flight failure envelope                   *
// \********************************************************/

export const JOURNAL_ENTRY_SYNC_ERROR_CODES = [
  "UNMAPPED_ACCOUNTS",
  // A slot-configured dimension value on a journal line has no provider
  // option mapping (and autoCreate did not resolve it) while the company's
  // onUnmappedDimensionValue policy is "warn" — user-fixable by mapping
  // the value on the integration settings page, then Retry.
  "UNMAPPED_DIMENSION_VALUES",
  "CONTROL_ACCOUNT_LINE",
  "PERIOD_LOCKED",
  "UNBALANCED_JOURNAL",
  // Master-data syncers (QBO customer/vendor/item) reuse the same envelope
  // for user-fixable name failures: QBO's shared name namespace rejects
  // duplicates (Intuit fault 6240) and caps names at 100 characters.
  "NAME_EXISTS",
  "NAME_TOO_LONG",
  // Decision-time Warnings (recorded at enqueue by the posting policy):
  // a doc-represented journal whose backing document sync is off, a
  // journals-mode family whose document sync is contradictorily on, and a
  // Payment journal whose AR/AP side could not be resolved while the
  // family modes diverge.
  "DOC_SYNC_DISABLED",
  "DOUBLE_REPRESENTATION",
  "PAYMENT_FAMILY_UNRESOLVED",
  // Rillet requires external_references on AR_ONLY invoices, and every
  // reference type must be a slug pre-registered (dashboard-only) under
  // Rillet Settings → External References — user-fixable there.
  "EXTERNAL_REFERENCE_TYPE_MISSING",
  // A document push was skipped because the provider rejects edits to a
  // document that already carries payments (Xero paid/partially-paid bills).
  // User-fixable: void/unapply the payment in the provider, then retry.
  "DOC_HAS_PAYMENTS",
  // An outbound payment settles a document (invoice/bill) that hasn't been
  // pushed to the provider yet — the provider payment references the document's
  // remote id, so the document must sync first. A dependency-ordering Warning,
  // NOT an account-mapping problem: it self-resolves once the document syncs
  // (the outbound sweep / manual Retry re-drives the payment). Kept distinct
  // from UNMAPPED_ACCOUNTS so it stops masquerading as a missing account.
  "UNSYNCED_DOCUMENT"
] as const;

export type JournalEntrySyncErrorCode =
  (typeof JOURNAL_ENTRY_SYNC_ERROR_CODES)[number];

/**
 * Machine-readable pre-flight failure. The syncer surfaces it on
 * `SyncResult.error` (typed `unknown` for exactly this); the drain records
 * it with `failOperation({ errorCode, errorMessage, warning })`.
 * `warning: true` → the operation lands `Warning` (user-fixable, retryable
 * after the fix); `warning: false` → `Failed`.
 */
export interface JournalEntrySyncFailure {
  errorCode: JournalEntrySyncErrorCode;
  message: string;
  warning: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Thrown by the syncer's mapping step on a pre-flight failure. The message
 * is "<errorCode>: <detail>" so paths that flatten errors to strings (the
 * base batch workflow) stay greppable; structured consumers should catch
 * the class and read `failure`.
 */
export class JournalEntrySyncError extends Error {
  readonly failure: JournalEntrySyncFailure;

  constructor(failure: JournalEntrySyncFailure) {
    super(`${failure.errorCode}: ${failure.message}`);
    this.name = "JournalEntrySyncError";
    this.failure = failure;
  }
}

/**
 * Type guard for `SyncResult.error` payloads: true when the value is the
 * structured pre-flight failure the drain should record via
 * `failOperation({ errorCode, errorMessage, warning })`.
 */
export function isJournalEntrySyncFailure(
  value: unknown
): value is JournalEntrySyncFailure {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.errorCode === "string" &&
    (JOURNAL_ENTRY_SYNC_ERROR_CODES as readonly string[]).includes(
      candidate.errorCode
    ) &&
    typeof candidate.message === "string" &&
    typeof candidate.warning === "boolean"
  );
}

// /********************************************************\
// *              Pure pre-flight helpers                   *
// \********************************************************/

/** Round to 2dp, normalizing -0 to 0. */
export function roundCurrency(amount: number): number {
  const rounded = Math.round(amount * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/**
 * A journal balances when its signed line amounts (positive = debit,
 * negative = credit) sum to zero at 2dp.
 */
export function isBalancedJournal(
  lines: Array<Pick<Accounting.JournalEntryLine, "amount">>
): boolean {
  const cents = lines.reduce(
    (sum, line) => sum + Math.round(line.amount * 100),
    0
  );
  return cents === 0;
}

/**
 * Split a journal's lines into unmapped-account buckets: line account ids
 * with no provider account code, and lines with no account at all. Both
 * block a push (UNMAPPED_ACCOUNTS).
 */
export function collectUnmappedJournalAccounts(
  lines: Accounting.JournalEntryLine[],
  accountCodesById: ReadonlyMap<string, string>
): { unmappedAccountIds: string[]; lineIdsWithoutAccount: string[] } {
  const unmapped = new Set<string>();
  const lineIdsWithoutAccount: string[] = [];

  for (const line of lines) {
    if (!line.accountId) {
      lineIdsWithoutAccount.push(line.id);
      continue;
    }
    if (!accountCodesById.get(line.accountId)) {
      unmapped.add(line.accountId);
    }
  }

  return { unmappedAccountIds: [...unmapped], lineIdsWithoutAccount };
}

/**
 * Composite key for a dimension value: `<dimensionId>:<valueId>` — the
 * SAME key the dimension value mappings use as entityId (valueId is
 * polymorphic across entity-typed dimensions, so the composite is
 * required). Kept in sync with buildDimensionValueMappingEntityId
 * (core/dimension-mapping.ts) — duplicated here so this import-light
 * module stays free of DB-facing imports.
 */
function dimensionValueKey(value: JournalLineDimensionRef): string {
  return `${value.dimensionId}:${value.valueId}`;
}

/**
 * Distinct slotted dimension values on the journal's lines that have no
 * provider option mapping. Only SLOT-CONFIGURED dimensions participate —
 * unslotted dimensions don't sync and are untouched by pre-flight.
 * `mappings` is the dimension-value lookup keyed `<dimensionId>:<valueId>`
 * → provider option id.
 */
export function collectUnmappedDimensionValues(
  lines: ReadonlyArray<Pick<Accounting.JournalEntryLine, "dimensions">>,
  slots: ReadonlyArray<{ dimensionId: string }>,
  mappings: ReadonlyMap<string, string>
): JournalLineDimensionRef[] {
  if (slots.length === 0) return [];

  const slottedDimensionIds = new Set(slots.map((slot) => slot.dimensionId));
  const unmapped = new Map<string, JournalLineDimensionRef>();

  for (const line of lines) {
    for (const dimension of line.dimensions ?? []) {
      if (!slottedDimensionIds.has(dimension.dimensionId)) continue;
      const key = dimensionValueKey(dimension);
      if (mappings.get(key)) continue;
      if (!unmapped.has(key)) {
        unmapped.set(key, {
          dimensionId: dimension.dimensionId,
          valueId: dimension.valueId
        });
      }
    }
  }

  return [...unmapped.values()];
}

/**
 * Line ids whose account is an AR/AP control account
 * (accountDefault.receivablesAccount / payablesAccount). Control-account
 * lines never push: the AR/AP balance in the provider is owned by the
 * synced documents, and pushing them would double-post (it also keeps
 * QBD's one-AR/AP-line-per-JE constraint unreachable).
 */
export function findControlAccountLineIds(
  lines: Accounting.JournalEntryLine[],
  controlAccountIds: ReadonlySet<string>
): string[] {
  if (controlAccountIds.size === 0) return [];
  return lines
    .filter((line) => line.accountId && controlAccountIds.has(line.accountId))
    .map((line) => line.id);
}

/** Add days to a YYYY-MM-DD date string (UTC), returning YYYY-MM-DD. */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export type PeriodLockEvaluation =
  | { locked: false }
  | { locked: true; policy: "park"; lockDate: string }
  | { locked: true; policy: "redate"; lockDate: string; pushDate: string };

/**
 * Evaluate the period-lock rule: a journal dated on or before the provider
 * lock date is locked. Under `park` (default) the push is blocked
 * (PERIOD_LOCKED Warning); under `redate` it pushes at lock date + 1 with
 * the original date preserved in the narration. Dates are YYYY-MM-DD
 * strings (lexicographic comparison is date order).
 */
export function evaluatePeriodLock(args: {
  postingDate: string;
  lockDate: string | null;
  policy: PostingSyncSettings["periodLockPolicy"];
}): PeriodLockEvaluation {
  if (!args.lockDate) return { locked: false };

  const postingDay = args.postingDate.slice(0, 10);
  const lockDay = args.lockDate.slice(0, 10);
  if (postingDay > lockDay) return { locked: false };

  if (args.policy === "redate") {
    return {
      locked: true,
      policy: "redate",
      lockDate: lockDay,
      pushDate: addDaysToIsoDate(lockDay, 1)
    };
  }

  return { locked: true, policy: "park", lockDate: lockDay };
}

// /********************************************************\
// *        Daily consolidation aggregation (Task 12)       *
// \********************************************************/

/**
 * Net signed line amounts per account id (cents-accurate, -0 normalized to
 * 0). Lines without an account net into the `null` bucket so the unmapped
 * pre-flight still sees them. Used by the daily-consolidation aggregate and
 * by reconciliation when re-deriving what a consolidated batch booked.
 */
export function netJournalLinesPerAccount(
  lines: ReadonlyArray<
    Pick<Accounting.JournalEntryLine, "accountId" | "amount">
  >
): Map<string | null, number> {
  const centsByAccount = new Map<string | null, number>();
  for (const line of lines) {
    const key = line.accountId ?? null;
    centsByAccount.set(
      key,
      (centsByAccount.get(key) ?? 0) + Math.round(line.amount * 100)
    );
  }

  const netted = new Map<string | null, number>();
  for (const [accountId, cents] of centsByAccount) {
    netted.set(accountId, cents === 0 ? 0 : cents / 100);
  }
  return netted;
}

/** Narration for one daily-consolidation batch (sourceType since v3 partitions). */
export function getDailyConsolidationNarration(
  postingDate: string,
  journalCount: number,
  sourceType?: string | null
): string {
  const sourceTypeLabel = sourceType ? ` — ${sourceType}` : "";
  return `Carbon daily summary ${postingDate}${sourceTypeLabel} — ${journalCount} journals`;
}

export type DailyJournalEntryAggregate = {
  /**
   * Synthetic journal covering every member journal of the posting date:
   * one line per account with the summed signed amount, zero-net lines
   * dropped. Feed it through the SAME pre-flight + mapping helpers as an
   * individual push (runJournalEntryPreflight + the provider mapper).
   */
  journal: Accounting.JournalEntry;
  /** "Carbon daily summary <date> — <n> journals" */
  narration: string;
  journalIds: string[];
};

/**
 * Canonical grouping key for a line's dimension tuple: slotted dimensions
 * only (when `slottedDimensionIds` is provided), sorted by dimensionId.
 * Empty tuple → "" (the legacy per-account bucket).
 */
export function getDimensionTupleKey(
  dimensions: ReadonlyArray<JournalLineDimensionRef> | null | undefined,
  slottedDimensionIds?: ReadonlySet<string>
): string {
  if (!dimensions || dimensions.length === 0) return "";
  return dimensions
    .filter(
      (dimension) =>
        !slottedDimensionIds || slottedDimensionIds.has(dimension.dimensionId)
    )
    .map((dimension) => `${dimension.dimensionId}=${dimension.valueId}`)
    .sort()
    .join("|");
}

/**
 * Build ONE aggregated journal for a posting date from its member journals
 * (daily-consolidation cron). Pure:
 *
 * - sums signed line amounts per (account, dimension tuple) across every
 *   member (cents math) — summaries preserve exactly the analytical
 *   granularity the provider will see (spec §4). The tuple covers the
 *   dimensions in `slottedDimensionIds` when provided, else every
 *   dimension present on the lines; lines without dimensions keep the
 *   legacy per-account bucket;
 * - drops groups that net to zero;
 * - books post-2dp rounding residue (per-line cents rounding of sub-cent
 *   amounts) to `roundingAccountId` when provided — capped at half a cent
 *   per input line, beyond which the input is corrupt, not rounding;
 * - throws JournalEntrySyncError UNBALANCED_JOURNAL (Failed, not Warning)
 *   when the combined lines do not sum to zero and no rounding account
 *   can absorb the residue;
 * - throws a plain Error on misuse (no members, or a member dated off the
 *   batch date) — programmer error, not a sync failure.
 *
 * A date whose members fully cancel produces an aggregate with NO lines —
 * the caller skips the provider push and just closes the members (nothing
 * to book).
 */
export function aggregateJournalEntriesForDate(args: {
  /** Batch key, e.g. "daily:xero:production-event:2026-07-08" — becomes the synthetic journal id. */
  batchId: string;
  companyId: string;
  /** YYYY-MM-DD posting date shared by every member journal. */
  postingDate: string;
  /** Source type shared by the batch's members (v3 per-source-type partitions); null for legacy mixed batches. */
  sourceType?: string | null;
  journals: Accounting.JournalEntry[];
  /**
   * Slot-configured dimension ids: the tuple is restricted to these so
   * summaries group only by dimensions that actually cross the wire.
   * Absent = group by every dimension present on the lines (a superset of
   * the mapped tuple — never coarser than what the provider will see).
   */
  slottedDimensionIds?: Iterable<string>;
  /**
   * accountDefault.roundingAccount — when provided, post-2dp rounding
   * residue books here (mapped like any account) instead of failing the
   * batch. Absent = residue throws UNBALANCED_JOURNAL (legacy behavior).
   */
  roundingAccountId?: string | null;
}): DailyJournalEntryAggregate {
  const postingDay = args.postingDate.slice(0, 10);
  const journalIds = args.journals.map((journal) => journal.id);

  if (args.journals.length === 0) {
    throw new Error(
      `Cannot aggregate zero journals for posting date ${postingDay}`
    );
  }

  for (const journal of args.journals) {
    if (journal.postingDate.slice(0, 10) !== postingDay) {
      throw new Error(
        `Journal ${journal.id} is dated ${journal.postingDate}, not ${postingDay}; daily consolidation groups strictly by posting date`
      );
    }
  }

  const slottedDimensionIds = args.slottedDimensionIds
    ? new Set(args.slottedDimensionIds)
    : undefined;

  const allLines = args.journals.flatMap((journal) => journal.lines);
  const totalCents = allLines.reduce(
    (sum, line) => sum + Math.round(line.amount * 100),
    0
  );

  // Post-2dp residue: per-line cents rounding of sub-cent amounts can
  // shift the total by at most half a cent per line. Anything larger is
  // corrupt input, not rounding — refuse to bury it in roundingAccount.
  const residueCapCents = Math.ceil(allLines.length / 2);
  const bookableResidue =
    totalCents !== 0 &&
    Boolean(args.roundingAccountId) &&
    Math.abs(totalCents) <= residueCapCents;

  if (totalCents !== 0 && !bookableResidue) {
    throw new JournalEntrySyncError({
      errorCode: "UNBALANCED_JOURNAL",
      message: `Daily summary for ${postingDay} does not balance across its ${args.journals.length} member journal(s) (signed line amounts must sum to zero); refusing to push.`,
      warning: false,
      metadata: { postingDate: postingDay, journalIds }
    });
  }

  // Net cents per (account, dimension tuple)
  type Group = {
    accountId: string | null;
    tupleKey: string;
    dimensions: JournalLineDimensionRef[];
    cents: number;
  };
  const groups = new Map<string, Group>();
  for (const line of allLines) {
    const accountId = line.accountId ?? null;
    const tupleKey = getDimensionTupleKey(line.dimensions, slottedDimensionIds);
    const key = `${accountId ?? ""}\u0000${tupleKey}`;
    const existing = groups.get(key);
    const cents = Math.round(line.amount * 100);
    if (existing) {
      existing.cents += cents;
    } else {
      const dimensions = (line.dimensions ?? [])
        .filter(
          (dimension) =>
            !slottedDimensionIds ||
            slottedDimensionIds.has(dimension.dimensionId)
        )
        .sort((a, b) => a.dimensionId.localeCompare(b.dimensionId));
      groups.set(key, { accountId, tupleKey, dimensions, cents });
    }
  }

  const lines: Accounting.JournalEntryLine[] = [...groups.values()]
    .filter((group) => group.cents !== 0)
    .sort(
      (a, b) =>
        String(a.accountId ?? "").localeCompare(String(b.accountId ?? "")) ||
        a.tupleKey.localeCompare(b.tupleKey)
    )
    .map((group) => ({
      id: `${args.batchId}:${group.accountId ?? "no-account"}${
        group.tupleKey ? `:${group.tupleKey}` : ""
      }`,
      accountId: group.accountId,
      amount: group.cents / 100,
      description: null,
      ...(group.dimensions.length > 0 ? { dimensions: group.dimensions } : {})
    }));

  if (bookableResidue) {
    lines.push({
      id: `${args.batchId}:rounding`,
      accountId: args.roundingAccountId ?? null,
      amount: -totalCents / 100,
      description: "Rounding residue"
    });
  }

  const narration = getDailyConsolidationNarration(
    postingDay,
    args.journals.length,
    args.sourceType
  );

  return {
    journal: {
      id: args.batchId,
      companyId: args.companyId,
      journalEntryId: `Daily summary ${postingDay}`,
      description: narration,
      postingDate: postingDay,
      status: "Posted",
      sourceType: args.sourceType ?? null,
      reversalOfId: null,
      reversedById: null,
      reversal: false,
      lines,
      updatedAt: new Date().toISOString()
    },
    narration,
    journalIds
  };
}

export type JournalEntryPreflightResult =
  | { failure: JournalEntrySyncFailure }
  | {
      failure: null;
      pushDate: string;
      redatedFromDate?: string;
      /**
       * Slotted dimension values the push proceeds WITHOUT
       * (onUnmappedDimensionValue "drop"): unmapped values whose
       * dimensions the mapper will omit. Recorded by the caller — I3:
       * degradation is recorded, never silent.
       */
      droppedDimensionValues?: JournalLineDimensionRef[];
    };

/**
 * Run every pre-flight rule for one journal push. Returns either the
 * structured failure to record (no provider call happens) or the push date
 * to use — `redatedFromDate` is set when the redate policy moved the date,
 * so the mapper can append the original date to the narration.
 *
 * Dimension rule (opt-in): when `dimensionValueMappings` is provided and
 * the settings carry dimension slots, every slotted dimension value on the
 * lines must resolve through the mapping lookup. Unmapped values follow
 * `settings.onUnmappedDimensionValue`: "warn" → UNMAPPED_DIMENSION_VALUES
 * Warning (park); "drop" → pass, with the dropped values reported on the
 * success branch. Callers that don't load dimension mappings (legacy
 * paths) omit the arg and skip the rule entirely.
 */
export function runJournalEntryPreflight(args: {
  journal: Accounting.JournalEntry;
  accountCodesById: ReadonlyMap<string, string>;
  controlAccountIds: ReadonlySet<string>;
  lockDate: string | null;
  settings: PostingSyncSettings;
  dimensionValueMappings?: ReadonlyMap<string, string>;
}): JournalEntryPreflightResult {
  const { journal } = args;

  const { unmappedAccountIds, lineIdsWithoutAccount } =
    collectUnmappedJournalAccounts(journal.lines, args.accountCodesById);
  if (unmappedAccountIds.length > 0 || lineIdsWithoutAccount.length > 0) {
    const parts: string[] = [];
    if (unmappedAccountIds.length > 0) {
      parts.push(
        `${unmappedAccountIds.length} account(s) on journal ${journal.journalEntryId} have no provider account mapping`
      );
    }
    if (lineIdsWithoutAccount.length > 0) {
      parts.push(`${lineIdsWithoutAccount.length} line(s) have no account`);
    }
    return {
      failure: {
        errorCode: "UNMAPPED_ACCOUNTS",
        message: `${parts.join("; ")}. Map the account(s) on the integration settings page, then retry.`,
        warning: true,
        metadata: {
          unmappedAccountIds,
          ...(lineIdsWithoutAccount.length > 0 ? { lineIdsWithoutAccount } : {})
        }
      }
    };
  }

  const controlAccountLineIds = findControlAccountLineIds(
    journal.lines,
    args.controlAccountIds
  );
  if (controlAccountLineIds.length > 0) {
    return {
      failure: {
        errorCode: "CONTROL_ACCOUNT_LINE",
        message: `Journal ${journal.journalEntryId} has ${controlAccountLineIds.length} line(s) on an AR/AP control account; control-account postings are owned by the synced documents and are never pushed as journals.`,
        warning: true,
        metadata: {
          lineIds: controlAccountLineIds,
          controlAccountIds: [...args.controlAccountIds]
        }
      }
    };
  }

  let droppedDimensionValues: JournalLineDimensionRef[] | undefined;
  if (
    args.dimensionValueMappings !== undefined &&
    args.settings.dimensionSlots.length > 0
  ) {
    const unmappedDimensionValues = collectUnmappedDimensionValues(
      journal.lines,
      args.settings.dimensionSlots,
      args.dimensionValueMappings
    );

    if (unmappedDimensionValues.length > 0) {
      if (args.settings.onUnmappedDimensionValue === "warn") {
        return {
          failure: {
            errorCode: "UNMAPPED_DIMENSION_VALUES",
            message: `Journal ${journal.journalEntryId} carries ${unmappedDimensionValues.length} slotted dimension value(s) with no provider option mapping. Map the value(s) on the integration settings page (or enable auto-create on the slot), then retry.`,
            warning: true,
            metadata: { unmappedDimensionValues }
          }
        };
      }
      // "drop": push without those dimensions, recorded — never silent
      droppedDimensionValues = unmappedDimensionValues;
    }
  }

  if (!isBalancedJournal(journal.lines)) {
    return {
      failure: {
        errorCode: "UNBALANCED_JOURNAL",
        message: `Journal ${journal.journalEntryId} does not balance (signed line amounts must sum to zero); refusing to push.`,
        warning: false,
        metadata: { journalId: journal.id }
      }
    };
  }

  const lock = evaluatePeriodLock({
    postingDate: journal.postingDate,
    lockDate: args.lockDate,
    policy: args.settings.periodLockPolicy
  });

  if (lock.locked && lock.policy === "park") {
    return {
      failure: {
        errorCode: "PERIOD_LOCKED",
        message: `Journal ${journal.journalEntryId} is dated ${journal.postingDate}, on or before the provider lock date ${lock.lockDate}. Unlock the period in the provider (or switch the period-lock policy to re-date), then retry.`,
        warning: true,
        metadata: {
          postingDate: journal.postingDate,
          lockDate: lock.lockDate
        }
      }
    };
  }

  if (lock.locked) {
    return {
      failure: null,
      pushDate: lock.pushDate,
      redatedFromDate: journal.postingDate,
      ...(droppedDimensionValues ? { droppedDimensionValues } : {})
    };
  }

  return {
    failure: null,
    pushDate: journal.postingDate.slice(0, 10),
    ...(droppedDimensionValues ? { droppedDimensionValues } : {})
  };
}
