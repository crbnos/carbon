import {
  Button,
  Combobox,
  MenuIcon,
  MenuItem,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuCirclePlus,
  LuClock,
  LuMapPin,
  LuPencil,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { ConfirmDelete } from "~/components/Modals";
import { useDateFormatter, usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { clearStockTransferWizard, usePeople } from "~/stores";
import { path } from "~/utils/path";
import { stockTransferStatusType } from "../../inventory.models";
import type { StockTransfer } from "../../types";
import StockTransferStatus from "./StockTransferStatus";
import { StockTransferWizard } from "./StockTransferWizard";

type StockTransfersTableProps = {
  data: StockTransfer[];
  count: number;
  locationId: string;
};

const StockTransfersTable = memo(
  ({ data, count, locationId }: StockTransfersTableProps) => {
    const wizardDisclosure = useDisclosure();

    const [params] = useUrlParams();
    const { t } = useLingui();
    const { formatDate } = useDateFormatter();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const rows = useMemo(() => data, [data]);
    const [people] = usePeople();

    const customColumns = useCustomColumns<StockTransfer>("stockTransfer");
    const locations = useLocations();

    const columns = useMemo<ColumnDef<StockTransfer>[]>(() => {
      const result: ColumnDef<(typeof rows)[number]>[] = [
        {
          accessorKey: "stockTransferId",
          header: t`Stock Transfer ID`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.stockTransfer(row.original.id!)}>
              {row.original.stockTransferId}
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "locationId",
          header: t`Location`,
          cell: ({ row }) => (
            <Enumerable
              value={
                locations.find((l) => l.value === row.original.locationId)
                  ?.label ?? null
              }
            />
          ),
          meta: {
            filter: {
              type: "static",
              options: locations.map((type) => ({
                value: type.value,
                label: <Enumerable value={type.label} />
              }))
            },
            icon: <LuMapPin />
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: (item) => {
            const status =
              item.getValue<(typeof stockTransferStatusType)[number]>();
            return <StockTransferStatus status={status} />;
          },
          meta: {
            filter: {
              type: "static",
              options: stockTransferStatusType.map((type) => ({
                value: type,
                label: <StockTransferStatus status={type} />
              }))
            },
            pluralHeader: t`Statuses`,
            icon: <LuClock />
          }
        },
        {
          accessorKey: "assignee",
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
          accessorKey: "completedAt",
          header: t`Completed At`,
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />
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

      return [...result, ...customColumns];
    }, [locations, people, customColumns, t]);

    const [selectedStockTransfer, setSelectedStockTransfer] =
      useState<StockTransfer | null>(null);
    const deleteStockTransferModal = useDisclosure();

    const renderContextMenu = useCallback(
      (row: StockTransfer) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "inventory")}
              onClick={() => {
                navigate(
                  `${path.to.shipmentDetails(row.id!)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              {row.completedAt
                ? t`View Stock Transfer`
                : t`Edit Stock Transfer`}
            </MenuItem>
            <MenuItem
              disabled={
                !permissions.can("delete", "inventory") ||
                !!row.completedAt ||
                ["Completed", "In Progress"].includes(row.status)
              }
              destructive
              onClick={() => {
                setSelectedStockTransfer(row);
                deleteStockTransferModal.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete Stock Transfer</Trans>
            </MenuItem>
          </>
        );
      },
      [deleteStockTransferModal, navigate, params, permissions, t]
    );

    return (
      <>
        <Table<(typeof data)[number]>
          data={data}
          columns={columns}
          count={count}
          defaultColumnPinning={{
            left: ["shipmentId"]
          }}
          defaultColumnVisibility={{
            updatedAt: false,
            updatedBy: false
          }}
          primaryAction={
            <div className="flex items-center gap-2">
              <Combobox
                asButton
                size="sm"
                value={locationId}
                options={locations}
                onChange={(selected) => {
                  // hard refresh because initialValues update has no effect otherwise
                  window.location.href = getLocationPath(selected);
                }}
              />
              {permissions.can("create", "inventory") && (
                <Button
                  onClick={() => {
                    clearStockTransferWizard();
                    wizardDisclosure.onOpen();
                  }}
                  leftIcon={<LuCirclePlus />}
                >
                  Add Stock Transfer
                </Button>
              )}
            </div>
          }
          renderContextMenu={renderContextMenu}
          title={t`Stock Transfers`}
          table="stockTransfer"
          withSavedView
        />
        {selectedStockTransfer && selectedStockTransfer.id && (
          <ConfirmDelete
            action={path.to.deleteStockTransfer(selectedStockTransfer.id)}
            isOpen={deleteStockTransferModal.isOpen}
            name={selectedStockTransfer.stockTransferId!}
            text={`Are you sure you want to delete ${selectedStockTransfer.stockTransferId!}? This cannot be undone.`}
            onCancel={() => {
              deleteStockTransferModal.onClose();
              setSelectedStockTransfer(null);
            }}
            onSubmit={() => {
              deleteStockTransferModal.onClose();
              setSelectedStockTransfer(null);
            }}
          />
        )}
        {wizardDisclosure.isOpen && (
          <StockTransferWizard
            locationId={locationId}
            onClose={wizardDisclosure.onClose}
          />
        )}
      </>
    );
  }
);

StockTransfersTable.displayName = "StockTransfersTable";
export default StockTransfersTable;

function getLocationPath(locationId: string) {
  return `${path.to.stockTransfers}?location=${locationId}`;
}
