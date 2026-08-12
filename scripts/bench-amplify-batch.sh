#!/usr/bin/env bash
# Amplify itemLedger in ~1M-row batches.
#
# A single 9M-row INSERT exhausts the dev container's memory and the connection
# drops, which also leaves the insert trigger DISABLED (the ALTER before it has
# already committed). Batching keeps each transaction bounded, and the trigger is
# re-enabled after every batch -- including when a batch fails -- so a crash can
# never leave the aggregate silently unmaintained.
#
# Usage: scripts/bench-amplify-batch.sh <target_rows>

set -uo pipefail

PG="${PG_CONTAINER:?set PG_CONTAINER to the worktree's postgres container name}"
TARGET="${1:-10000000}"
TENANT="${TENANT:?set TENANT to the companyId whose ledger rows get cloned}"
BATCH=1000000

psql_c() { docker exec -i "$PG" psql -U postgres -d postgres -tAc "$1"; }

reenable() {
  psql_c 'ALTER TABLE "itemLedger" ENABLE TRIGGER "trg_stock_qty_ins_itemLedger";' >/dev/null
}
trap reenable EXIT

while :; do
  current=$(psql_c 'SELECT count(*) FROM "itemLedger";')
  echo "ledger rows: $current / $TARGET"
  [ "$current" -ge "$TARGET" ] && break

  psql_c 'ALTER TABLE "itemLedger" DISABLE TRIGGER "trg_stock_qty_ins_itemLedger";' >/dev/null
  psql_c "
    INSERT INTO \"itemLedger\" (
      \"entryType\", \"postingDate\", \"documentType\", \"documentId\", \"itemId\",
      \"locationId\", \"storageUnitId\", \"quantity\", \"companyId\", \"createdBy\",
      \"trackedEntityId\", \"trackedEntityStatus\")
    SELECT \"entryType\", \"postingDate\", \"documentType\", \"documentId\", \"itemId\",
           \"locationId\", \"storageUnitId\", \"quantity\", \"companyId\", \"createdBy\",
           \"trackedEntityId\", \"trackedEntityStatus\"
    FROM \"itemLedger\" WHERE \"companyId\" = '$TENANT' LIMIT $BATCH;" || {
      echo "batch failed"; reenable; exit 1; }
  reenable
done

echo "rebuilding both mechanisms for steady-state measurement"
psql_c 'SELECT reconcile_item_stock_quantities();' >/dev/null
psql_c 'REFRESH MATERIALIZED VIEW "_bench_stock_matview";' >/dev/null
psql_c 'ANALYZE "itemLedger";' >/dev/null
psql_c 'ANALYZE "itemStockQuantities";' >/dev/null

psql_c 'SELECT count(*) || E'"'"' rows, '"'"' || pg_size_pretty(pg_total_relation_size('"'"'"itemLedger"'"'"')) FROM "itemLedger";'
