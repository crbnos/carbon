/* eslint-disable react/display-name */
import type { Database } from "@carbon/database";
import type {
  PostgrestSingleResponse,
  SupabaseClient,
} from "@supabase/supabase-js";
import { Combobox } from "~/components";
import type { EditableTableCellComponentProps } from "~/components/Editable";
import type { SalesOrderLine } from "~/modules/sales";
import type { Item } from "~/stores";

const EditableSalesOrderLineNumber =
  (
    mutation: (
      accessorKey: string,
      newValue: string,
      row: SalesOrderLine
    ) => Promise<PostgrestSingleResponse<unknown>>,
    options: {
      client?: SupabaseClient<Database>;
      items: Item[];
      defaultLocationId: string | null;
      userId: string;
    }
  ) =>
  ({
    value,
    row,
    accessorKey,
    onError,
    onUpdate,
  }: EditableTableCellComponentProps<SalesOrderLine>) => {
    const { client, items, userId } = options;
    const selectOptions = items
      .filter((item) => item.type === row.salesOrderLineType)
      .map((item) => ({
        label: item.name,
        value: item.id,
      }));

    const onChange = async (itemId: string | null) => {
      if (!itemId) return;
      if (!client) throw new Error("Supabase client not found");
      if (!row.companyId) throw new Error("Company ID not found");
      if (!row.id) throw new Error("Purchase order line ID not found");

      switch (row.salesOrderLineType) {
        case "Consumable":
        case "Tool":
        case "Fixture":
        case "Material":
        case "Part":
          const [item, inventory] = await Promise.all([
            client
              .from("item")
              .select(
                "name, readableId, unitOfMeasureCode, itemUnitSalePrice(unitSalePrice)"
              )
              .eq("id", itemId)
              .eq("companyId", row.companyId!)
              .single(),
            client
              .from("pickMethod")
              .select("defaultShelfId")
              .eq("itemId", itemId)
              .eq("companyId", row.companyId!)
              .eq("locationId", row.locationId!)
              .maybeSingle(),
          ]);

          const itemUnitSalePrice = item?.data?.itemUnitSalePrice?.[0];

          if (item.error || inventory.error) {
            onError();
            return;
          }

          onUpdate({
            itemId: itemId,
            itemReadableId: item.data?.readableId,
            locationId: options.defaultLocationId,
            description: item.data?.name ?? "",
            unitPrice: itemUnitSalePrice?.unitSalePrice ?? 0,
            unitOfMeasureCode: item.data?.unitOfMeasureCode ?? "EA",
            shelfId: inventory.data?.defaultShelfId ?? null,
          });

          try {
            const { error } = await client
              .from("salesOrderLine")
              .update({
                itemId: itemId,
                itemReadableId: item.data?.readableId,
                locationId: options.defaultLocationId,
                description: item.data?.name ?? "",
                unitPrice: itemUnitSalePrice?.unitSalePrice ?? 0,
                unitOfMeasureCode: item.data?.unitOfMeasureCode ?? "EA",
                shelfId: inventory.data?.defaultShelfId ?? null,
                updatedBy: userId,
              })
              .eq("id", row.id);

            if (error) onError();
          } catch (error) {
            console.error(error);
            onError();
          }
          break;
        case "Service":
          const service = await client
            .from("item")
            .select("name, readableId")
            .eq("id", itemId)
            .eq("companyId", row.companyId)
            .single();

          if (service.error) {
            onError();
            return;
          }

          onUpdate({
            itemId: itemId,
            itemReadableId: service.data?.readableId,
            description: service.data?.name,
          });

          try {
            const { error } = await client
              .from("salesOrderLine")
              .update({
                itemId: itemId,
                itemReadableId: service.data?.readableId,
                description: service.data?.name,
                updatedBy: userId,
              })
              .eq("id", row.id);

            if (error) onError();
          } catch (error) {
            console.error(error);
            onError();
          }
          break;
        default:
          throw new Error(
            `Invalid invoice line type: ${row.salesOrderLineType} is not implemented`
          );
      }
    };

    const selectedValue = row.itemId;

    return (
      <Combobox
        autoFocus
        value={selectedValue ?? ""}
        options={selectOptions}
        onChange={onChange}
        size="sm"
        className="border-0 rounded-none w-full"
      />
    );
  };

EditableSalesOrderLineNumber.displayName = "EditableSalesOrderLineNumber";
export default EditableSalesOrderLineNumber;
