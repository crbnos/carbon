import type { KyselyTx } from "@carbon/database/client";
import { ChargeSyncerBase } from "../../../core/charge-syncer";
import {
  buildDimensionValueMappingEntityId,
  buildDimensionValueMappingLookup,
  ensureDimensionValueExternalIds,
  getDimensionValueMappings,
  resolveDimensionValueLabels,
  upsertDimensionValueMapping
} from "../../../core/dimension-mapping";
import { createMappingService } from "../../../core/external-mapping";
import {
  type PostingSyncSettings,
  resolvePostingSyncSettings
} from "../../../core/posting";
import {
  EMPLOYEE_VENDOR_ENTITY_TYPE,
  employeeVendorName,
  loadReimbursementSources,
  type ReimbursementLineSource,
  type ReimbursementSource,
  resolveReimbursementSyncGate,
  validateReimbursementAccountMapping
} from "../../../core/reimbursement-source";
import type { ShouldSyncContext } from "../../../core/types";
import { withTriggersDisabled } from "../../../core/utils";
import { parseQboDate, type Qbo, type QboCreatePayload } from "../models";
import {
  buildQboRequestId,
  QBO_DIMENSION_TARGET_CLASS,
  QBO_DIMENSION_TARGET_DEPARTMENT,
  type QboProvider
} from "../provider";
import type { QboJournalDimensionArgs } from "./journal-entry";
import {
  buildQboDocNumberFields,
  loadQboAccountRefsById,
  type QboWriteOmit
} from "./shared";

/**
 * QboReimbursementSyncer — a Carbon `reimbursement` → a QuickBooks Online
 * `Bill` against an employee **Vendor** (push-only, create-only; entityType
 * "reimbursement").
 *
 * QBO has no native reimbursement object, so the document is a Bill: an
 * account-based expense line per coding line, `VendorRef` = the employee's
 * QBO Vendor, and `APAccountRef` = the QBO account Carbon's employee-payable
 * control account maps to — which is what keeps the reimbursement out of the
 * trade-AP population on the QBO side too. That is what SAP and D365 do:
 * worker-as-vendor at the provider, segregated control account in the ledger.
 *
 * The employee-as-vendor representation lives PROVIDER-SIDE ONLY. No Carbon
 * `supplier` row is created; the link is an `externalIntegrationMapping` row
 * under `employeeVendor` keyed by the Carbon employee id.
 *
 * Create-only (`updateMappedCharges` stays false): a Posted reimbursement is
 * immutable in Carbon, so there is never a later edit to push. A Voided one
 * deletes the remote Bill and tombstones the mapping, the ChargeSyncerBase
 * lifecycle.
 *
 * PRECONDITIONS the customer must meet, surfaced rather than guessed:
 *  1. every account on the reimbursement — the coding lines AND the
 *     employee-payable control account — must be mapped to a QBO account,
 *     else the structured UNMAPPED_ACCOUNTS Warning names the ids;
 *  2. Intuit requires `APAccountRef` to name a Liability account of sub-type
 *     Payables, so the Carbon employee-payable account must map to one. A
 *     mismatch is rejected by QBO and surfaces with Intuit's own message.
 *
 * VERIFY (QBO sandbox): no sandbox was available when this shipped. The Bill
 * payload follows Intuit's reference (VendorRef, APAccountRef,
 * AccountBasedExpenseLineDetail with AccountRef + per-line ClassRef,
 * transaction-level DepartmentRef) but is unverified against a live QBO
 * company — like the QBO charge and payment adapters.
 */

/** The Carbon reimbursement header + lines as the syncer reads them. */
export type QboReimbursement = ReimbursementSource;

/**
 * Map a Carbon reimbursement to the QBO Bill create payload. Pure — exported
 * for tests.
 *
 * Line amounts are already in the reimbursement's transaction currency, so
 * only the currency ref / rate are derived here. QBO quotes company base per
 * document currency, reciprocal to Carbon's foreign-per-base `exchangeRate`.
 *
 * Dimension slots: a "class" slot lands on the line
 * (`AccountBasedExpenseLineDetail.ClassRef`); a "department" slot is
 * transaction-level on a Bill (per-line only on JournalEntry), so the FIRST
 * line carrying a resolvable department value sets `DepartmentRef`.
 * Unresolvable values are dropped, as on the journal and charge mappers.
 */
export function mapReimbursementToQboBill(args: {
  reimbursement: QboReimbursement;
  vendorRemoteId: string;
  accountRefsById: ReadonlyMap<string, Qbo.Ref>;
  dimensions?: QboJournalDimensionArgs;
}): QboCreatePayload<Qbo.Bill> {
  const { reimbursement } = args;

  validateReimbursementAccountMapping({
    reimbursement,
    lines: reimbursement.lines,
    payableAccountId: reimbursement.payableAccountId,
    accountsById: args.accountRefsById,
    providerName: "QuickBooks Online"
  });
  // Presence asserted by the guard above.
  const apAccountRef = args.accountRefsById.get(
    reimbursement.payableAccountId!
  )!;

  let departmentRef: Qbo.Ref | undefined;

  const lines = reimbursement.lines.map((line): Omit<Qbo.ExpenseLine, "Id"> => {
    const detail: Qbo.AccountBasedExpenseLineDetail = {
      AccountRef: args.accountRefsById.get(line.accountId)!
    };
    if (args.dimensions) {
      for (const slot of args.dimensions.slots) {
        const dimension = line.dimensions.find(
          (candidate) => candidate.dimensionId === slot.dimensionId
        );
        if (!dimension) continue;
        const ref = args.dimensions.refsByValue.get(
          buildDimensionValueMappingEntityId(
            dimension.dimensionId,
            dimension.valueId
          )
        );
        if (!ref) continue; // Value not mapped — drop this ref
        if (slot.target === QBO_DIMENSION_TARGET_CLASS) {
          detail.ClassRef = ref;
        } else if (slot.target === QBO_DIMENSION_TARGET_DEPARTMENT) {
          departmentRef ??= ref;
        }
      }
    }
    return {
      Amount: line.amount,
      ...(line.description ? { Description: line.description } : {}),
      DetailType: "AccountBasedExpenseLineDetail",
      AccountBasedExpenseLineDetail: detail
    };
  });

  const docNumber = buildQboDocNumberFields(
    reimbursement.reimbursementId,
    reimbursement.notes ?? reimbursement.reference
  );

  // The GL date Carbon booked; posting already shifted it into an open
  // period, so a closed-period reimbursement date cannot draw QBO's 6210
  // fault. The reimbursement date stays on the Carbon row.
  const txnDate = reimbursement.postingDate ?? reimbursement.reimbursementDate;

  return {
    VendorRef: { value: args.vendorRemoteId },
    APAccountRef: apAccountRef,
    DocNumber: docNumber.DocNumber,
    PrivateNote: docNumber.PrivateNote,
    TxnDate: txnDate,
    // Carbon has no due date on a reimbursement; QBO defaults it from the
    // vendor's terms, so it is deliberately omitted rather than invented.
    ...(departmentRef ? { DepartmentRef: departmentRef } : {}),
    ...(reimbursement.currencyCode !== reimbursement.baseCurrencyCode
      ? {
          CurrencyRef: { value: reimbursement.currencyCode },
          ExchangeRate: 1 / reimbursement.exchangeRate
        }
      : {}),
    Line: lines
  };
}

export class QboReimbursementSyncer extends ChargeSyncerBase<
  QboReimbursement,
  Qbo.Bill,
  QboWriteOmit
> {
  private accountRefsByIdPromise?: Promise<Map<string, Qbo.Ref>>;
  private postingSyncSettingsPromise?: Promise<PostingSyncSettings>;
  private dimensionValueMappingsPromise?: Promise<Map<string, string>>;
  private remoteMetaById = new Map<
    string,
    { syncToken?: string; lastUpdatedTime?: string }
  >();

  protected get documentLabel(): string {
    return "Reimbursement";
  }

  private get qboProvider(): QboProvider {
    return this.provider as QboProvider;
  }

  private rememberRemoteEntity(
    remote: Pick<Qbo.Bill, "Id" | "SyncToken" | "MetaData"> | null
  ): void {
    if (!remote?.Id) return;
    this.remoteMetaById.set(remote.Id, {
      syncToken: remote.SyncToken,
      lastUpdatedTime: remote.MetaData?.LastUpdatedTime
    });
  }

  private getAccountRefsById(): Promise<Map<string, Qbo.Ref>> {
    if (!this.accountRefsByIdPromise) {
      this.accountRefsByIdPromise = loadQboAccountRefsById(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      });
    }
    return this.accountRefsByIdPromise;
  }

  private getPostingSyncSettings(): Promise<PostingSyncSettings> {
    if (!this.postingSyncSettingsPromise) {
      this.postingSyncSettingsPromise = (async () => {
        const integration = await this.database
          .selectFrom("companyIntegration")
          .select("metadata")
          .where("id", "=", this.provider.id)
          .where("companyId", "=", this.companyId)
          .executeTakeFirst();

        return resolvePostingSyncSettings(integration?.metadata);
      })();
    }
    return this.postingSyncSettingsPromise;
  }

  private getDimensionValueMappings(): Promise<Map<string, string>> {
    if (!this.dimensionValueMappingsPromise) {
      this.dimensionValueMappingsPromise = (async () => {
        const mappings = await getDimensionValueMappings(this.database, {
          companyId: this.companyId,
          integration: this.provider.id
        });
        if (mappings.error) {
          throw new Error(
            `Failed to load dimension value mappings: ${mappings.error}`
          );
        }
        return buildDimensionValueMappingLookup(mappings.data ?? []);
      })();
    }
    return this.dimensionValueMappingsPromise;
  }

  /** autoCreate (opt-in per slot for QBO) — the charge syncer's flow. */
  private async ensureAutoCreatedDimensionValues(
    lines: ReadonlyArray<ReimbursementLineSource>,
    settings: PostingSyncSettings,
    mappings: Map<string, string>
  ): Promise<void> {
    await ensureDimensionValueExternalIds({
      lines,
      slots: settings.dimensionSlots,
      defaultAutoCreate: false, // QBO: opt-in avoids surprise list writes
      mappings,
      resolveLabels: (values) =>
        resolveDimensionValueLabels(this.database, { values }),
      createExternalValue: async (slot, label) => {
        if (slot.target === QBO_DIMENSION_TARGET_CLASS) {
          const created = await this.qboProvider.createClass({ Name: label });
          return created.Id;
        }
        if (slot.target === QBO_DIMENSION_TARGET_DEPARTMENT) {
          const created = await this.qboProvider.createDepartment({
            Name: label
          });
          return created.Id;
        }
        throw new Error(
          `Unknown QuickBooks Online dimension target "${slot.target}"`
        );
      },
      persistMapping: async (value, externalId, label) => {
        const persisted = await upsertDimensionValueMapping(this.database, {
          companyId: this.companyId,
          integration: this.provider.id,
          dimensionId: value.dimensionId,
          valueId: value.valueId,
          externalId,
          externalName: label
        });
        if (persisted.error) {
          throw new Error(
            `Failed to store dimension value mapping: ${persisted.error}`
          );
        }
      }
    });
  }

  // =================================================================
  // 1. ID MAPPING (entityType "reimbursement") + SyncToken recording
  // =================================================================

  protected async linkEntities(
    tx: KyselyTx,
    localId: string,
    remoteId: string,
    remoteUpdatedAt?: Date
  ): Promise<void> {
    const seen = this.remoteMetaById.get(remoteId);
    await createMappingService(tx, this.companyId).link(
      this.entityType,
      localId,
      this.provider.id,
      remoteId,
      {
        remoteUpdatedAt:
          remoteUpdatedAt ?? parseQboDate(seen?.lastUpdatedTime) ?? undefined,
        ...(seen?.syncToken !== undefined
          ? { metadata: { syncToken: seen.syncToken } }
          : {})
      }
    );
  }

  protected getRemoteUpdatedAt(remote: Qbo.Bill): Date | null {
    return parseQboDate(remote.MetaData?.LastUpdatedTime);
  }

  // =================================================================
  // 2. LOCAL FETCH (Single + Batch)
  // =================================================================

  protected async deleteRemote(remoteId: string): Promise<void> {
    await this.qboProvider.deleteBill(remoteId);
  }

  async fetchLocal(id: string): Promise<QboReimbursement | null> {
    const reimbursements = await this.fetchReimbursementsByIds([id]);
    return reimbursements.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, QboReimbursement>> {
    return this.fetchReimbursementsByIds(ids);
  }

  private async fetchReimbursementsByIds(
    ids: string[]
  ): Promise<Map<string, QboReimbursement>> {
    return loadReimbursementSources(this.database, {
      ids,
      companyId: this.companyId,
      integration: this.provider.id
    });
  }

  // =================================================================
  // 3. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Qbo.Bill | null> {
    const bill = await this.qboProvider.getBill(id);
    this.rememberRemoteEntity(bill);
    return bill;
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Qbo.Bill>> {
    const result = new Map<string, Qbo.Bill>();
    for (const id of ids) {
      const bill = await this.fetchRemote(id);
      if (bill) result.set(bill.Id, bill);
    }
    return result;
  }

  // =================================================================
  // 4. SHOULD SYNC — mirrors POSTING_POLICY.Reimbursement
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<QboReimbursement, Qbo.Bill>
  ): boolean | string {
    if (context.direction === "pull") {
      return "Reimbursements are push-only; pulling bills from QuickBooks Online is not supported";
    }
    if (!context.localEntity) return true;
    return resolveReimbursementSyncGate(context.localEntity);
  }

  // =================================================================
  // 5. TRANSFORMATION (Carbon -> QBO)
  // =================================================================

  protected async mapToRemote(
    local: QboReimbursement
  ): Promise<QboCreatePayload<Qbo.Bill>> {
    const vendorRemoteId = await this.resolveEmployeeVendor(local);

    const settings = await this.getPostingSyncSettings();
    let dimensions: QboJournalDimensionArgs | undefined;
    if (settings.dimensionSlots.length > 0) {
      const dimensionValueMappings = await this.getDimensionValueMappings();
      await this.ensureAutoCreatedDimensionValues(
        local.lines,
        settings,
        dimensionValueMappings
      );
      dimensions = {
        slots: settings.dimensionSlots,
        refsByValue: new Map(
          [...dimensionValueMappings].map(
            ([key, externalId]) => [key, { value: externalId }] as const
          )
        )
      };
    }

    return mapReimbursementToQboBill({
      reimbursement: local,
      vendorRemoteId,
      accountRefsById: await this.getAccountRefsById(),
      dimensions
    });
  }

  /**
   * The QBO Vendor the reimbursement is billed to. Mapping-first under
   * `employeeVendor` (NOT `vendor` — that id space holds Carbon supplier ids),
   * else create the Vendor JIT and link it. QBO's name namespace is shared
   * across customers, vendors and employees, so a DisplayName collision
   * surfaces as Intuit fault 6240 on the operation rather than silently
   * reusing someone else's record.
   */
  private async resolveEmployeeVendor(
    local: QboReimbursement
  ): Promise<string> {
    if (local.employeeVendorExternalId) return local.employeeVendorExternalId;

    const created = await this.qboProvider.createVendor({
      DisplayName: employeeVendorName(local.employee),
      ...(local.employee.email
        ? { PrimaryEmailAddr: { Address: local.employee.email } }
        : {})
    });
    if (!created?.Id) {
      throw new Error(
        `QuickBooks did not return a Vendor Id for employee ${local.employeeId}`
      );
    }

    await withTriggersDisabled(this.database, async (tx) => {
      await createMappingService(tx, this.companyId).link(
        EMPLOYEE_VENDOR_ENTITY_TYPE,
        local.employeeId,
        this.provider.id,
        created.Id
      );
    });

    return created.Id;
  }

  // =================================================================
  // 6. TRANSFORMATION (QBO -> Carbon) — not supported (push-only)
  // =================================================================

  protected async mapToLocal(
    _remote: Qbo.Bill
  ): Promise<Partial<QboReimbursement>> {
    throw new Error(
      "Reimbursements are push-only. Cannot map from QuickBooks Online to Carbon."
    );
  }

  protected async upsertLocal(
    _tx: KyselyTx,
    _data: Partial<QboReimbursement>,
    _remoteId: string
  ): Promise<string> {
    throw new Error(
      "Reimbursements are push-only. Cannot upsert locally from QuickBooks Online."
    );
  }

  // =================================================================
  // 7. UPSERT REMOTE (create-only — a Posted reimbursement is immutable)
  // =================================================================

  protected async upsertRemote(
    data: QboCreatePayload<Qbo.Bill>,
    localId: string
  ): Promise<string> {
    // Intuit replays a write's original response for the same requestid.
    // https://blogs.a.intuit.com/2018/09/10/quickbooks-online-api-best-practices/
    const created = await this.qboProvider.createBill(
      data,
      buildQboRequestId(this.companyId, "reimbursement", localId)
    );
    if (!created?.Id) {
      throw new Error(
        "QuickBooks did not return a Bill Id for this reimbursement"
      );
    }
    this.rememberRemoteEntity(created);
    return created.Id;
  }

  protected async upsertRemoteBatch(
    data: Array<{ localId: string; payload: QboCreatePayload<Qbo.Bill> }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const { localId, payload } of data) {
      result.set(localId, await this.upsertRemote(payload, localId));
    }
    return result;
  }
}
