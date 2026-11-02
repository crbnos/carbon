// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getPurchaseOrderDisplayId } from "@carbon/documents/utils";
import { Button, HStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { Fragment, memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuContainer,
  LuHandCoins,
  LuHash,
  LuMapPin,
  LuTruck
} from "react-icons/lu";
import { Link, useNavigation } from "react-router";
import {
  DateTime,
  exportOnlyColumn,
  Highlight as HighlightRanges,
  Hyperlink,
  ItemThumbnail,
  RevisionSuffix,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { usePermissions, useQuantityFormatter, useUrlParams } from "~/hooks";
import {
  receivingSearchMatches,
  receivingSearchTerms
} from "~/modules/inventory/inventory.utils";
import type {
  ReceivingDraftReceipt,
  ReceivingOrder,
  ReceivingRow
} from "~/modules/inventory/types";
import { usePurchaseOrder } from "~/modules/purchasing/ui/PurchaseOrder/usePurchaseOrder";
import type { ItemType } from "~/modules/shared/types";
import { useSuppliers } from "~/stores";
import { path } from "~/utils/path";

type ReceivingTableProps = {
  rows: ReceivingRow[];
  /** The loader read its line limit: more orders may match. */
  isTruncated: boolean;
  draftReceiptByOrder: Record<string, ReceivingDraftReceipt>;
};

/** One row of the table: an order, with its lines to receive. */
type ReceivingOrderRow = {
  id: string;
  purchaseOrderReadableId: string | null;
  revisionId: number | null;
  supplierId: string | null;
  supplierName: string | null;
  orderDate: string | null;
  supplierReference: string | null;
  trackingNumber: string | null;
  /** The first line's, for the Location filter; the cell lists every line's. */
  locationId: string | null;
  locationIds: string[];
  lines: ReceivingRow[];
};

/** The lines grouped by order, in the loader's order (oldest order first). */
function toOrderRows(rows: ReceivingRow[]): ReceivingOrderRow[] {
  const orders = new Map<string, ReceivingOrderRow>();
  for (const line of rows) {
    const order = orders.get(line.purchaseOrderId);
    if (order) {
      order.lines.push(line);
      if (line.locationId && !order.locationIds.includes(line.locationId)) {
        order.locationIds.push(line.locationId);
      }
      continue;
    }
    orders.set(line.purchaseOrderId, {
      id: line.purchaseOrderId,
      purchaseOrderReadableId: line.purchaseOrderReadableId,
      revisionId: line.revisionId,
      supplierId: line.supplierId,
      supplierName: line.supplierName,
      orderDate: line.orderDate,
      supplierReference: line.supplierReference,
      trackingNumber: line.trackingNumber,
      locationId: line.locationId,
      locationIds: line.locationId ? [line.locationId] : [],
      lines: [line]
    });
  }
  return [...orders.values()];
}

/** "PO000036-1": the order's readable id with its revision. */
function readableOrderId(order: ReceivingOrderRow) {
  return getPurchaseOrderDisplayId({
    purchaseOrderId: order.purchaseOrderReadableId,
    revisionId: order.revisionId
  });
}

/** `text` with every part a search word matched marked. */
function Highlight({ text, terms }: { text: string | null; terms: string[] }) {
  return (
    <HighlightRanges
      text={text}
      ranges={text ? receivingSearchMatches(text, terms) : []}
    />
  );
}

/** "Also open on PO000037, PO000040", each order linked. The links are one
 *  placeholder, so a translation can put them where its grammar needs. */
function AlsoOpenOn({ orders }: { orders: ReceivingOrder[] }) {
  const links = orders.map((order, index) => (
    <Fragment key={order.id}>
      {index > 0 && ", "}
      <Link
        to={path.to.purchaseOrderDetails(order.id)}
        className="hover:underline"
      >
        {order.readableId}
        <RevisionSuffix revisionId={order.revisionId} />
      </Link>
    </Fragment>
  ));
  return <Trans>Also open on {links}</Trans>;
}

/** One row per order, its lines in the expanded row, which is always open. */
const ReceivingTable = memo(
  ({ rows, isTruncated, draftReceiptByOrder }: ReceivingTableProps) => {
    const { t } = useLingui();
    const [params] = useUrlParams();
    const formatQuantity = useQuantityFormatter();
    const locations = useLocations();
    const [suppliers] = useSuppliers();

    const search = params.get("search");
    const terms = useMemo(() => receivingSearchTerms(search), [search]);

    const orders = useMemo(() => toOrderRows(rows), [rows]);

    const columns = useMemo<ColumnDef<ReceivingOrderRow>[]>(
      () => [
        {
          accessorKey: "purchaseOrderReadableId",
          header: t`Purchase Order`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.purchaseOrderDetails(row.original.id)}>
              <div className="flex flex-col gap-0">
                <span className="text-sm font-medium">
                  <Highlight
                    text={row.original.purchaseOrderReadableId}
                    terms={terms}
                  />
                  <RevisionSuffix revisionId={row.original.revisionId} />
                </span>
                <span className="text-xs text-muted-foreground">
                  <Highlight text={row.original.supplierName} terms={terms} />
                </span>
              </div>
            </Hyperlink>
          ),
          meta: {
            mobile: "P1",
            icon: <LuBookMarked />,
            exportValue: (row) => readableOrderId(row)
          }
        },
        {
          accessorKey: "orderDate",
          header: t`Ordered`,
          cell: ({ row }) => (
            <DateTime value={row.original.orderDate} variant="date" />
          ),
          meta: {
            mobile: "P2",
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "supplierReference",
          header: t`Supplier Reference`,
          cell: ({ row }) => (
            <span className="whitespace-nowrap">
              <Highlight text={row.original.supplierReference} terms={terms} />
            </span>
          ),
          meta: {
            icon: <LuHash />
          }
        },
        {
          accessorKey: "trackingNumber",
          header: t`Tracking`,
          cell: ({ row }) => (
            <span className="whitespace-nowrap">
              <Highlight text={row.original.trackingNumber} terms={terms} />
            </span>
          ),
          meta: {
            icon: <LuTruck />
          }
        },
        {
          accessorKey: "locationId",
          header: t`Location`,
          cell: ({ row }) => (
            <HStack spacing={1}>
              {row.original.locationIds.map((locationId) => (
                <Enumerable
                  key={locationId}
                  value={
                    locations.find((option) => option.value === locationId)
                      ?.label ?? null
                  }
                />
              ))}
            </HStack>
          ),
          meta: {
            icon: <LuMapPin />,
            filter: {
              type: "static",
              options: locations.map((location) => ({
                value: location.value,
                label: <Enumerable value={location.label} />
              }))
            },
            exportValue: (row) =>
              row.locationIds
                .map(
                  (locationId) =>
                    locations.find((option) => option.value === locationId)
                      ?.label ?? locationId
                )
                .join(", ")
          }
        },
        {
          accessorKey: "supplierId",
          header: t`Supplier`,
          cell: ({ row }) => row.original.supplierName,
          meta: {
            icon: <LuContainer />,
            filter: {
              type: "static",
              options: (suppliers ?? []).map((supplier) => ({
                value: supplier.id,
                label: supplier.name
              }))
            },
            exportValue: (row) => row.supplierName
          }
        },
        {
          id: "receive",
          header: () => <span className="sr-only">{t`Receipt`}</span>,
          cell: ({ row }) => (
            <ReceiveButton
              purchaseOrderId={row.original.id}
              draftReceipt={draftReceiptByOrder[row.original.id]}
            />
          ),
          enableSorting: false,
          meta: {
            mobile: "P3",
            filterHeader: t`Receipt`
          }
        },
        // The lines are the expanded row, which the CSV cannot carry.
        exportOnlyColumn<ReceivingOrderRow>({
          id: "lines",
          header: t`Lines`,
          value: (row) =>
            row.lines
              .map((line) =>
                `${line.itemReadableId ?? line.description ?? ""} × ${formatQuantity(
                  line.quantityToReceive ?? 0
                )} ${line.purchaseUnitOfMeasureCode ?? ""}`.trim()
              )
              .join("; ")
        })
      ],
      [t, terms, formatQuantity, locations, suppliers, draftReceiptByOrder]
    );

    const renderExpandedRow = useCallback(
      (order: ReceivingOrderRow) => (
        <div className="pl-[52px] pr-4">
          {order.lines.map((line) => {
            const name = line.itemName ?? line.description;
            return (
              <div key={line.id} className="flex gap-3 py-2 text-sm">
                <div
                  aria-hidden
                  className="w-5 shrink-0 border-l border-border -my-2"
                />
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <ItemThumbnail
                    size="sm"
                    thumbnailPath={line.thumbnailPath}
                    type={(line.itemType as ItemType | null) ?? undefined}
                  />
                  <div className="flex min-w-0 flex-col gap-0">
                    <HStack spacing={2} className="min-w-0">
                      <Hyperlink
                        to={path.to.purchaseOrderLine(
                          line.purchaseOrderId,
                          line.id
                        )}
                      >
                        <span className="whitespace-nowrap font-medium">
                          <Highlight text={line.itemReadableId} terms={terms} />
                        </span>
                      </Hyperlink>
                      {line.supplierPartId && (
                        <span className="whitespace-nowrap text-xs text-muted-foreground">
                          <Highlight text={line.supplierPartId} terms={terms} />
                        </span>
                      )}
                    </HStack>
                    <span className="truncate text-xs text-muted-foreground">
                      <Highlight text={name} terms={terms} />
                      {line.description && line.description !== name && (
                        <>
                          {" · "}
                          <Highlight text={line.description} terms={terms} />
                        </>
                      )}
                    </span>
                    {line.alsoOpenOn.length > 0 && (
                      <span className="truncate text-xs text-muted-foreground">
                        <AlsoOpenOn orders={line.alsoOpenOn} />
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-6 tabular-nums">
                  {line.purchaseQuantity !== null && (
                    <span className="whitespace-nowrap text-muted-foreground">
                      <Trans>Ordered</Trans>{" "}
                      {formatQuantity(line.purchaseQuantity)}{" "}
                      {line.purchaseUnitOfMeasureCode}
                    </span>
                  )}
                  <span className="whitespace-nowrap">
                    <span className="text-muted-foreground">
                      <Trans>To Receive</Trans>
                    </span>{" "}
                    <span className="font-medium">
                      {formatQuantity(line.quantityToReceive ?? 0)}
                    </span>
                  </span>
                  <span className="w-24 text-right text-muted-foreground">
                    <DateTime value={line.promisedDate} variant="date" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ),
      [terms, formatQuantity]
    );

    return (
      <Table<ReceivingOrderRow>
        data={orders}
        columns={columns}
        count={orders.length}
        title={t`Receiving`}
        getRowId={(row) => row.id}
        defaultColumnPinning={{ right: ["receive"] }}
        defaultColumnVisibility={{
          supplierId: false
        }}
        renderExpandedRow={renderExpandedRow}
        pinExpandedRows
        expandRowsFor={search || true}
        isTruncated={isTruncated}
        rowLimitNote={
          <Trans>
            Showing the oldest orders only. Search or filter to see the rest.
          </Trans>
        }
        withSimpleSorting={false}
        sort={null}
        // The search is the page: keep the toolbar when nothing matches.
        isFiltered
        emptyState={
          <p className="text-sm text-muted-foreground">
            {search ? (
              <Trans>
                No open purchase order lines match your search. Every word must
                match; spaces and punctuation are ignored.
              </Trans>
            ) : (
              <Trans>No purchase orders are waiting to be received.</Trans>
            )}
          </p>
        }
      />
    );
  }
);

ReceivingTable.displayName = "ReceivingTable";

export default ReceivingTable;

/** Receive the order, or open the Draft receipt already started for it. */
function ReceiveButton({
  purchaseOrderId,
  draftReceipt
}: {
  purchaseOrderId: string;
  draftReceipt: ReceivingDraftReceipt | undefined;
}) {
  const permissions = usePermissions();
  const navigation = useNavigation();
  const { receive } = usePurchaseOrder();

  const isReceiving =
    navigation.state !== "idle" &&
    navigation.formAction === path.to.newReceipt &&
    navigation.formData?.get("sourceDocumentId") === purchaseOrderId;

  if (draftReceipt) {
    return (
      <Button asChild size="sm" variant="secondary" leftIcon={<LuHandCoins />}>
        <Link
          to={path.to.receiptDetails(draftReceipt.id)}
          onClick={(e) => e.stopPropagation()}
        >
          {draftReceipt.receiptId}
        </Link>
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="secondary"
      leftIcon={<LuHandCoins />}
      isLoading={isReceiving}
      isDisabled={
        !permissions.can("create", "inventory") || navigation.state !== "idle"
      }
      onClick={(e) => {
        e.stopPropagation();
        receive({ id: purchaseOrderId });
      }}
    >
      <Trans>Receive</Trans>
    </Button>
  );
}
