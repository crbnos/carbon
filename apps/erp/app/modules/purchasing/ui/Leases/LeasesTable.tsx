// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuCalendarClock,
  LuDollarSign,
  LuHash,
  LuLandmark,
  LuPencil,
  LuScale,
  LuStar,
  LuTag,
  LuTrash,
  LuTruck
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, New, SupplierAvatar, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import Money from "~/components/Money";
import { useDateFormatter, usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import { leaseStatuses, lesseeClassifications } from "../../purchasing.models";
import LeaseStatus from "./LeaseStatus";
import { useLesseeClassificationLabel } from "./LesseeClassificationBadge";
import type { Lease } from "./types";

type LeasesTableProps = {
  data: Lease[];
  count: number;
};

const LeasesTable = memo(({ data, count }: LeasesTableProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { formatDate } = useDateFormatter();
  const [suppliers] = useSuppliers();
  const classificationLabel = useLesseeClassificationLabel();

  const [selected, setSelected] = useState<Lease | null>(null);
  const deleteModal = useDisclosure();

  const customColumns = useCustomColumns<Lease>("lease");

  const columns = useMemo<ColumnDef<Lease>[]>(() => {
    const defaultColumns: ColumnDef<Lease>[] = [
      {
        accessorKey: "leaseId",
        header: t`Lease`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.lease(row.original.id!)}>
            {row.original.leaseId}
          </Hyperlink>
        ),
        meta: {
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "name",
        header: t`Name`,
        cell: (item) => (
          <span className="line-clamp-1">{item.getValue<string>()}</span>
        ),
        meta: {
          icon: <LuTag />
        }
      },
      {
        accessorKey: "supplierId",
        header: t`Supplier`,
        cell: ({ row }) => (
          <SupplierAvatar supplierId={row.original.supplierId} />
        ),
        meta: {
          filter: {
            type: "static",
            options: suppliers?.map((supplier) => ({
              value: supplier.id,
              label: supplier.name
            }))
          },
          icon: <LuTruck />,
          exportValue: (row: Lease) => row.supplierName ?? row.supplierId
        }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => <LeaseStatus status={row.original.status} />,
        meta: {
          filter: {
            type: "static",
            options: leaseStatuses.map((status) => ({
              value: status,
              label: <LeaseStatus status={status} />
            }))
          },
          pluralHeader: t`Statuses`,
          icon: <LuStar />
        }
      },
      {
        accessorKey: "classification",
        header: t`Classification`,
        cell: (item) => {
          const value = item.getValue<string | null>();
          return value === "Mixed"
            ? t`Varies by asset`
            : value
              ? classificationLabel(value)
              : "—";
        },
        meta: {
          filter: {
            type: "static",
            options: [
              ...lesseeClassifications.map((value) => ({
                value,
                label: classificationLabel(value)
              })),
              { value: "Mixed", label: t`Varies by asset` }
            ]
          },
          icon: <LuScale />
        }
      },
      {
        accessorKey: "assetCount",
        header: t`Assets`,
        cell: (item) => (
          <span className="tabular-nums">{item.getValue<number>() ?? 0}</span>
        ),
        meta: {
          icon: <LuHash />
        }
      },
      {
        accessorKey: "commencementDate",
        header: t`Commencement`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "endDate",
        header: t`End`,
        cell: (item) => {
          const value = item.getValue<string | null>();
          return value ? formatDate(value) : t`Open-ended`;
        },
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "paymentAmount",
        header: t`Payment`,
        cell: ({ row }) => (
          <Money
            value={row.original.paymentAmount}
            currencyCode={row.original.currencyCode}
          />
        ),
        meta: {
          icon: <LuDollarSign />
        }
      },
      {
        accessorKey: "currentLiability",
        header: t`Liability`,
        cell: ({ row }) => (
          <Money
            value={row.original.currentLiability}
            currencyCode={row.original.currencyCode}
          />
        ),
        meta: {
          icon: <LuLandmark />
        }
      },
      {
        accessorKey: "nextDueDate",
        header: t`Next Due`,
        cell: (item) => formatDate(item.getValue<string>()) || "—",
        meta: {
          icon: <LuCalendarClock />
        }
      },
      {
        accessorKey: "createdAt",
        header: t`Created At`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      }
    ];

    return [...defaultColumns, ...customColumns];
  }, [classificationLabel, customColumns, formatDate, suppliers, t]);

  const renderContextMenu = useMemo(() => {
    return (row: Lease) => (
      <>
        <MenuItem
          disabled={!permissions.can("view", "purchasing")}
          onClick={() => {
            navigate(path.to.lease(row.id!));
          }}
        >
          <MenuIcon icon={<LuPencil />} />
          <Trans>Edit</Trans>
        </MenuItem>
        <MenuItem
          disabled={
            !permissions.can("delete", "purchasing") || row.status !== "Draft"
          }
          destructive
          onClick={() => {
            setSelected(row);
            deleteModal.onOpen();
          }}
        >
          <MenuIcon icon={<LuTrash />} />
          <Trans>Delete</Trans>
        </MenuItem>
      </>
    );
  }, [deleteModal, navigate, permissions]);

  return (
    <>
      <Table<Lease>
        count={count}
        columns={columns}
        data={data}
        defaultColumnPinning={{
          left: ["leaseId"]
        }}
        primaryAction={
          permissions.can("create", "purchasing") && (
            <New label={t`Lease`} to={path.to.newLease} />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Leases`}
        table="lease"
        withSavedView
      />

      {selected?.id && (
        <ConfirmDelete
          action={path.to.deleteLease(selected.id)}
          isOpen={deleteModal.isOpen}
          name={selected.leaseId ?? ""}
          text={t`Are you sure you want to delete ${selected.leaseId ?? ""}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
            setSelected(null);
          }}
          onSubmit={() => {
            deleteModal.onClose();
            setSelected(null);
          }}
        />
      )}
    </>
  );
});
LeasesTable.displayName = "LeasesTable";

export default LeasesTable;
