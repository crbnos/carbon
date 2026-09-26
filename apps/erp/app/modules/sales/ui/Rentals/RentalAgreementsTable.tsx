import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
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
  LuTrash,
  LuTruck
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { CustomerAvatar, Hyperlink, New, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { useDateFormatter, usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { useCustomers } from "~/stores";
import { path } from "~/utils/path";
import { rentalAgreementStatuses } from "../../sales.models";
import RentalMoney from "./RentalMoney";
import RentalStatus from "./RentalStatus";
import type { RentalAgreementListItem } from "./types";

type RentalAgreementsTableProps = {
  data: RentalAgreementListItem[];
  count: number;
};

const RentalAgreementsTable = memo(
  ({ data, count }: RentalAgreementsTableProps) => {
    const { t } = useLingui();
    const permissions = usePermissions();
    const navigate = useNavigate();
    const { formatDate } = useDateFormatter();
    const [customers] = useCustomers();

    const [selected, setSelected] = useState<RentalAgreementListItem | null>(
      null
    );
    const deleteModal = useDisclosure();

    const customColumns =
      useCustomColumns<RentalAgreementListItem>("rentalAgreement");

    const columns = useMemo<ColumnDef<RentalAgreementListItem>[]>(() => {
      const defaultColumns: ColumnDef<RentalAgreementListItem>[] = [
        {
          accessorKey: "rentalAgreementId",
          header: t`Agreement`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.rentalAgreement(row.original.id!)}>
              {row.original.rentalAgreementId}
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />
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
            exportValue: (row: RentalAgreementListItem) =>
              row.customerName ?? row.customerId
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => <RentalStatus status={row.original.status} />,
          meta: {
            filter: {
              type: "static",
              options: rentalAgreementStatuses.map((status) => ({
                value: status,
                label: <RentalStatus status={status} />
              }))
            },
            pluralHeader: t`Statuses`,
            icon: <LuStar />
          }
        },
        {
          accessorKey: "startDate",
          header: t`Start`,
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "endDate",
          header: t`End`,
          cell: (item) => formatDate(item.getValue<string>()) || "—",
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          id: "units",
          header: t`On Rent`,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {row.original.onRentCount ?? 0} / {row.original.lineCount ?? 0}
            </span>
          ),
          meta: {
            icon: <LuTruck />,
            exportValue: (row: RentalAgreementListItem) =>
              `${row.onRentCount ?? 0} / ${row.lineCount ?? 0}`
          }
        },
        {
          accessorKey: "nextDueOn",
          header: t`Next Due`,
          cell: (item) => formatDate(item.getValue<string>()) || "—",
          meta: {
            icon: <LuCalendarClock />
          }
        },
        {
          accessorKey: "unbilledAmount",
          header: t`Unbilled`,
          cell: ({ row }) => (
            <RentalMoney
              value={row.original.unbilledAmount}
              currencyCode={row.original.currencyCode}
            />
          ),
          meta: {
            icon: <LuDollarSign />
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
      return (row: RentalAgreementListItem) => (
        <>
          <MenuItem
            disabled={!permissions.can("view", "sales")}
            onClick={() => {
              navigate(path.to.rentalAgreement(row.id!));
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
        <Table<RentalAgreementListItem>
          count={count}
          columns={columns}
          data={data}
          defaultColumnPinning={{
            left: ["rentalAgreementId"]
          }}
          primaryAction={
            permissions.can("create", "sales") && (
              <New
                label={t`Rental Agreement`}
                to={path.to.newRentalAgreement}
              />
            )
          }
          renderContextMenu={renderContextMenu}
          title={t`Rental Agreements`}
          table="rentalAgreement"
          withSavedView
        />

        {selected?.id && (
          <ConfirmDelete
            action={path.to.deleteRentalAgreement(selected.id)}
            isOpen={deleteModal.isOpen}
            name={selected.rentalAgreementId ?? ""}
            text={t`Are you sure you want to delete ${selected.rentalAgreementId ?? ""}? This cannot be undone.`}
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
  }
);
RentalAgreementsTable.displayName = "RentalAgreementsTable";

export default RentalAgreementsTable;
