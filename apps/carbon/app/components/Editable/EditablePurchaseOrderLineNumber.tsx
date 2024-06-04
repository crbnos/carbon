/* eslint-disable react/display-name */
import type { Database } from "@carbon/database";
import type {
  PostgrestSingleResponse,
  SupabaseClient,
} from "@supabase/supabase-js";
import { Combobox } from "~/components";
import type { EditableTableCellComponentProps } from "~/components/Editable";
import type { PurchaseOrderLine } from "~/modules/purchasing";
import type { Item } from "~/stores";

const EditablePurchaseOrderLineNumber =
  (
    mutation: (
      accessorKey: string,
      newValue: string,
      row: PurchaseOrderLine
    ) => Promise<PostgrestSingleResponse<unknown>>,
    options: {
      client?: SupabaseClient<Database>;
      items: Item[];
      accounts: { label: string; value: string }[];
      defaultLocationId: string | null;
      supplierId: string;
      userId: string;
    }
  ) =>
  ({
    value,
    row,
    accessorKey,
    onError,
    onUpdate,
  }: EditableTableCellComponentProps<PurchaseOrderLine>) => {
    const { client, items, accounts, supplierId, userId } = options;
    const selectOptions =
      row.purchaseOrderLineType === "G/L Account"
        ? accounts
        : items
            .filter((item) => item.type === row.purchaseOrderLineType)
            .map((item) => ({
              label: item.name,
              value: item.id,
            }));

    const onAccountChange = async (accountNumber: string) => {
      if (!client) throw new Error("Supabase client not found");
      if (!row.companyId) throw new Error("Company ID not found");
      if (!row.id) throw new Error("Purchase order line ID not found");

      const account = await client
        .from("account")
        .select("name")
        .eq("number", accountNumber)
        .eq("companyId", row.companyId)
        .single();

      onUpdate({
        itemId: null,
        itemReadableId: null,
        description: account.data?.name ?? "",
        accountNumber: accountNumber,
      });

      try {
        const { error } = await client
          .from("purchaseOrderLine")
          .update({
            itemId: null,
            itemReadableId: null,
            accountNumber: accountNumber,
            description: account.data?.name ?? "",
            updatedBy: userId,
          })
          .eq("id", row.id);

        if (error) onError();
      } catch (error) {
        console.error(error);
        onError();
      }
    };

    const onItemChange = async (itemId: string) => {
      if (!client) throw new Error("Supabase client not found");
      if (!row.companyId) throw new Error("Company ID not found");
      if (!row.id) throw new Error("Purchase order line ID not found");

      switch (row.purchaseOrderLineType) {
        case "Part":
          const [item, part, itemSupplier, inventory] = await Promise.all([
            client
              .from("item")
              .select(
                "name, readableId, itemCost(unitCost), itemReplenishment(purchasingUnitOfMeasureCode, conversionFactor, purchasingLeadTime)"
              )
              .eq("id", itemId)
              .eq("companyId", row.companyId!)
              .single(),
            client
              .from("part")
              .select("unitOfMeasureCode")
              .eq("itemId", itemId)
              .eq("companyId", row.companyId!)
              .single(),
            client
              .from("itemSupplier")
              .select("*")
              .eq("itemId", itemId)
              .eq("companyId", row.companyId!)
              .eq("supplierId", supplierId)
              .maybeSingle(),
            client
              .from("itemInventory")
              .select("defaultShelfId")
              .eq("itemId", itemId)
              .eq("companyId", row.companyId!)
              .eq("locationId", row.locationId!)
              .maybeSingle(),
          ]);

          const itemCost = item?.data?.itemCost?.[0];
          const itemReplenishment = item?.data?.itemReplenishment?.[0];

          if (
            item.error ||
            part.error ||
            itemSupplier.error ||
            inventory.error
          ) {
            onError();
            return;
          }

          onUpdate({
            itemId: itemId,
            itemReadableId: item.data?.readableId,
            locationId: options.defaultLocationId,
            description: item.data?.name ?? "",
            quantity: itemSupplier?.data?.minimumOrderQuantity ?? 1,
            unitPrice: itemSupplier?.data?.unitPrice ?? itemCost?.unitCost ?? 0,
            purchaseUnitOfMeasureCode:
              itemReplenishment?.purchasingUnitOfMeasureCode ??
              part.data?.unitOfMeasureCode ??
              "EA",

            conversionFactor: itemReplenishment?.conversionFactor ?? 1,
            shelfId: inventory.data?.defaultShelfId ?? null,
          });

          try {
            const { error } = await client
              .from("purchaseOrderLine")
              .update({
                itemId: itemId,
                itemReadableId: item.data?.readableId,
                locationId: options.defaultLocationId,
                description: item.data?.name ?? "",
                quantity: itemSupplier?.data?.minimumOrderQuantity ?? 1,
                unitPrice:
                  itemSupplier?.data?.unitPrice ?? itemCost?.unitCost ?? 0,
                purchaseUnitOfMeasureCode:
                  itemReplenishment?.purchasingUnitOfMeasureCode ??
                  part.data?.unitOfMeasureCode ??
                  "EA",

                conversionFactor: itemReplenishment?.conversionFactor ?? 1,
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
              .from("purchaseOrderLine")
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
            `Invalid invoice line type: ${row.purchaseOrderLineType} is not implemented`
          );
      }
    };

    const onChange = (newValue: string | null) => {
      if (!newValue) return;
      if (!row.purchaseOrderLineType) return;

      if (
        [
          "Part",
          "Service",
          "Material",
          "Tool",
          "Fixture",
          "Hardware",
          "Consumable",
        ].includes(row.purchaseOrderLineType)
      ) {
        onItemChange(newValue);
      } else if (row.purchaseOrderLineType === "G/L Account") {
        onAccountChange(newValue);
      }
    };

    const selectedValue = getValue(row);

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

EditablePurchaseOrderLineNumber.displayName = "EditablePurchaseOrderLineNumber";
export default EditablePurchaseOrderLineNumber;

function getValue(row: PurchaseOrderLine) {
  switch (row.purchaseOrderLineType) {
    case "Part":
    case "Service":
    case "Material":
    case "Tool":
    case "Fixture":
    case "Hardware":
    case "Consumable":
      return row.itemId;

    case "G/L Account":
      return row.accountNumber;
    case "Fixed Asset":
      return row.assetId;
    default:
      return null;
  }
}
