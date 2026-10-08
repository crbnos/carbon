// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { BarProgress, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuCalendarClock,
  LuDollarSign,
  LuPencil,
  LuSquareUser,
  LuStar,
  LuTag,
  LuText,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { CustomerAvatar, Hyperlink, New, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions
} from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { useCustomers } from "~/stores";
import { path } from "~/utils/path";
import {
  customerContractStatuses,
  customerContractTypes
} from "../../sales.models";
import ContractMoney from "./ContractMoney";
import ContractStatus from "./ContractStatus";
import type { ContractListItem } from "./types";

type ContractsTableProps = {
  data: ContractListItem[];
  count: number;
};

const ContractsTable = memo(({ data, count }: ContractsTableProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { formatDate } = useDateFormatter();
  const [customers] = useCustomers();

  const [selected, setSelected] = useState<ContractListItem | null>(null);
  const deleteModal = useDisclosure();

  const customColumns = useCustomColumns<ContractListItem>("customerContract");

  const columns = useMemo<ColumnDef<ContractListItem>[]>(() => {
    const contractTypeLabels: Record<
      (typeof customerContractTypes)[number],
      string
    > = {
      "New Sales": t`New Sales`,
      Existing: t`Existing`,
      Expansion: t`Expansion`,
      Reactivation: t`Reactivation`,
      Contraction: t`Contraction`
    };

    const defaultColumns: ColumnDef<ContractListItem>[] = [
      {
        accessorKey: "customerContractId",
        header: t`Contract`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.contract(row.original.id!)}>
            <span className="whitespace-nowrap">
              {row.original.customerContractId}
            </span>
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
          icon: <LuText />
        }
      },
      {
        accessorKey: "customerId",
        header: t`Customer`,
        cell: ({ row }) => (
          <CustomerAvatar customerId={row.original.customerId} />
        ),
        meta: {
          filter: {
            type: "static",
            options: customers?.map((customer) => ({
              value: customer.id,
              label: customer.name
            }))
          },
          icon: <LuSquareUser />,
          exportValue: (row: ContractListItem) =>
            row.customerName ?? row.customerId
        }
      },
      {
        accessorKey: "contractType",
        header: t`Type`,
        cell: ({ row }) =>
          row.original.contractType
            ? contractTypeLabels[row.original.contractType]
            : "—",
        meta: {
          filter: {
            type: "static",
            options: customerContractTypes.map((type) => ({
              value: type,
              label: contractTypeLabels[type]
            }))
          },
          icon: <LuTag />
        }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => <ContractStatus status={row.original.status} />,
        meta: {
          filter: {
            type: "static",
            options: customerContractStatuses.map((status) => ({
              value: status,
              label: <ContractStatus status={status} />
            }))
          },
          pluralHeader: t`Statuses`,
          icon: <LuStar />
        }
      },
      {
        accessorKey: "contractValue",
        header: t`Contract Value`,
        cell: ({ row }) =>
          // A Draft's schedule is computed on its page, not stored — the view
          // has nothing to sum until it is confirmed or edited.
          row.original.status === "Draft" &&
          !Number(row.original.contractValue) ? (
            <span>—</span>
          ) : (
            <ContractMoney
              value={row.original.contractValue}
              currencyCode={row.original.currencyCode}
            />
          ),
        meta: {
          icon: <LuDollarSign />
        }
      },
      {
        accessorKey: "invoicedToDate",
        header: t`Invoiced to Date`,
        cell: ({ row }) => (
          <InvoicedProgress
            invoiced={Number(row.original.invoicedToDate ?? 0)}
            total={Number(row.original.contractValue ?? 0)}
            currencyCode={row.original.currencyCode}
          />
        ),
        meta: {
          icon: <LuDollarSign />
        }
      },
      {
        accessorKey: "nextInvoiceDate",
        header: t`Next Invoice`,
        cell: (item) => formatDate(item.getValue<string>()) || "—",
        meta: {
          icon: <LuCalendarClock />
        }
      },
      {
        accessorKey: "endDate",
        header: t`Ends On`,
        cell: (item) =>
          item.getValue<string | null>()
            ? formatDate(item.getValue<string>())
            : t`Open-ended`,
        meta: {
          icon: <LuCalendar />
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
  }, [customers, customColumns, formatDate, t]);

  const renderContextMenu = useMemo(() => {
    return (row: ContractListItem) => (
      <>
        <MenuItem
          disabled={!permissions.can("view", "sales")}
          onClick={() => {
            navigate(path.to.contract(row.id!));
          }}
        >
          <MenuIcon icon={<LuPencil />} />
          <Trans>Edit</Trans>
        </MenuItem>
        <MenuItem
          disabled={
            !permissions.can("delete", "sales") || row.status !== "Draft"
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
      <Table<ContractListItem>
        count={count}
        columns={columns}
        data={data}
        defaultColumnPinning={{
          left: ["customerContractId"]
        }}
        primaryAction={
          permissions.can("create", "sales") && (
            <New label={t`Contract`} to={path.to.newContract} />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Service Contracts`}
        table="customerContract"
        withSavedView
      />

      {selected?.id && (
        <ConfirmDelete
          action={path.to.deleteContract(selected.id)}
          isOpen={deleteModal.isOpen}
          name={selected.customerContractId ?? ""}
          text={t`Are you sure you want to delete ${selected.customerContractId ?? ""}? This cannot be undone.`}
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
ContractsTable.displayName = "ContractsTable";

/** Invoiced to date as a share of the contract value. A Draft with no stored
 *  schedule has no value to measure against, so it shows a dash. */
const InvoicedProgress = ({
  invoiced,
  total,
  currencyCode
}: {
  invoiced: number;
  total: number;
  currencyCode?: string | null;
}) => {
  const formatter = useCurrencyFormatter({
    currency: currencyCode ?? undefined
  });
  if (total <= 0) return <span>—</span>;
  return (
    <BarProgress
      className="min-w-32"
      progress={invoiced}
      max={total}
      value={formatter.format(invoiced)}
    />
  );
};

export default ContractsTable;
