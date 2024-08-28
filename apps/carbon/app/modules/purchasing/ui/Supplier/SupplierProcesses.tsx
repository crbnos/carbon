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
  IconButton,
} from "@carbon/react";
import { Outlet, useNavigate, useParams } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import { MdMoreHoriz } from "react-icons/md";
import { New } from "~/components";
import { EditableNumber } from "~/components/Editable";
import Grid from "~/components/Grid";
import { useCurrencyFormatter, usePermissions, useUser } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { useSupabase } from "~/lib/supabase";
import type { SupplierProcess } from "~/modules/purchasing";
import { path } from "~/utils/path";

type SupplierProccessesProps = {
  processes: SupplierProcess[];
};

const SupplierProccesses = ({ processes }: SupplierProccessesProps) => {
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");
  const { id: userId } = useUser();

  const navigate = useNavigate();
  const permissions = usePermissions();

  const canEdit = permissions.can("update", "purchasing");
  const canDelete = permissions.can("delete", "purchasing");
  const { supabase } = useSupabase();

  const onCellEdit = useCallback(
    async (id: string, value: unknown, row: SupplierProcess) => {
      if (!supabase) throw new Error("Supabase client not found");
      return await supabase
        .from("supplierProcess")
        .update({
          [id]: value,
          updatedBy: userId,
        })
        .eq("id", row.id!);
    },
    [supabase, userId]
  );

  const customColumns = useCustomColumns<SupplierProcess>("supplierProcess");

  const formatter = useCurrencyFormatter();

  const columns = useMemo<ColumnDef<SupplierProcess>[]>(() => {
    const defaultColumns: ColumnDef<SupplierProcess>[] = [
      {
        accessorKey: "proccessName",
        header: "Process",
        cell: ({ row }) => (
          <HStack className="justify-between min-w-[100px]">
            <span>{row.original.processName}</span>
            <div className="relative w-6 h-5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label="Edit supplier process"
                    icon={<MdMoreHoriz />}
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
                    Edit Process
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
                    disabled={!canDelete}
                  >
                    <DropdownMenuIcon icon={<LuTrash />} />
                    Delete Process
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </HStack>
        ),
      },

      {
        accessorKey: "minimumCost",
        header: "Minimum Cost",
        cell: ({ row }) => formatter.format(row.original.minimumCost ?? 0),
      },
      {
        accessorKey: "unitCost",
        header: "Unit Cost",
        cell: ({ row }) => formatter.format(row.original.unitCost ?? 0),
      },
      {
        accessorKey: "leadTime",
        header: "Lead Time",
        cell: (item) => item.getValue(),
      },
    ];
    return [...defaultColumns, ...customColumns];
  }, [customColumns, canEdit, canDelete, navigate, supplierId, formatter]);

  const editableComponents = useMemo(
    () => ({
      minimumCost: EditableNumber(onCellEdit, {
        formatOptions: { style: "currency", currency: "USD" },
      }),
      unitCost: EditableNumber(onCellEdit, {
        formatOptions: { style: "currency", currency: "USD" },
      }),
      leadTime: EditableNumber(onCellEdit),
    }),
    [onCellEdit]
  );

  return (
    <>
      <Card className="w-full h-full min-h-[50vh]">
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Supplier Processes</CardTitle>
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
