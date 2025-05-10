import { requirePermissions } from "@carbon/auth/auth.server";
import { parseDate } from "@internationalized/date";
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
    case "invoiceCustomerId":
      let currencyCode: string | undefined;
      if (value && ids.length === 1) {
        const customer = await client
          ?.from("customer")
          .select("currencyCode")
          .eq("id", value)
          .single();

        if (customer.data?.currencyCode) {
          currencyCode = customer.data.currencyCode;
          const currency = await getCurrencyByCode(
            client,
            companyId,
            currencyCode
          );
          // TODO: update delivery and payment terms
          return json(
            await client
              .from("salesInvoice")
              .update({
                invoiceCustomerId: value ?? undefined,
                invoiceCustomerContactId: null,
                invoiceCustomerLocationId: null,
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
          .from("salesInvoice")
          .update({
            customerId: value ?? undefined,
            updatedBy: userId,
            updatedAt: new Date().toISOString(),
          })
          .in("id", ids as string[])
      );
    case "dateIssued":
      if (ids.length === 1) {
        const paymentTerms = await client
          .from("paymentTerm")
          .select("*")
          .eq("id", value as string)
          .single();
        if (paymentTerms.data) {
          return json(
            await client
              .from("salesInvoice")
              .update({
                dateIssued: value,
                dateDue: parseDate(value as string)
                  .add({ days: paymentTerms.data.daysDue })
                  .toString(),
                updatedBy: userId,
                updatedAt: new Date().toISOString(),
              })
              .eq("id", ids[0] as string)
          );
        } else {
          return json(
            await client
              .from("salesInvoice")
              .update({
                [field]: value ? value : null,
                updatedBy: userId,
                updatedAt: new Date().toISOString(),
              })
              .in("id", ids as string[])
          );
        }
      }
      break;
    // don't break -- just let it catch the next case
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
              .from("salesInvoice")
              .update({
                currencyCode: value as string,
                exchangeRate: currency.data.exchangeRate ?? 1,
                updatedBy: userId,
                updatedAt: new Date().toISOString(),
              })
              .in("id", ids as string[])
          );
        }
      }
    // don't break -- just let it catch the next case
    case "customerId":
    case "invoiceCustomerContactId":
    case "invoiceCustomerLocationId":
    case "locationId":
    case "customerReference":
    case "paymentTermId":
    case "exchangeRate":
    case "dateDue":
    case "datePaid":
      return json(
        await client
          .from("salesInvoice")
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
