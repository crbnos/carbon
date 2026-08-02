import { memo } from "react";
import {
  LuArrowRightLeft,
  LuExternalLink,
  LuMoveDown,
  LuMoveUp
} from "react-icons/lu";
import { Link } from "react-router";
import Activity from "~/components/Activity";
import { path } from "~/utils/path";
import type { ItemLedger } from "../../types";

// A Direct Transfer writes two ledger rows in one transaction — the negative
// out of the source bin and the positive into the destination — so the feed
// renders the same move twice. Collapse each pair into the inbound row and hang
// the source bin off it.
//
// The pair is identified by document + item + tracked entity + `createdAt`:
// Postgres NOW() is transaction time, so both rows share it exactly. Keying on
// the timestamp keeps repeat picks of the same line as separate entries, and
// makes the merge idempotent, so it's safe to re-run over the accumulated list
// as infinite scroll appends pages.
export type CollapsedItemLedger = ItemLedger & {
  transferFromStorageUnitName?: string | null;
};

export function collapseTransferPairs(
  rows: ItemLedger[]
): CollapsedItemLedger[] {
  const pairKey = (row: ItemLedger) =>
    [row.documentId, row.itemId, row.trackedEntityId ?? "", row.createdAt].join(
      "|"
    );

  const outboundByKey = new Map<string, ItemLedger>();
  for (const row of rows) {
    if (row.documentType !== "Direct Transfer" || row.quantity >= 0) continue;
    outboundByKey.set(pairKey(row), row);
  }

  return rows.reduce<CollapsedItemLedger[]>((acc, row) => {
    if (row.documentType !== "Direct Transfer") return [...acc, row];
    const outbound = outboundByKey.get(pairKey(row));
    // Drop the outbound half only when its inbound partner is present to
    // absorb it — otherwise (destination page not loaded yet) keep it, so a
    // transfer never vanishes from the feed.
    if (row.quantity < 0) {
      const hasInbound = rows.some(
        (r) =>
          r.documentType === "Direct Transfer" &&
          r.quantity > 0 &&
          pairKey(r) === pairKey(row)
      );
      return hasInbound ? acc : [...acc, row];
    }
    return [
      ...acc,
      {
        ...row,
        transferFromStorageUnitName: outbound?.storageUnit?.name ?? null
      }
    ];
  }, []);
}

const getActivityText = (ledgerRecord: CollapsedItemLedger) => {
  // Prefer the entity's readable serial/batch number; fall back to the raw
  // tracked-entity id when it has none (e.g. unnumbered receipt batches).
  const trackedEntityLabel =
    ledgerRecord.trackedEntity?.readableId || ledgerRecord.trackedEntityId;

  switch (ledgerRecord.documentType) {
    case "Purchase Receipt":
      return `received ${ledgerRecord.quantity} units${
        ledgerRecord.storageUnit?.name
          ? ` to ${ledgerRecord.storageUnit.name}`
          : ""
      }${
        trackedEntityLabel
          ? ` from ${
              Math.abs(ledgerRecord.quantity) > 1 ? "batch" : "serial"
            } ${trackedEntityLabel}`
          : ""
      }`;
    case "Purchase Invoice":
      return `invoiced ${ledgerRecord.quantity} units${
        ledgerRecord.storageUnit?.name
          ? ` on ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Sales Shipment":
      return `shipped ${-1 * ledgerRecord.quantity} units${
        ledgerRecord.storageUnit?.name
          ? ` from ${ledgerRecord.storageUnit.name}`
          : ""
      }${
        trackedEntityLabel
          ? ` of ${Math.abs(ledgerRecord.quantity) > 1 ? "batch" : "serial"} ${trackedEntityLabel}`
          : ""
      }`;
    case "Sales Invoice":
      return `invoiced ${ledgerRecord.quantity} units for sale${
        ledgerRecord.storageUnit?.name
          ? ` from ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Transfer Shipment":
      return `shipped ${-1 * ledgerRecord.quantity} units${
        ledgerRecord.storageUnit?.name
          ? ` from ${ledgerRecord.storageUnit.name}`
          : ""
      } for transfer`;
    case "Transfer Receipt":
      return `received ${ledgerRecord.quantity} units${
        ledgerRecord.storageUnit?.name
          ? ` to ${ledgerRecord.storageUnit.name}`
          : ""
      } from transfer`;
    case "Direct Transfer": {
      // Collapsed rows carry both ends; an uncollapsed half names only its own.
      const from =
        ledgerRecord.quantity > 0
          ? ledgerRecord.transferFromStorageUnitName
          : ledgerRecord.storageUnit?.name;
      const to =
        ledgerRecord.quantity > 0 ? ledgerRecord.storageUnit?.name : null;
      return `transferred ${Math.abs(ledgerRecord.quantity)} units${
        from ? ` from ${from}` : ""
      }${to ? ` to ${to}` : ""}`;
    }
    case "Inventory Receipt":
      return `received ${ledgerRecord.quantity} units into inventory${
        ledgerRecord.storageUnit?.name
          ? ` on ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Inventory Shipment":
      return `shipped ${-1 * ledgerRecord.quantity} units from inventory${
        ledgerRecord.storageUnit?.name
          ? ` from ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Posted Assembly":
      return `assembled ${ledgerRecord.quantity} units${
        ledgerRecord.storageUnit?.name
          ? ` on ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Purchase Credit Memo":
      return `credited ${ledgerRecord.quantity} units for purchase${
        ledgerRecord.storageUnit?.name
          ? ` on ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Purchase Return Shipment":
      return `returned ${ledgerRecord.quantity} units to supplier${
        ledgerRecord.storageUnit?.name
          ? ` from ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Sales Credit Memo":
      return `credited ${ledgerRecord.quantity} units for sale${
        ledgerRecord.storageUnit?.name
          ? ` on ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Sales Return Receipt":
      return `received ${ledgerRecord.quantity} units as sales return${
        ledgerRecord.storageUnit?.name
          ? ` to ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Service Credit Memo":
      return `credited ${ledgerRecord.quantity} units for service${
        ledgerRecord.storageUnit?.name
          ? ` on ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Service Invoice":
      return `invoiced ${ledgerRecord.quantity} units for service${
        ledgerRecord.storageUnit?.name
          ? ` from ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Service Shipment":
      return `shipped ${-1 * ledgerRecord.quantity} units for service${
        ledgerRecord.storageUnit?.name
          ? ` from ${ledgerRecord.storageUnit.name}`
          : ""
      }`;
    case "Job Consumption":
      return (
        <span>
          issued {-1 * ledgerRecord.quantity} units{" "}
          {ledgerRecord.storageUnit?.name
            ? `from ${ledgerRecord.storageUnit.name} `
            : ""}
          {trackedEntityLabel ? (
            <>
              from {Math.abs(ledgerRecord.quantity) > 1 ? "batch" : "serial"}{" "}
              {trackedEntityLabel}{" "}
            </>
          ) : null}
          {ledgerRecord.documentLineId && ledgerRecord.documentId ? (
            <>
              to a{" "}
              <Link
                className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary"
                to={`${path.to.jobProductionEvents(
                  ledgerRecord.documentId!
                )}?filter=jobOperationId:eq:${ledgerRecord.documentLineId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>job operation</span>
                <LuExternalLink className="size-3.5" />
              </Link>
            </>
          ) : ledgerRecord.documentId ? (
            <>
              to a{" "}
              <Link
                className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary"
                to={path.to.jobDetails(ledgerRecord.documentId!)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>job</span>
                <LuExternalLink className="size-3.5" />
              </Link>
            </>
          ) : null}
        </span>
      );
    case "Maintenance Consumption":
      return (
        <span>
          issued {-1 * ledgerRecord.quantity} units{" "}
          {ledgerRecord.storageUnit?.name
            ? `from ${ledgerRecord.storageUnit.name} `
            : ""}
          {trackedEntityLabel ? (
            <>
              from {Math.abs(ledgerRecord.quantity) > 1 ? "batch" : "serial"}{" "}
              {trackedEntityLabel}{" "}
            </>
          ) : null}
          {ledgerRecord.documentId ? (
            <>
              to a{" "}
              <Link
                className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary"
                to={path.to.maintenanceDispatch(ledgerRecord.documentId!)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>maintenance dispatch</span>
                <LuExternalLink className="size-3.5" />
              </Link>
            </>
          ) : null}
        </span>
      );
    case "Job Receipt":
      return (
        <>
          <span>
            received {ledgerRecord.quantity} units
            {ledgerRecord.storageUnit?.name
              ? ` to ${ledgerRecord.storageUnit.name}`
              : ""}{" "}
            from a
          </span>{" "}
          <Link
            className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary"
            to={path.to.jobDetails(ledgerRecord.documentId!)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>job</span>
            <LuExternalLink className="size-3.5" />
          </Link>
        </>
      );
    default:
      break;
  }

  switch (ledgerRecord.entryType) {
    case "Positive Adjmt.":
      return `made a positive adjustment of ${ledgerRecord.quantity}${
        ledgerRecord.storageUnit?.name
          ? ` to ${ledgerRecord.storageUnit?.name}`
          : ""
      }${
        trackedEntityLabel
          ? ` for ${Math.abs(ledgerRecord.quantity) > 1 ? "batch" : "serial"} ${trackedEntityLabel}`
          : ""
      }`;
    case "Negative Adjmt.":
      return `made a negative adjustment of ${-1 * ledgerRecord.quantity}${
        ledgerRecord.storageUnit?.name
          ? ` to ${ledgerRecord.storageUnit.name}`
          : ""
      }${
        trackedEntityLabel
          ? ` for ${Math.abs(ledgerRecord.quantity) > 1 ? "batch" : "serial"} ${trackedEntityLabel}`
          : ""
      }`;
    default:
      return "";
  }
};

const getActivityIcon = (ledgerRecord: ItemLedger) => {
  switch (ledgerRecord.entryType) {
    case "Transfer":
      return <LuArrowRightLeft className="text-blue-500 text-lg" />;
    case "Positive Adjmt.":
      return <LuMoveUp className="text-emerald-500 text-lg" />;
    case "Negative Adjmt.":
    case "Consumption":
      return <LuMoveDown className="text-red-500 text-lg" />;
    default:
      return "";
  }
};

type InventoryActivityProps = {
  item: CollapsedItemLedger;
  highlightId?: string;
};

const InventoryActivity = memo(
  ({ item, highlightId }: InventoryActivityProps) => {
    return (
      <Activity
        employeeId={item.createdBy}
        activityMessage={getActivityText(item)}
        activityTime={item.createdAt}
        activityIcon={getActivityIcon(item)}
        comment={item.comment}
        highlighted={highlightId === item.id}
      />
    );
  }
);

InventoryActivity.displayName = "InventoryActivity";

export default InventoryActivity;
