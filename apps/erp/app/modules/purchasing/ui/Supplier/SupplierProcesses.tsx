import { useCarbon } from "@carbon/auth";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton
} from "@carbon/react";
import { INPUT_FORMAT } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import { LuEllipsisVertical, LuPencil, LuTrash } from "react-icons/lu";
import { Outlet, useNavigate, useParams } from "react-router";
import { New } from "~/components";
import { EditableNumber } from "~/components/Editable";
import Grid from "~/components/Grid";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePermissions,
  useUser
} from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { SupplierProcess } from "~/modules/purchasing";
import { path } from "~/utils/path";

type SupplierProccessesProps = {
  processes: SupplierProcess[];
};

const SupplierProccesses = ({ processes }: SupplierProccessesProps) => {
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");
  const { id: userId, company } = useUser();

  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const canEdit = permissions.can("update", "purchasing");
  const canDelete = permissions.can("delete", "purchasing");
  const { carbon } = useCarbon();

  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const currencyDecimals = useCurrencyDecimals(baseCurrency);

  const onCellEdit = useCallback(
    async (id: string, value: unknown, row: SupplierProcess) => {
      if (!carbon) throw new Error("Carbon client not found");
      return await carbon
        .from("supplierProcess")
        .update({
          [id]: value,
          updatedBy: userId
        })
        .eq("id", row.id!);
    },
    [carbon, userId]
  );

  const customColumns = useCustomColumns<SupplierProcess>("supplierProcess");

  const formatter = useCurrencyFormatter();

  const columns = useMemo<ColumnDef<SupplierProcess>[]>(() => {
    const defaultColumns: ColumnDef<SupplierProcess>[] = [
      {
        accessorKey: "proccessName",
        header: t`Process`,
        cell: ({ row }) => (
          <HStack className="justify-between min-w-[100px]">
            <span>{row.original.processName}</span>
            <div className="relative w-6 h-5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label={t`Edit supplier process`}
                    icon={<LuEllipsisVertical />}
                    size="md"
                    className="absolute right-[-1px] top-[-6px]"
                    variant="ghost"
                    onClick={(e) => e.stopPropagation()}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() =>
                      navigate(
                        path.to.supplierProcess(supplierId, row.original.id!)
                      )
                    }
                    disabled={!canEdit}
                  >
                    <DropdownMenuIcon icon={<LuPencil />} />
                    <Trans>Edit Process</Trans>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      navigate(
                        path.to.deleteSupplierProcess(
                          supplierId,
                          row.original.id!
                        )
                      )
                    }
                    destructive
                    disabled={!canDelete}
                  >
                    <DropdownMenuIcon icon={<LuTrash />} />
                    <Trans>Delete Process</Trans>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </HStack>
        )
      },

      {
        accessorKey: "minimumCost",
        header: t`Minimum Cost`,
        cell: ({ row }) => formatter.format(row.original.minimumCost ?? 0)
      },
      {
        accessorKey: "leadTime",
        header: t`Lead Time`,
        cell: (item) => item.getValue()
      }
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns, canEdit, canDelete, navigate, supplierId, formatter, t]);

  const editableComponents = useMemo(
    () => ({
      minimumCost: EditableNumber(onCellEdit, {
        formatOptions: INPUT_FORMAT.price(baseCurrency, currencyDecimals)
      }),
      leadTime: EditableNumber(onCellEdit)
    }),
    [onCellEdit, baseCurrency]
  );

  return (
    <>
      <Card className="w-full h-full min-h-[50vh]">
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>
              <Trans>Supplier Processes</Trans>
            </CardTitle>
          </CardHeader>
          <CardAction>{canEdit && <New to="new" />}</CardAction>
        </HStack>

        <CardContent>
          <Grid<SupplierProcess>
            data={processes ?? []}
            columns={columns}
            canEdit={canEdit}
            editableComponents={editableComponents}
            onNewRow={canEdit ? () => navigate("new") : undefined}
          />
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

export default SupplierProccesses;
