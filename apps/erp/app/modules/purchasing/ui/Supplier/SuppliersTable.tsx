import {
  Badge,
  Button,
  HStack,
  MenuIcon,
  MenuItem,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuEuro,
  LuGlobe,
  LuPencil,
  LuPhone,
  LuPrinter,
  LuShapes,
  LuStar,
  LuTag,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import {
  EmployeeAvatar,
  Hyperlink,
  New,
  SupplierAvatar,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useSupplierTypes } from "~/components/Form/SupplierType";
import { ConfirmDelete } from "~/components/Modals";
import { useDateFormatter, usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { Supplier } from "~/modules/purchasing";
import { supplierStatusType } from "~/modules/purchasing";
import { SupplierStatusIndicator } from "~/modules/purchasing/ui/Supplier/SupplierStatusIndicator";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

type SuppliersTableProps = {
  data: Supplier[];
  count: number;
  tags: { name: string }[];
};

const SuppliersTable = memo(({ data, count, tags }: SuppliersTableProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { formatDate } = useDateFormatter();
  const [people] = usePeople();
  const deleteModal = useDisclosure();
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(
    null
  );
  const supplierTypes = useSupplierTypes();

  const customColumns = useCustomColumns<Supplier>("supplier");
  const columns = useMemo<ColumnDef<Supplier>[]>(() => {
    const defaultColumns: ColumnDef<Supplier>[] = [
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => (
          <div className="max-w-[320px] truncate">
            <Hyperlink to={path.to.supplierDetails(row.original.id!)}>
              <SupplierAvatar supplierId={row.original.id!} />
            </Hyperlink>
          </div>
        ),
        meta: {
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "status",
        header: t`Supplier Status`,
        cell: (item) => (
          // @ts-expect-error TS2322 - TODO: fix type
          <SupplierStatusIndicator status={item.getValue<string>()} />
        ),
        meta: {
          filter: {
            type: "static",
            options: supplierStatusType.map((status) => ({
              value: status,
              label: <SupplierStatusIndicator status={status} />
            }))
          },
          icon: <LuStar />
        }
      },
      {
        accessorKey: "supplierTypeId",
        header: t`Type`,
        cell: (item) => {
          if (!item.getValue<string>()) return null;
          const supplierType = supplierTypes?.find(
            (type) => type.value === item.getValue<string>()
          )?.label;
          return <Enumerable value={supplierType ?? ""} />;
        },
        meta: {
          icon: <LuShapes />,
          filter: {
            type: "static",
            options: supplierTypes?.map((type) => ({
              value: type.value,
              label: <Enumerable value={type.label} />
            }))
          }
        }
      },
      {
        id: "accountManagerId",
        header: t`Account Manager`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.accountManagerId} />
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
        accessorKey: "tags",
        header: t`Tags`,
        cell: ({ row }) => (
          <HStack spacing={0} className="gap-1">
            {row.original.tags?.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </HStack>
        ),
        meta: {
          filter: {
            type: "static",
            options: tags?.map((tag) => ({
              value: tag.name,
              label: <Badge variant="secondary">{tag.name}</Badge>
            })),
            isArray: true
          },
          icon: <LuTag />
        }
      },
      {
        accessorKey: "currencyCode",
        header: t`Currency`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuEuro />
        }
      },
      {
        accessorKey: "phone",
        header: t`Phone`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuPhone />
        }
      },
      {
        accessorKey: "fax",
        header: t`Fax`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuPrinter />
        }
      },
      {
        accessorKey: "website",
        header: t`Website`,
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuGlobe />
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
  }, [supplierTypes, people, tags, customColumns, t]);

  const renderContextMenu = useMemo(
    () => (row: Supplier) => (
      <>
        <MenuItem onClick={() => navigate(path.to.supplier(row.id!))}>
          <MenuIcon icon={<LuPencil />} />
          <Trans>Edit Supplier</Trans>
        </MenuItem>
        <MenuItem
          destructive
          disabled={!permissions.can("delete", "purchasing")}
          onClick={() => {
            setSelectedSupplier(row);
            deleteModal.onOpen();
          }}
        >
          <MenuIcon icon={<LuTrash />} />
          <Trans>Delete Supplier</Trans>
        </MenuItem>
      </>
    ),
    [navigate, deleteModal, permissions]
  );

  return (
    <>
      <Table<Supplier>
        count={count}
        columns={columns}
        data={data}
        defaultColumnPinning={{
          left: ["name"]
        }}
        defaultColumnVisibility={{
          currencyCode: false,
          phone: false,
          fax: false,
          website: false,
          createdBy: false,
          createdAt: false,
          updatedBy: false,
          updatedAt: false
        }}
        importCSV={[
          {
            table: "supplier",
            label: t`Suppliers`
          },
          {
            table: "supplierContact",
            label: t`Contacts`
          }
        ]}
        primaryAction={
          permissions.can("create", "purchasing") && (
            <div className="flex items-center gap-2">
              <Button variant="secondary" leftIcon={<LuShapes />} asChild>
                <Link to={path.to.supplierTypes}>
                  <Trans>Supplier Types</Trans>
                </Link>
              </Button>
              <New label={t`Supplier`} to={path.to.newSupplier} />
            </div>
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Suppliers`}
        table="supplier"
        withSavedView
      />
      {selectedSupplier && selectedSupplier.id && (
        <ConfirmDelete
          action={path.to.deleteSupplier(selectedSupplier.id)}
          isOpen={deleteModal.isOpen}
          name={selectedSupplier.name!}
          text={`Are you sure you want to delete ${selectedSupplier.name!}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
            setSelectedSupplier(null);
          }}
          onSubmit={() => {
            deleteModal.onClose();
            setSelectedSupplier(null);
          }}
        />
      )}
    </>
  );
});

SuppliersTable.displayName = "SupplierTable";

export default SuppliersTable;
