import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { getCurrencyByCode } from "~/modules/accounting";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing",
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const field = formData.get("field");
  const value = formData.get("value");

  if (typeof field !== "string") {
    return json({ error: { message: "Invalid form data" }, data: null });
  }

  if (field === "delete") {
    return json(
      await client
        .from("purchaseOrder")
        .delete()
        .in("id", ids as string[])
    );
  }

  if (typeof value !== "string" && value !== null) {
    return json({ error: { message: "Invalid form data" }, data: null });
  }

  switch (field) {
    case "supplierId":
      let currencyCode: string | undefined;
      if (value && ids.length === 1) {
        const supplier = await client
          ?.from("supplier")
          .select("currencyCode")
          .eq("id", value)
          .single();

        if (supplier.data?.currencyCode) {
          currencyCode = supplier.data.currencyCode;
          const currency = await getCurrencyByCode(
            client,
            companyId,
            currencyCode
          );
          // TODO: update delivery and payment terms
          return json(
            await client
              .from("purchaseOrder")
              .update({
                supplierId: value ?? undefined,
                currencyCode: currencyCode ?? undefined,
                exchangeRate: currency.data?.exchangeRate ?? 1,
                updatedBy: userId,
                updatedAt: new Date().toISOString(),
              })
              .in("id", ids as string[])
          );
        }
      }

      return json(
        await client
          .from("purchaseOrder")
          .update({
            supplierId: value ?? undefined,
            updatedBy: userId,
            updatedAt: new Date().toISOString(),
          })
          .in("id", ids as string[])
      );
    case "receiptRequestedDate":
    case "locationId":
    case "deliveryDate":
      return json(
        await client
          .from("purchaseOrderDelivery")
          .update({
            [field]: value ?? undefined,
            updatedBy: userId,
            updatedAt: new Date().toISOString(),
          })
          .in("id", ids as string[])
      );
    case "receiptPromisedDate":
      const lineUpdates = await client
        .from("purchaseOrderLine")
        .update({
          promisedDate: value ?? undefined,
          updatedBy: userId,
          updatedAt: new Date().toISOString(),
        })
        .in("purchaseOrderId", ids as string[])
        .is("promisedDate", null);

      if (lineUpdates.error) {
        return json(lineUpdates);
      }

      return json(
        await client
          .from("purchaseOrderDelivery")
          .update({
            [field]: value ?? undefined,
            updatedBy: userId,
            updatedAt: new Date().toISOString(),
          })
          .in("id", ids as string[])
      );
    case "currencyCode":
      if (value) {
        const currency = await getCurrencyByCode(
          client,
          companyId,
          value as string
        );
        if (currency.data) {
          return json(
            await client
              .from("purchaseOrder")
              .update({
                currencyCode: value as string,
                exchangeRate: currency.data.exchangeRate,
                updatedBy: userId,
                updatedAt: new Date().toISOString(),
              })
              .in("id", ids as string[])
          );
        }
      }
    // don't break -- just let it catch the next case
    case "supplierContactId":
    case "supplierLocationId":
    case "supplierReference":
    case "exchangeRate":
    case "orderDate":
      return json(
        await client
          .from("purchaseOrder")
          .update({
            [field]: value ? value : null,
            updatedBy: userId,
            updatedAt: new Date().toISOString(),
          })
          .in("id", ids as string[])
      );
    default:
      return json({ error: { message: "Invalid field" }, data: null });
  }
}
