import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { getCurrencyByCode } from "~/modules/accounting";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales",
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const field = formData.get("field");
  const value = formData.get("value");

  if (
    typeof field !== "string" ||
    (typeof value !== "string" && value !== null)
  ) {
    return json({ error: { message: "Invalid form data" }, data: null });
  }

  switch (field) {
    case "customerId":
      let currencyCode: string | undefined;
      if (value && ids.length === 1) {
        const customer = await client
          ?.from("customer")
          .select("currencyCode")
          .eq("id", value)
          .single();

        if (customer.data?.currencyCode) {
          currencyCode = customer.data.currencyCode;
          return json(
            await client
              .from("quote")
              .update({
                customerId: value ?? undefined,
                currencyCode: currencyCode ? currencyCode : undefined,
                updatedBy: userId,
                updatedAt: new Date().toISOString(),
              })
              .in("id", ids as string[])
          );
        }
      }

      return json(
        await client
          .from("quote")
          .update({
            customerId: value ?? undefined,
            updatedBy: userId,
            updatedAt: new Date().toISOString(),
          })
          .in("id", ids as string[])
      );
    case "currencyCode":
      const currency = await getCurrencyByCode(
        client,
        companyId,
        value as string
      );
      if (currency.data) {
        return json(
          await client
            .from("quote")
            .update({
              currencyCode: value,
              exchangeRate: currency.data.exchangeRate,
              updatedBy: userId,
              updatedAt: new Date().toISOString(),
            })
            .in("id", ids as string[])
        );
      }
    // don't break -- just let it catch the next case

    case "customerContactId":
    case "customerEngineeringContactId":
    case "customerLocationId":
    case "customerReference":
    case "dueDate":
    case "estimatorId":
    case "expirationDate":
    case "locationId":
    case "salesPersonId":
      return json(
        await client
          .from("quote")
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
