import { HStack, MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuContainer,
  LuMap,
  LuPencil,
  LuStar,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { usePeople, useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import { purchasingRfqStatusType } from "../../purchasing.models";
import type { PurchasingRFQ } from "../../types";
import { PurchasingRFQStatus } from ".";

type PurchasingRFQsTableProps = {
  data: PurchasingRFQ[];
  count: number;
};

const PurchasingRFQsTable = memo(
  ({ data, count }: PurchasingRFQsTableProps) => {
    const permissions = usePermissions();
    const navigate = useNavigate();
    const [suppliers] = useSuppliers();

    const [selectedPurchasingRFQ, setSelectedPurchasingRFQ] =
      useState<PurchasingRFQ | null>(null);
    const deletePurchasingRFQModal = useDisclosure();

    // const [suppliers] = useSuppliers();
    const [people] = usePeople();

    const customColumns = useCustomColumns<PurchasingRFQ>("purchasingRfq");
    const columns = useMemo<ColumnDef<PurchasingRFQ>[]>(() => {
      const defaultColumns: ColumnDef<PurchasingRFQ>[] = [
        {
          accessorKey: "rfqId",
          header: "RFQ Number",
          cell: ({ row }) => (
            <HStack>
              <Hyperlink to={path.to.purchasingRfqDetails(row.original.id!)}>
                {row.original.rfqId}
              </Hyperlink>
            </HStack>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "supplierIds",
          header: "Suppliers",
          cell: ({ row }) => {
            return (
              <div className="flex items-center gap-1">
                {row.original.supplierIds
                  ?.slice(0, 2)
                  .map((supplierId, index) => (
                    <span key={index} className="text-sm">
                      {suppliers.find((s) => s.id === supplierId)?.name ?? ""}
                      {index <
                        Math.min(row.original.supplierIds?.length ?? 0, 2) -
                          1 && ","}
                    </span>
                  ))}
                {(row.original.supplierIds?.length ?? 0) > 2 && (
                  <span className="text-sm text-muted-foreground">
                    +{(row.original.supplierIds?.length ?? 0) - 2}
                  </span>
                )}
              </div>
            );
          },
          meta: {
            icon: <LuContainer />,
            filter: {
              type: "static",
              options: suppliers.map((supplier) => ({
                value: supplier.id,
                label: <Enumerable value={supplier.name} />
              })),
              isArray: true
            }
          }
        },
        {
          accessorKey: "status",
          header: "Status",
          cell: (item) => {
            const status =
              item.getValue<(typeof purchasingRfqStatusType)[number]>();
            return <PurchasingRFQStatus status={status} />;
          },
          meta: {
            filter: {
              type: "static",
              options: purchasingRfqStatusType.map((status) => ({
                value: status,
                label: <PurchasingRFQStatus status={status} />
              }))
            },
            pluralHeader: "Statuses",
            icon: <LuStar />
          }
        },
        {
          accessorKey: "rfqDate",
          header: "RFQ Date",
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "expirationDate",
          header: "Due Date",
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          id: "assignee",
          header: "Assignee",
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
          id: "createdBy",
          header: "Created By",
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
          accessorKey: "locationName",
          header: "Location",
          cell: (item) => <Enumerable value={item.getValue<string>()} />,
          meta: {
            filter: {
              type: "fetcher",
              endpoint: path.to.api.locations,
              transform: (data: { id: string; name: string }[] | null) =>
                data?.map(({ name }) => ({
                  value: name,
                  label: <Enumerable value={name} />
                })) ?? []
            },
            icon: <LuMap />
          }
        },
        {
          accessorKey: "createdAt",
          header: "Created At",
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          id: "updatedBy",
          header: "Updated By",
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
          header: "Updated At",
          cell: (item) => formatDate(item.getValue<string>()),
          meta: {
            icon: <LuCalendar />
          }
        }
      ];

      return [...defaultColumns, ...customColumns];
    }, [people, customColumns]);

    const renderContextMenu = useMemo(() => {
      return (row: PurchasingRFQ) => (
        <>
          <MenuItem
            onClick={() => navigate(path.to.purchasingRfqDetails(row.id!))}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "purchasing")}
            onClick={() => {
              setSelectedPurchasingRFQ(row);
              deletePurchasingRFQModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete
          </MenuItem>
        </>
      );
    }, [deletePurchasingRFQModal, navigate, permissions]);

    return (
      <>
        <Table<PurchasingRFQ>
          count={count}
          columns={columns}
          data={data}
          defaultColumnPinning={{
            left: ["rfqId"]
          }}
          defaultColumnVisibility={{
            createdAt: false,
            updatedAt: false,
            updatedBy: false
          }}
          primaryAction={
            permissions.can("create", "purchasing") && (
              <New label="RFQ" to={path.to.newPurchasingRFQ} />
            )
          }
          renderContextMenu={renderContextMenu}
          title="RFQs"
          table="purchasingRfq"
          withSavedView
        />
        {selectedPurchasingRFQ && selectedPurchasingRFQ.id && (
          <ConfirmDelete
            action={path.to.deletePurchasingRfq(selectedPurchasingRFQ.id)}
            isOpen={deletePurchasingRFQModal.isOpen}
            name={selectedPurchasingRFQ.rfqId!}
            text={`Are you sure you want to delete ${selectedPurchasingRFQ.rfqId!}? This cannot be undone.`}
            onCancel={() => {
              deletePurchasingRFQModal.onClose();
              setSelectedPurchasingRFQ(null);
            }}
            onSubmit={() => {
              deletePurchasingRFQModal.onClose();
              setSelectedPurchasingRFQ(null);
            }}
          />
        )}
      </>
    );
  }
);

PurchasingRFQsTable.displayName = "PurchasingRFQsTable";

export default PurchasingRFQsTable;
