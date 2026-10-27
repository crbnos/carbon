// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getPurchaseOrderDisplayId } from "@carbon/documents/utils";
import { Button, Copy, HStack, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { Fragment, memo, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuContainer,
  LuHandCoins,
  LuHash,
  LuMapPin,
  LuText
} from "react-icons/lu";
import { Link, useNavigation } from "react-router";
import {
  DateTime,
  exportOnlyColumn,
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
  count: number;
  draftReceiptByOrder: Record<string, ReceivingDraftReceipt>;
};

/** "PO000036-1": the order's readable id with its revision. */
function readableOrderId(row: ReceivingRow) {
  return getPurchaseOrderDisplayId({
    purchaseOrderId: row.purchaseOrderReadableId,
    revisionId: row.revisionId
  });
}

/** `text` with every part a search word matched marked. */
function Highlight({ text, terms }: { text: string | null; terms: string[] }) {
  if (!text) return null;
  const ranges = receivingSearchMatches(text, terms);
  if (ranges.length === 0) return <>{text}</>;

  const parts: JSX.Element[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) {
      parts.push(<Fragment key={cursor}>{text.slice(cursor, start)}</Fragment>);
    }
    parts.push(
      <mark
        key={start}
        className="bg-yellow-200 dark:bg-yellow-900/50 text-inherit rounded-sm"
      >
        {text.slice(start, end)}
      </mark>
    );
    cursor = end;
  }
  if (cursor < text.length) {
    parts.push(<Fragment key={cursor}>{text.slice(cursor)}</Fragment>);
  }
  return <>{parts}</>;
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

const ReceivingTable = memo(
  ({ rows, count, draftReceiptByOrder }: ReceivingTableProps) => {
    const { t } = useLingui();
    const [params] = useUrlParams();
    const formatQuantity = useQuantityFormatter();
    const locations = useLocations();
    const [suppliers] = useSuppliers();

    const search = params.get("search");
    const terms = useMemo(() => receivingSearchTerms(search), [search]);

    const groupRowsBy = useMemo(
      () => ({
        key: (row: ReceivingRow) => row.purchaseOrderId,
        header: (group: ReceivingRow[]) => (
          <ReceivingOrderHeader
            row={group[0]!}
            terms={terms}
            draftReceipt={draftReceiptByOrder[group[0]!.purchaseOrderId]}
          />
        )
      }),
      [terms, draftReceiptByOrder]
    );

    const columns = useMemo<ColumnDef<ReceivingRow>[]>(
      () => [
        {
          accessorKey: "itemReadableId",
          header: t`Part`,
          cell: ({ row }) => (
            <HStack className="min-w-0">
              <ItemThumbnail
                size="sm"
                thumbnailPath={row.original.thumbnailPath}
                type={(row.original.itemType as ItemType | null) ?? undefined}
              />
              <Hyperlink
                to={path.to.purchaseOrderLine(
                  row.original.purchaseOrderId,
                  row.original.id
                )}
              >
                <span className="whitespace-nowrap">
                  <Highlight text={row.original.itemReadableId} terms={terms} />
                </span>
              </Hyperlink>
            </HStack>
          ),
          meta: {
            mobile: "P1",
            icon: <LuBookMarked />
          }
        },
        {
          id: "name",
          header: t`Name`,
          cell: ({ row }) => {
            const name = row.original.itemName ?? row.original.description;
            const { alsoOpenOn } = row.original;
            return (
              <VStack spacing={0} className="min-w-0 max-w-[360px]">
                <span className="truncate w-full">
                  <Highlight text={name} terms={terms} />
                </span>
                {row.original.description &&
                  row.original.description !== name && (
                    <span className="text-xs text-muted-foreground truncate w-full">
                      <Highlight
                        text={row.original.description}
                        terms={terms}
                      />
                    </span>
                  )}
                {alsoOpenOn.length > 0 && (
                  <span className="text-xs text-muted-foreground truncate w-full">
                    <AlsoOpenOn orders={alsoOpenOn} />
                  </span>
                )}
              </VStack>
            );
          },
          meta: {
            mobile: "P2",
            icon: <LuText />,
            exportValue: (row) => row.itemName ?? row.description
          }
        },
        {
          accessorKey: "supplierPartId",
          header: t`Supplier Part`,
          cell: ({ row }) => (
            <span className="whitespace-nowrap">
              <Highlight text={row.original.supplierPartId} terms={terms} />
            </span>
          ),
          meta: {
            icon: <LuHash />
          }
        },
        {
          accessorKey: "purchaseQuantity",
          header: t`Ordered`,
          cell: ({ row }) =>
            row.original.purchaseQuantity === null ? null : (
              <span className="whitespace-nowrap tabular-nums">
                {formatQuantity(row.original.purchaseQuantity)}{" "}
                <span className="text-muted-foreground">
                  {row.original.purchaseUnitOfMeasureCode}
                </span>
              </span>
            ),
          meta: {
            icon: <LuHash />
          }
        },
        {
          accessorKey: "quantityReceived",
          header: t`Received`,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {formatQuantity(row.original.quantityReceived ?? 0)}
            </span>
          ),
          meta: {
            icon: <LuHash />
          }
        },
        {
          accessorKey: "quantityToReceive",
          header: t`To Receive`,
          cell: ({ row }) => (
            <span className="tabular-nums font-medium">
              {formatQuantity(row.original.quantityToReceive ?? 0)}
            </span>
          ),
          meta: {
            mobile: "P3",
            icon: <LuHash />
          }
        },
        {
          accessorKey: "promisedDate",
          header: t`Promised`,
          cell: ({ row }) => (
            <DateTime value={row.original.promisedDate} variant="date" />
          ),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "locationId",
          header: t`Location`,
          cell: ({ row }) => {
            const location = locations.find(
              (option) => option.value === row.original.locationId
            );
            return location ? <Enumerable value={location.label} /> : null;
          },
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
              locations.find((option) => option.value === row.locationId)
                ?.label ?? row.locationId
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
        // The order each line is grouped under — the band above the rows,
        // which the CSV has no other way to carry.
        exportOnlyColumn<ReceivingRow>({
          id: "purchaseOrderReadableId",
          header: t`Purchase Order`,
          value: (row) => readableOrderId(row)
        }),
        exportOnlyColumn<ReceivingRow>({
          id: "supplierReference",
          header: t`Supplier Reference`,
          value: (row) => row.supplierReference
        })
      ],
      [t, terms, formatQuantity, locations, suppliers]
    );

    return (
      <Table<ReceivingRow>
        data={rows}
        columns={columns}
        count={count}
        title={t`Receiving`}
        getRowId={(row) => row.id}
        defaultColumnPinning={{ left: ["itemReadableId"] }}
        defaultColumnVisibility={{
          quantityReceived: false,
          supplierId: false
        }}
        groupRowsBy={groupRowsBy}
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

/** The band above each order's lines: who it is from, and how to receive it. */
function ReceivingOrderHeader({
  row,
  terms,
  draftReceipt
}: {
  row: ReceivingRow;
  terms: string[];
  /** A Draft receipt already started for the order: opened, not doubled. */
  draftReceipt: ReceivingDraftReceipt | undefined;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigation = useNavigation();
  const { receive } = usePurchaseOrder();

  const purchaseOrderId = row.purchaseOrderId;
  const displayId = readableOrderId(row);
  const isReceiving =
    navigation.state !== "idle" &&
    navigation.formAction === path.to.newReceipt &&
    navigation.formData?.get("sourceDocumentId") === purchaseOrderId;

  // The order on the left, its receipt on the right.
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <HStack spacing={1} className="shrink-0">
          <Link
            to={path.to.purchaseOrderDetails(purchaseOrderId)}
            className="whitespace-nowrap text-sm font-medium hover:underline"
          >
            <Highlight text={row.purchaseOrderReadableId} terms={terms} />
            <RevisionSuffix revisionId={row.revisionId} />
          </Link>
          <Copy text={displayId} label={t`Copy purchase order number`} />
        </HStack>
        <span className="min-w-0 truncate text-sm">
          <Highlight text={row.supplierName} terms={terms} />
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          {row.orderDate && (
            <span className="whitespace-nowrap">
              <Trans>Ordered</Trans>{" "}
              <DateTime value={row.orderDate} variant="date" />
            </span>
          )}
          {row.supplierReference && (
            <span className="whitespace-nowrap">
              <Trans>Reference</Trans>{" "}
              <span className="text-foreground">
                <Highlight text={row.supplierReference} terms={terms} />
              </span>
            </span>
          )}
          {row.trackingNumber && (
            <span className="whitespace-nowrap">
              <Trans>Tracking</Trans>{" "}
              <span className="text-foreground">
                <Highlight text={row.trackingNumber} terms={terms} />
              </span>
            </span>
          )}
        </span>
      </div>
      {draftReceipt ? (
        <Button
          asChild
          size="sm"
          variant="secondary"
          leftIcon={<LuHandCoins />}
          className="shrink-0"
        >
          <Link to={path.to.receiptDetails(draftReceipt.id)}>
            {draftReceipt.receiptId}
          </Link>
        </Button>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<LuHandCoins />}
          className="shrink-0"
          isLoading={isReceiving}
          isDisabled={
            !permissions.can("create", "inventory") ||
            navigation.state !== "idle"
          }
          onClick={() => receive({ id: purchaseOrderId })}
        >
          <Trans>Receive</Trans>
        </Button>
      )}
    </div>
  );
}
