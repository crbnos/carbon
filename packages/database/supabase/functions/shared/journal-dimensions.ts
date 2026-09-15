// Pure builder for automatic GL dimension rows on journal lines. Shared by the
// return-flow posters (post-shipment, post-receipt) so every new journal entry
// carries the same item / item-group / party / location dimensions. No Deno or
// db imports — consumed from edge functions only.
//
// A `journalLineDimension` row is (journalLineId, dimensionId, valueId). A
// dimension only exists when the company group has configured that entityType
// as a GL dimension, so `dimensionMap` (entityType -> dimension.id) gates every
// emission. `meta` is index-parallel to the journal lines: dimension #i belongs
// to journal line #i.

export type JournalDimensionMeta = {
  itemId?: string | null;
  itemPostingGroupId?: string | null;
  locationId?: string | null;
  supplierId?: string | null;
  supplierTypeId?: string | null;
  customerId?: string | null;
  customerTypeId?: string | null;
  processId?: string | null;
  fixedAssetClassId?: string | null;
  costCenterId?: string | null;
};

// entityType (in the `dimension` table) -> the meta field holding its value.
const DIMENSION_FIELDS: [string, keyof JournalDimensionMeta][] = [
  ["Item", "itemId"],
  ["ItemPostingGroup", "itemPostingGroupId"],
  ["Location", "locationId"],
  ["Supplier", "supplierId"],
  ["SupplierType", "supplierTypeId"],
  ["Customer", "customerId"],
  ["CustomerType", "customerTypeId"],
  ["Process", "processId"],
  ["FixedAssetClass", "fixedAssetClassId"],
  ["CostCenter", "costCenterId"],
];

export type JournalLineDimensionInsert = {
  journalLineId: string;
  dimensionId: string;
  valueId: string;
  companyId: string;
};

export function buildJournalLineDimensionInserts(params: {
  journalLineIds: string[];
  meta: JournalDimensionMeta[];
  dimensionMap: Map<string, string>;
  companyId: string;
}): JournalLineDimensionInsert[] {
  const { journalLineIds, meta, dimensionMap, companyId } = params;
  const rows: JournalLineDimensionInsert[] = [];
  journalLineIds.forEach((journalLineId, index) => {
    const m = meta[index];
    if (!m) return;
    for (const [entityType, key] of DIMENSION_FIELDS) {
      const valueId = m[key];
      const dimensionId = dimensionMap.get(entityType);
      if (valueId && dimensionId) {
        rows.push({ journalLineId, dimensionId, valueId, companyId });
      }
    }
  });
  return rows;
}
