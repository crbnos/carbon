import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
} from "@carbon/react";
import { Outlet, useNavigate, useParams } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import { New } from "~/components";
import { EditableNumber, EditableText } from "~/components/Editable";
import Grid from "~/components/Grid";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import {
  useQuotation,
  type Quotation,
  type QuotationMaterial,
} from "~/modules/sales";
import { path } from "~/utils/path";

type QuotationMaterialLinesProps = {
  quotationMaterials: QuotationMaterial[];
};

const QuotationMaterialLines = ({
  quotationMaterials,
}: QuotationMaterialLinesProps) => {
  const { id, lineId, operationId } = useParams();
  if (!id) throw new Error("id not found");
  if (!lineId) throw new Error("lineId not found");
  if (!operationId) throw new Error("operationId not found");

  const [, setQuote] = useQuotation();

  const { id: userId } = useUser();
  const { supabase } = useSupabase();
  const permissions = usePermissions();

  const canEdit = permissions.can("update", "sales");
  const canDelete = permissions.can("delete", "sales");

  const onCellEdit = useCallback(
    async (id: string, value: unknown, row: QuotationMaterial) => {
      if (!supabase) throw new Error("Supabase client not found");
      return await supabase
        .from("quoteMaterial")
        .update({
          [id]: value,
          updatedBy: userId,
        })
        .eq("id", row.id!);
    },
    [supabase, userId]
  );

  const navigate = useNavigate();

  const routeData = useRouteData<{
    quotation: Quotation;
  }>(path.to.quote(id));
  const isEditable = ["Draft"].includes(routeData?.quotation?.status ?? "");

  // TODO: use the currency of the quote
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });

  const columns = useMemo<ColumnDef<QuotationMaterial>[]>(() => {
    return [
      {
        accessorKey: "partId",
        header: "Part",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "quantity",
        header: "Quantity",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "unitCost",
        header: "Unit Cost",
        cell: (item) => formatter.format(item.getValue<number>()),
      },
      // {
      //   accessorKey: "unitOfMeasureCode",
      //   header: "Unit of Measure",
      //   cell: (item) => item.getValue(),
      // },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, isEditable, canDelete]);

  const editableComponents = useMemo(
    () => ({
      quantity: EditableNumber(onCellEdit),
      description: EditableText(onCellEdit),
      unitCost: EditableNumber(onCellEdit, { minValue: 0 }),
    }),
    [onCellEdit]
  );

  return (
    <>
      <Card
        className="w-full"
        style={{ height: 196 + quotationMaterials.length * 44 }}
      >
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Materials</CardTitle>
          </CardHeader>
          <CardAction>
            {canEdit && isEditable && (
              <New label="Material" to="material/new" />
            )}
          </CardAction>
        </HStack>

        <CardContent>
          <Grid<QuotationMaterial>
            data={quotationMaterials}
            canEdit={canEdit && isEditable}
            columns={columns}
            contained={false}
            editableComponents={editableComponents}
            onNewRow={() => navigate("material/new")}
            onDataChange={(data) =>
              setQuote((prev) => ({
                ...prev,
                materials: prev.materials
                  .filter((m) => m.quoteOperationId !== operationId)
                  .concat(data),
              }))
            }
          />
        </CardContent>
      </Card>
      <Outlet />
    </>
  );
};

export default QuotationMaterialLines;
