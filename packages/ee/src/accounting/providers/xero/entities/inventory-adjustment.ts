import type { KyselyTx } from "@carbon/database/client";
import { type Accounting, BaseEntitySyncer } from "../../../core/types";
import { throwXeroApiError } from "../../../core/utils";
import { parseDotnetDate, type Xero } from "../models";

// Note: This is a push-only syncer (Carbon -> Xero).
// Inventory adjustments are pushed as Manual Journals to Xero since
// Xero has no dedicated inventory adjustment endpoint.

// Type for rows returned from itemLedger queries with cost/account joins
type InventoryAdjustmentRow = {
  id: string;
  entryNumber: number;
  postingDate: string;
  entryType: "Positive Adjmt." | "Negative Adjmt.";
  itemId: string;
  locationId: string | null;
  quantity: number;
  companyId: string;
  createdAt: string;
  unitCost: number | null;
  inventoryAccount: string | null;
  adjustmentVarianceAccount: string | null;
  itemReadableId: string | null;
};

export class InventoryAdjustmentSyncer extends BaseEntitySyncer<
  Accounting.InventoryAdjustment,
  Xero.ManualJournal,
  "UpdatedDateUTC"
> {
  // =================================================================
  // 1. ID MAPPING - Uses default implementation from BaseEntitySyncer
  // =================================================================

  // =================================================================
  // 2. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: Xero.ManualJournal): Date | null {
    if (!remote.UpdatedDateUTC) return null;
    return parseDotnetDate(remote.UpdatedDateUTC);
  }

  // =================================================================
  // 3. LOCAL FETCH (Single + Batch)
  // =================================================================

  async fetchLocal(id: string): Promise<Accounting.InventoryAdjustment | null> {
    const items = await this.fetchAdjustmentsByIds([id]);
    return items.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.InventoryAdjustment>> {
    return this.fetchAdjustmentsByIds(ids);
  }

  private async fetchAdjustmentsByIds(
    ids: string[]
  ): Promise<Map<string, Accounting.InventoryAdjustment>> {
    if (ids.length === 0) return new Map();

    const rows = await this.database
      .selectFrom("itemLedger")
      .innerJoin("item", "item.id", "itemLedger.itemId")
      .leftJoin("itemCost", "itemCost.itemId", "itemLedger.itemId")
      .leftJoin("postingGroupInventory", (join) =>
        join
          .onRef(
            "postingGroupInventory.itemPostingGroupId",
            "=",
            "itemCost.itemPostingGroupId" as any
          )
          .onRef(
            "postingGroupInventory.locationId",
            "=",
            "itemLedger.locationId" as any
          )
      )
      .select([
        "itemLedger.id",
        "itemLedger.entryNumber",
        "itemLedger.postingDate",
        "itemLedger.entryType",
        "itemLedger.itemId",
        "itemLedger.locationId",
        "itemLedger.quantity",
        "itemLedger.companyId",
        "itemLedger.createdAt",
        "itemCost.unitCost",
        "postingGroupInventory.inventoryAccount",
        "postingGroupInventory.inventoryAdjustmentVarianceAccount as adjustmentVarianceAccount",
        "item.readableId as itemReadableId"
      ])
      .where("itemLedger.id", "in", ids)
      .where("itemLedger.companyId", "=", this.companyId)
      .where("itemLedger.entryType", "in", [
        "Positive Adjmt.",
        "Negative Adjmt."
      ])
      .execute();

    return this.transformRows(rows as unknown as InventoryAdjustmentRow[]);
  }

  private transformRows(
    rows: InventoryAdjustmentRow[]
  ): Map<string, Accounting.InventoryAdjustment> {
    const result = new Map<string, Accounting.InventoryAdjustment>();

    for (const row of rows) {
      // Skip rows without required GL accounts
      if (!row.inventoryAccount || !row.adjustmentVarianceAccount) {
        continue;
      }

      result.set(row.id, {
        id: row.id,
        entryNumber: row.entryNumber,
        postingDate: row.postingDate,
        entryType: row.entryType,
        itemId: row.itemId,
        locationId: row.locationId,
        quantity: row.quantity,
        companyId: row.companyId,
        unitCost: row.unitCost ?? 0,
        inventoryAccount: row.inventoryAccount,
        adjustmentVarianceAccount: row.adjustmentVarianceAccount,
        updatedAt: row.createdAt ?? new Date().toISOString(),
        raw: row
      });
    }

    return result;
  }

  // =================================================================
  // 4. REMOTE FETCH - Stubs (push-only syncer)
  // =================================================================

  async fetchRemote(id: string): Promise<Xero.ManualJournal | null> {
    const result = await this.provider.request<{
      ManualJournals: Xero.ManualJournal[];
    }>("GET", `/ManualJournals/${id}`);
    return result.error ? null : (result.data?.ManualJournals?.[0] ?? null);
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Xero.ManualJournal>> {
    const result = new Map<string, Xero.ManualJournal>();
    if (ids.length === 0) return result;

    const response = await this.provider.request<{
      ManualJournals: Xero.ManualJournal[];
    }>("GET", `/ManualJournals?IDs=${ids.join(",")}`);

    if (response.error) {
      throwXeroApiError("fetch manual journals batch", response);
    }

    if (response.data?.ManualJournals) {
      for (const journal of response.data.ManualJournals) {
        result.set(journal.ManualJournalID, journal);
      }
    }

    return result;
  }

  // =================================================================
  // 5. TRANSFORMATION (Carbon -> Xero)
  // =================================================================

  protected async mapToRemote(
    local: Accounting.InventoryAdjustment
  ): Promise<Omit<Xero.ManualJournal, "UpdatedDateUTC">> {
    const existingRemoteId = await this.getRemoteId(local.id);
    const amount = Math.abs(local.quantity) * local.unitCost;
    const isPositive = local.entryType === "Positive Adjmt.";

    // Ensure item dependency is synced
    await this.ensureDependencySynced("item", local.itemId);

    // For a positive adjustment:
    //   Debit Inventory Account (increase inventory asset)
    //   Credit Adjustment Variance Account (offset)
    // For a negative adjustment:
    //   Credit Inventory Account (decrease inventory asset)
    //   Debit Adjustment Variance Account (offset)
    const journalLines: Xero.ManualJournalLine[] = [
      {
        LineAmount: isPositive ? amount : -amount,
        AccountCode: local.inventoryAccount,
        Description: `Inventory ${isPositive ? "increase" : "decrease"}: ${
          local.quantity
        } units`
      },
      {
        LineAmount: isPositive ? -amount : amount,
        AccountCode: local.adjustmentVarianceAccount,
        Description: `Adjustment variance: ${local.quantity} units`
      }
    ];

    return {
      ManualJournalID: existingRemoteId!,
      Narration: `Inventory Adjustment #${local.entryNumber}: ${local.entryType} (${local.quantity} units @ ${local.unitCost}/unit)`,
      Date: local.postingDate,
      Status: "POSTED",
      LineAmountTypes: "NoTax",
      JournalLines: journalLines
    };
  }

  // =================================================================
  // 6. TRANSFORMATION (Xero -> Carbon) - Not supported (push-only)
  // =================================================================

  protected async mapToLocal(
    _remote: Xero.ManualJournal
  ): Promise<Partial<Accounting.InventoryAdjustment>> {
    throw new Error(
      "Inventory adjustments are push-only. Cannot map from Xero to Carbon."
    );
  }

  // =================================================================
  // 7. UPSERT LOCAL - Not supported (push-only)
  // =================================================================

  protected async upsertLocal(
    _tx: KyselyTx,
    _data: Partial<Accounting.InventoryAdjustment>,
    _remoteId: string
  ): Promise<string> {
    throw new Error(
      "Inventory adjustments are push-only. Cannot upsert locally from Xero."
    );
  }

  // =================================================================
  // 8. UPSERT REMOTE (Single + Batch)
  // =================================================================

  protected async upsertRemote(
    data: Omit<Xero.ManualJournal, "UpdatedDateUTC">,
    localId: string
  ): Promise<string> {
    const existingRemoteId = await this.getRemoteId(localId);
    const journals = existingRemoteId
      ? [{ ...data, ManualJournalID: existingRemoteId }]
      : [data];

    const result = await this.provider.request<{
      ManualJournals: Xero.ManualJournal[];
    }>("POST", "/ManualJournals", {
      body: JSON.stringify({ ManualJournals: journals })
    });

    if (result.error) {
      throwXeroApiError(
        existingRemoteId
          ? "update inventory adjustment journal"
          : "create inventory adjustment journal",
        result
      );
    }

    if (!result.data?.ManualJournals?.[0]?.ManualJournalID) {
      throw new Error(
        "Xero API returned success but no ManualJournalID was returned"
      );
    }

    return result.data.ManualJournals[0].ManualJournalID;
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: Omit<Xero.ManualJournal, "UpdatedDateUTC">;
    }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (data.length === 0) return result;

    const journals: Xero.ManualJournal[] = [];
    const localIdOrder: string[] = [];

    for (const { localId, payload } of data) {
      const existingRemoteId = await this.getRemoteId(localId);
      journals.push(
        existingRemoteId
          ? ({
              ...payload,
              ManualJournalID: existingRemoteId
            } as Xero.ManualJournal)
          : (payload as Xero.ManualJournal)
      );
      localIdOrder.push(localId);
    }

    const response = await this.provider.request<{
      ManualJournals: Xero.ManualJournal[];
    }>("POST", "/ManualJournals", {
      body: JSON.stringify({ ManualJournals: journals })
    });

    if (response.error) {
      throwXeroApiError("batch upsert inventory adjustment journals", response);
    }

    if (!response.data?.ManualJournals) {
      throw new Error(
        "Xero API returned success but no ManualJournals array was returned"
      );
    }

    for (let i = 0; i < response.data.ManualJournals.length; i++) {
      const returnedJournal = response.data.ManualJournals[i];
      const localId = localIdOrder[i];
      if (returnedJournal?.ManualJournalID && localId) {
        result.set(localId, returnedJournal.ManualJournalID);
      }
    }

    return result;
  }
}
