import { Card, CardContent, CardHeader, CardTitle, cn } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { LuTrash } from "react-icons/lu";
import { Outlet, useNavigate } from "react-router";
import { SupplierAvatar } from "~/components";
import Grid from "~/components/Grid";
import Hyperlink from "~/components/Hyperlink";
import { ConfirmDelete } from "~/components/Modals";
import { useCurrencyFormatter, usePermissions } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { useSuppliers } from "~/stores/suppliers";
import type { SupplierPart } from "../../../types";

type Part = Pick<
  SupplierPart,
  | "id"
  | "supplierId"
  | "supplierPartId"
  | "unitPrice"
  | "supplierUnitOfMeasureCode"
  | "minimumOrderQuantity"
  | "conversionFactor"
  | "customFields"
>;

type SupplierPartsProps = {
  supplierParts: Part[];
  compact?: boolean;
  deleteSupplierPath?: (id: string) => string;
  // Suppresses the add row + delete column regardless of permissions — for
  // read-only contexts like a locked (Done/Cancelled) change order.
  isReadOnly?: boolean;
};

const SupplierParts = ({
  supplierParts,
  compact = false,
  deleteSupplierPath,
  isReadOnly = false
}: SupplierPartsProps) => {
  const navigate = useNavigate();
  const { t } = useLingui();
  const permissions = usePermissions();
  const canEdit = permissions.can("update", "parts") && !isReadOnly;
  const canDelete = permissions.can("delete", "parts") && !isReadOnly;
  const formatter = useCurrencyFormatter();
  const customColumns = useCustomColumns<Part>("supplierPart");
  const [suppliers] = useSuppliers();

  const [deleteTarget, setDeleteTarget] = useState<Part | null>(null);

  const supplierName = (supplierId: string | null) => {
    if (!supplierId || !suppliers) return t`this supplier`;
    return suppliers.find((s) => s.id === supplierId)?.name ?? t`this supplier`;
  };

  const columns = useMemo<ColumnDef<Part>[]>(() => {
    const defaultColumns: ColumnDef<Part>[] = [
      {
        accessorKey: "supplierId",
        header: t`Supplier`,
        cell: ({ row }) => (
          <Hyperlink to={row.original.id!}>
            <SupplierAvatar supplierId={row.original.supplierId} />
          </Hyperlink>
        )
      },
      {
        accessorKey: "supplierPartId",
        header: t`Supplier ID`,
        cell: (item) => item.getValue()
      },
      {
        accessorKey: "unitPrice",
        header: t`Unit Price`,
        cell: (item) => formatter.format(item.getValue<number>()),
        meta: {
          formatter: formatter.format,
          renderTotal: true
        }
      },
      {
        accessorKey: "supplierUnitOfMeasureCode",
        header: t`Unit of Measure`,
        cell: (item) => item.getValue()
      },
      {
        accessorKey: "minimumOrderQuantity",
        header: t`Minimum Order Quantity`,
        cell: (item) => item.getValue()
      },
      {
        accessorKey: "conversionFactor",
        header: t`Conversion Factor`,
        cell: (item) => item.getValue()
      }
    ];

    const cols = [...defaultColumns, ...customColumns];

    if (canDelete && deleteSupplierPath) {
      cols.push({
        id: "delete",
        header: "",
        size: 40,
        cell: ({ row }) => (
          <button
            type="button"
            aria-label={t`Delete supplier`}
            className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget(row.original);
            }}
          >
            <LuTrash className="w-4 h-4" />
          </button>
        )
      });
    }

    return cols;
  }, [customColumns, formatter, t, canDelete, deleteSupplierPath]);

  return (
    <>
      <Card className={cn(compact && "border-none p-0 dark:shadow-none")}>
        <CardHeader className={cn(compact && "px-0")}>
          <CardTitle>
            <Trans>Supplier Parts</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className={cn(compact && "px-0")}>
          <Grid<Part>
            data={supplierParts}
            columns={columns}
            canEdit={false}
            onNewRow={canEdit ? () => navigate("new") : undefined}
          />
        </CardContent>
      </Card>
      <Outlet />
      {deleteTarget && deleteSupplierPath && deleteTarget.id && (
        <ConfirmDelete
          action={deleteSupplierPath(deleteTarget.id)}
          name={t`Supplier Part`}
          text={t`Are you sure you want to remove ${supplierName(deleteTarget.supplierId)} as a supplier for this item? This cannot be undone.`}
          onCancel={() => setDeleteTarget(null)}
          onSubmit={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
};

export default SupplierParts;
