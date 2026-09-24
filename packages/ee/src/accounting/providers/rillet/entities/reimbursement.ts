import { buildDimensionValueMappingEntityId } from "../../../core/dimension-mapping";
import { createMappingService } from "../../../core/external-mapping";
import {
  EMPLOYEE_VENDOR_ENTITY_TYPE,
  employeeVendorName,
  loadReimbursementSources,
  type ReimbursementSource,
  resolveReimbursementSyncGate,
  validateReimbursementAccountMapping
} from "../../../core/reimbursement-source";
import type { ShouldSyncContext } from "../../../core/types";
import { withTriggersDisabled } from "../../../core/utils";
import type {
  Rillet,
  RilletReimbursementCreate,
  RilletTransactionWriteOmit
} from "../models";
import { buildRilletIdempotencyKey } from "../provider";
import type { RilletJournalDimensionArgs } from "./journal-entry";
import {
  carbonCompanyExternalReference,
  carbonExternalReference,
  loadRilletAccountCodesById,
  RilletTransactionSyncer,
  toRilletExchangeRate,
  toRilletMoney,
  writeDroppingUnregisteredReferences
} from "./shared";

/**
 * RilletReimbursementSyncer — a Carbon `reimbursement` → a Rillet
 * reimbursement (push-only, create-only; entityType "reimbursement").
 *
 * Rillet is the one provider with a NATIVE reimbursement object, and its
 * shape is what a Carbon reimbursement is: a counterparty, a date, coded
 * items, and — unlike a bill — an explicitly named payable account, because
 * Rillet does not derive one. That last field is why the segregated
 * employee-payable control account survives the crossing intact: the payload
 * carries the code Carbon's posting actually credited.
 *
 * This replaces the employee-supplier detour the BILL syncer used to carry
 * (`isReimbursement` → `toRilletReimbursement`), which existed only because
 * Carbon had no reimbursement document. It is now the primary path; the bill
 * syncer keeps one legacy branch so a void of a PREVIOUSLY-synced
 * employee-supplier bill still deletes the right remote object.
 *
 * Wire shape VERIFIED against Rillet's published OpenAPI
 * (`docs.api.rillet.com/reference/create-a-reimbursement`, 2026-09-23):
 * `POST /reimbursements` requires `vendor_id`, `items[]`,
 * `reimbursement_date` and `payable_account_code`; `impact_date`,
 * `subsidiary_id`, `external_references` and `exchange_rate` are optional.
 * Each item requires `account_code` + `amount` with optional `description`,
 * `tax_rate`, `service_period` and `fields`.
 *
 * Unmapped accounts fail as the structured UNMAPPED_ACCOUNTS Warning, same as
 * bills — never a silent fallback account.
 */

/** The Carbon reimbursement header + lines as the syncer reads them. */
export type RilletReimbursement = ReimbursementSource;

/**
 * Map a Carbon reimbursement to the Rillet reimbursement create payload.
 * Pure — exported for tests.
 *
 * The line amounts are already in the reimbursement's own transaction
 * currency (a reimbursement is not a journal replay), so there is no
 * base→transaction conversion here — only the settlement rounding
 * `toRilletMoney` applies, with `exchange_rate` pinning the directed provider
 * rate exactly as a bill does. Throws the structured UNMAPPED_ACCOUNTS
 * Warning when a line account or the payable control account is unmapped.
 */
export function mapReimbursementToRilletReimbursement(args: {
  reimbursement: RilletReimbursement;
  vendorRemoteId: string;
  accountCodesById: ReadonlyMap<string, string>;
  subsidiaryId: string | null;
  companyId: string;
  dimensions?: RilletJournalDimensionArgs;
}): RilletReimbursementCreate {
  const { reimbursement } = args;
  const currency = reimbursement.currencyCode;

  validateReimbursementAccountMapping({
    reimbursement,
    lines: reimbursement.lines,
    payableAccountId: reimbursement.payableAccountId,
    accountsById: args.accountCodesById,
    providerName: "Rillet"
  });
  // Presence asserted by the guard above.
  const payableAccountCode = args.accountCodesById.get(
    reimbursement.payableAccountId!
  )!;

  const items: Rillet.BillItem[] = reimbursement.lines.map((line) => {
    const fieldRefs: Rillet.ItemFieldRef[] = [];
    if (args.dimensions) {
      for (const dimension of line.dimensions) {
        const fieldId = args.dimensions.fieldIdByDimensionId.get(
          dimension.dimensionId
        );
        if (!fieldId) continue;
        const fieldValueId = args.dimensions.fieldValueIdsByValue.get(
          buildDimensionValueMappingEntityId(
            dimension.dimensionId,
            dimension.valueId
          )
        );
        if (!fieldValueId) continue; // Field/value not provisioned — drop this ref
        fieldRefs.push({ field_id: fieldId, field_value_id: fieldValueId });
      }
    }
    const description =
      line.description ?? reimbursement.notes ?? reimbursement.reference;
    return {
      account_code: args.accountCodesById.get(line.accountId)!,
      amount: toRilletMoney(line.amount, currency, reimbursement.decimalPlaces),
      ...(description ? { description } : {}),
      ...(fieldRefs.length > 0 ? { fields: fieldRefs } : {})
    };
  });

  // Posting always sets postingDate, and only Posted rows sync, so the
  // fallback is unreachable in practice — but Rillet defaults impact_date to
  // reimbursement_date anyway, which is the same answer.
  const impactDate =
    reimbursement.postingDate ?? reimbursement.reimbursementDate;

  return {
    vendor_id: args.vendorRemoteId,
    items,
    reimbursement_date: reimbursement.reimbursementDate,
    impact_date: impactDate,
    payable_account_code: payableAccountCode,
    ...(args.subsidiaryId ? { subsidiary_id: args.subsidiaryId } : {}),
    exchange_rate: toRilletExchangeRate({
      baseCurrencyCode: reimbursement.baseCurrencyCode,
      documentCurrencyCode: currency,
      foreignPerBaseRate: reimbursement.exchangeRate,
      date: impactDate
    }),
    external_references: [
      carbonExternalReference(reimbursement.id),
      carbonCompanyExternalReference(args.companyId)
    ]
  };
}

export class RilletReimbursementSyncer extends RilletTransactionSyncer<
  RilletReimbursement,
  Rillet.Reimbursement,
  RilletTransactionWriteOmit
> {
  private accountCodesByIdPromise?: Promise<Map<string, string>>;

  protected get pushOnlyEntityLabel(): string {
    return "Reimbursements";
  }

  private getAccountCodesById(): Promise<Map<string, string>> {
    if (!this.accountCodesByIdPromise) {
      this.accountCodesByIdPromise = loadRilletAccountCodesById(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      });
    }
    return this.accountCodesByIdPromise;
  }

  // =================================================================
  // 1. LOCAL FETCH (Single + Batch)
  // =================================================================

  protected isVoided(local: RilletReimbursement): boolean {
    return local.status === "Voided";
  }

  protected async deleteRemote(remoteId: string): Promise<void> {
    await this.rilletProvider.deleteReimbursement(remoteId);
  }

  async fetchLocal(id: string): Promise<RilletReimbursement | null> {
    const reimbursements = await this.fetchReimbursementsByIds([id]);
    return reimbursements.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, RilletReimbursement>> {
    return this.fetchReimbursementsByIds(ids);
  }

  private async fetchReimbursementsByIds(
    ids: string[]
  ): Promise<Map<string, RilletReimbursement>> {
    return loadReimbursementSources(this.database, {
      ids,
      companyId: this.companyId,
      integration: this.provider.id
    });
  }

  // =================================================================
  // 2. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Rillet.Reimbursement | null> {
    return this.rilletProvider.getReimbursement(id);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Rillet.Reimbursement>> {
    const result = new Map<string, Rillet.Reimbursement>();
    for (const id of ids) {
      const reimbursement = await this.rilletProvider.getReimbursement(id);
      if (reimbursement) result.set(reimbursement.id, reimbursement);
    }
    return result;
  }

  // =================================================================
  // 3. SHOULD SYNC — mirrors POSTING_POLICY.Reimbursement
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<RilletReimbursement, Rillet.Reimbursement>
  ): boolean | string {
    if (context.direction === "pull") {
      return "Reimbursements are push-only; pulling reimbursements from Rillet is not supported";
    }
    if (!context.localEntity) return true;
    return resolveReimbursementSyncGate(context.localEntity);
  }

  // =================================================================
  // 4. TRANSFORMATION (Carbon -> Rillet)
  // =================================================================

  protected async mapToRemote(
    local: RilletReimbursement
  ): Promise<RilletReimbursementCreate> {
    const vendorRemoteId = await this.resolveEmployeeVendor(local);

    // Send ALL dimensions: auto-provision every Rillet Field + value the
    // coded lines reference (Rillet has no field cap, so nothing is dropped
    // for lack of a slot) — the charge/bill flow, applied to the
    // reimbursement's own merged line dimensions.
    const { fieldIdByDimensionId, fieldValueIdsByValue } =
      await this.resolveLineDimensions(local.lines);

    return mapReimbursementToRilletReimbursement({
      reimbursement: local,
      vendorRemoteId,
      accountCodesById: await this.getAccountCodesById(),
      subsidiaryId: this.rilletProvider.subsidiaryId,
      companyId: this.companyId,
      dimensions: { fieldIdByDimensionId, fieldValueIdsByValue }
    });
  }

  /**
   * The Rillet vendor the reimbursement is paid to. Mapping-first under
   * `employeeVendor` (NOT `vendor` — that id space holds Carbon supplier ids,
   * and keeping the employee out of the vendor master is the point of this
   * document), else create the Rillet vendor JIT and link it.
   *
   * This is the ONE place `resolveEmployeeSupplier`'s naming convention
   * survives: the provider still needs a payable counterparty, so the
   * employee-as-vendor representation lives provider-side only.
   */
  private async resolveEmployeeVendor(
    local: RilletReimbursement
  ): Promise<string> {
    if (local.employeeVendorExternalId) return local.employeeVendorExternalId;

    const name = employeeVendorName(local.employee);
    const created = await this.rilletProvider.createVendor(
      {
        name,
        ...(local.employee.email ? { email: local.employee.email } : {}),
        external_references: [
          carbonExternalReference(local.employeeId),
          carbonCompanyExternalReference(this.companyId)
        ]
      },
      buildRilletIdempotencyKey({
        companyId: this.companyId,
        operation: "employee-vendor",
        localId: local.employeeId
      })
    );
    if (!created?.id) {
      throw new Error(
        `Rillet did not return a vendor id for employee ${local.employeeId}`
      );
    }

    await withTriggersDisabled(this.database, async (tx) => {
      await createMappingService(tx, this.companyId).link(
        EMPLOYEE_VENDOR_ENTITY_TYPE,
        local.employeeId,
        this.provider.id,
        created.id
      );
    });

    return created.id;
  }

  // =================================================================
  // 5. UPSERT REMOTE (create-only; RilletTransactionSyncer hard-skips
  //    already-mapped ids)
  // =================================================================

  protected async upsertRemote(
    data: RilletReimbursementCreate,
    localId: string
  ): Promise<string> {
    const created = await writeDroppingUnregisteredReferences(data, (payload) =>
      this.rilletProvider.createReimbursement(
        payload,
        buildRilletIdempotencyKey({
          companyId: this.companyId,
          operation: "reimbursement",
          localId
        })
      )
    );
    return created.id;
  }
}
