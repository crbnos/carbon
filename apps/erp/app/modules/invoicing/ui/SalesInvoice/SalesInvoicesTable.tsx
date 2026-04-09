import { HStack, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuContainer,
  LuCreditCard,
  LuDollarSign,
  LuPencil,
  LuQrCode,
  LuStar,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  ItemThumbnail,
  New,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { useCurrencyFormatter, usePermissions, useRealtime } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { SalesInvoice } from "~/modules/invoicing";
import { salesInvoiceStatusType } from "~/modules/invoicing";
import { useCustomers, usePeople } from "~/stores";
import { path } from "~/utils/path";
import SalesInvoiceStatus from "./SalesInvoiceStatus";

type SalesInvoicesTableProps = {
  data: SalesInvoice[];
  count: number;
};

const SalesInvoicesTable = memo(({ data, count }: SalesInvoicesTableProps) => {
  useRealtime("salesInvoice", `id=in.(${data.map((d) => d.id).join(",")})`);

  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const currencyFormatter = useCurrencyFormatter();

  const [selectedSalesInvoice, setSelectedSalesInvoice] =
    useState<SalesInvoice | null>(null);
  const closeSalesInvoiceModal = useDisclosure();

  const [people] = usePeople();
  const [customers] = useCustomers();
  const customColumns = useCustomColumns<SalesInvoice>("salesInvoice");

  const columns = useMemo<ColumnDef<SalesInvoice>[]>(() => {
    const defaultColumns: ColumnDef<SalesInvoice>[] = [
      {
        accessorKey: "invoiceId",
        header: t`Invoice Number`,
        cell: ({ row }) => (
          <HStack>
            <ItemThumbnail
              size="sm"
              thumbnailPath={row.original.thumbnailPath}
              // @ts-ignore
              type={row.original.itemType || "Part"}
            />
            <Hyperlink to={path.to.salesInvoiceDetails(row.original.id!)}>
              {row.original?.invoiceId}
            </Hyperlink>
          </HStack>
        ),
        meta: {
          icon: <LuBookMarked />
        }
      },
      {
        id: "customerId",
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
          icon: <LuContainer />
        }
      },
      {
        id: "invoiceCustomerId",
        header: t`Invoice Customer`,
        cell: ({ row }) => (
          <CustomerAvatar customerId={row.original.invoiceCustomerId} />
        ),
        meta: {
          filter: {
            type: "static",
            options: customers?.map((customer) => ({
              value: customer.id,
              label: customer.name
            }))
          },
          icon: <LuContainer />
        }
      },
      {
        accessorKey: "customerReference",
        header: t`Customer PO`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuQrCode />
        }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: (item) => {
          const status =
            item.getValue<(typeof salesInvoiceStatusType)[number]>();
          return <SalesInvoiceStatus status={status} />;
        },
        meta: {
          filter: {
            type: "static",
            options: salesInvoiceStatusType.map((status) => ({
              value: status,
              label: <SalesInvoiceStatus status={status} />
            }))
          },
          pluralHeader: t`Statuses`,
          icon: <LuStar />
        }
      },
      {
        accessorKey: "invoiceTotal",
        header: t`Invoice Total`,
        cell: (item) => currencyFormatter.format(item.getValue<number>()),
        meta: {
          icon: <LuDollarSign />,
          formatter: currencyFormatter.format,
          renderTotal: true
        }
      },
      {
        id: "assignee",
        header: t`Assignee`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.assignee} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "dateIssued",
        header: t`Issued Date`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "dateDue",
        header: t`Due Date`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "datePaid",
        header: t`Paid Date`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "postingDate",
        header: t`Posting Date`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        accessorKey: "paymentTermName",
        header: t`Payment Method`,
        cell: (item) => <Enumerable value={item.getValue<string>()} />,
        meta: {
          icon: <LuCreditCard />
        }
      },
      {
        id: "createdBy",
        header: t`Created By`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.createdBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "createdAt",
        header: t`Created At`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      },
      {
        id: "updatedBy",
        header: t`Updated By`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.updatedBy} />
        ),
        meta: {
          filter: {
            type: "static",
            options: people.map((employee) => ({
              value: employee.id,
              label: employee.name
            }))
          },
          icon: <LuUser />
        }
      },
      {
        accessorKey: "updatedAt",
        header: t`Updated At`,
        cell: (item) => formatDate(item.getValue<string>()),
        meta: {
          icon: <LuCalendar />
        }
      }
    ];

    return [...defaultColumns, ...customColumns];
  }, [currencyFormatter, customColumns, people, customers, t]);

  const renderContextMenu = useMemo(() => {
    return (row: SalesInvoice) => (
      <>
        <MenuItem
          disabled={!permissions.can("view", "invoicing")}
          onClick={() => navigate(path.to.salesInvoice(row.id!))}
        >
          <MenuIcon icon={<LuPencil />} />
          <Trans>Edit</Trans>
        </MenuItem>
        <MenuItem
          disabled={
            row.status !== "Draft" || !permissions.can("delete", "invoicing")
          }
          destructive
          onClick={() => {
            setSelectedSalesInvoice(row);
            closeSalesInvoiceModal.onOpen();
          }}
        >
          <MenuIcon icon={<LuTrash />} />
          <Trans>Delete</Trans>
        </MenuItem>
      </>
    );
  }, [closeSalesInvoiceModal, navigate, permissions]);

  return (
    <>
      <Table<SalesInvoice>
        count={count}
        columns={columns}
        data={data}
        defaultColumnPinning={{
          left: ["invoiceId"]
        }}
        defaultColumnVisibility={{
          invoiceCustomerId: false,
          paymentTermName: false,
          dateIssued: false,
          datePaid: false,
          postingDate: false,
          createdAt: false,
          createdBy: false,
          updatedAt: false,
          updatedBy: false
        }}
        primaryAction={
          permissions.can("create", "invoicing") && (
            <New label={t`Sales Invoice`} to={path.to.newSalesInvoice} />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Sales Invoices`}
        table="salesInvoice"
        withSavedView
      />

      {selectedSalesInvoice && selectedSalesInvoice.id && (
        <ConfirmDelete
          action={path.to.deleteSalesInvoice(selectedSalesInvoice.id)}
          isOpen={closeSalesInvoiceModal.isOpen}
          name={selectedSalesInvoice.invoiceId!}
          text={t`Are you sure you want to permanently delete ${selectedSalesInvoice.invoiceId!}?`}
          onCancel={() => {
            closeSalesInvoiceModal.onClose();
            setSelectedSalesInvoice(null);
          }}
          onSubmit={() => {
            closeSalesInvoiceModal.onClose();
            setSelectedSalesInvoice(null);
          }}
        />
      )}
    </>
  );
});

SalesInvoicesTable.displayName = "SalesInvoicesTable";

export default SalesInvoicesTable;
