/* eslint-disable react/display-name */
import type { Database } from "@carbon/database";
import type {
  PostgrestSingleResponse,
  SupabaseClient,
} from "@supabase/supabase-js";
import { Combobox } from "~/components";
import type { EditableTableCellComponentProps } from "~/components/Editable";
import type { PurchaseInvoiceLine } from "~/modules/invoicing";
import type { Item } from "~/stores";

const EditablePurchaseInvoiceLineNumber =
  (
    mutation: (
      accessorKey: string,
      newValue: string,
      row: PurchaseInvoiceLine
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
  }: EditableTableCellComponentProps<PurchaseInvoiceLine>) => {
    const { client, items, accounts, supplierId, userId } = options;
    const selectOptions =
      row.invoiceLineType === "G/L Account"
        ? accounts
        : items
            .filter((item) => item.type === row.invoiceLineType)
            .map((item) => ({
              label: item.name,
              value: item.id,
            }));

    const onAccountChange = async (accountNumber: string) => {
      if (!client) throw new Error("Supabase client not found");

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
          .from("purchaseInvoiceLine")
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
      switch (row.invoiceLineType) {
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
              .from("purchaseInvoiceLine")
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
            .select("readableId, name")
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
              .from("purchaseInvoiceLine")
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
            `Invalid invoice line type: ${row.invoiceLineType} is not implemented`
          );
      }
    };

    const onChange = (newValue: string | null) => {
      if (!newValue) return;

      if (
        [
          "Part",
          "Service",
          "Material",
          "Tool",
          "Fixture",
          "Hardware",
          "Consumable",
        ].includes(row.invoiceLineType)
      ) {
        onItemChange(newValue);
      } else if (row.invoiceLineType === "G/L Account") {
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

EditablePurchaseInvoiceLineNumber.displayName =
  "EditablePurchaseInvoiceLineNumber";
export default EditablePurchaseInvoiceLineNumber;

function getValue(row: PurchaseInvoiceLine) {
  switch (row.invoiceLineType) {
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
