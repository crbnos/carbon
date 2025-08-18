import * as dotenv from "dotenv";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../packages/database/src/types";
import {
  getCarbonCustomerIdAndContactId,
  getCarbonLocationIds,
  getPaperlessParts,
} from "../packages/integrations/src/paperless-parts/lib/index";
import { OrderSchema } from "../packages/integrations/src/paperless-parts/lib/schemas";
const orderNumber = 1;
const apiKey = "3c82924535cc39a51cbb59c1350754f92fb65742";
const companyId = "SanLTzPk93kscfQ7oCnSSu";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

(async () => {
  const carbon = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const paperless = await getPaperlessParts(apiKey);
  const company = await carbon
    .from("company")
    .select("*")
    .eq("id", companyId)
    .single();

  const order = await paperless.orders.orderDetails(orderNumber);
  if (order.data) {
    const orderData = OrderSchema.parse(order.data);
    console.log(orderData);

    const [{ customerId, customerContactId }, ,] = await Promise.all([
      getCarbonCustomerIdAndContactId(carbon, paperless, {
        company: company.data!,
        contact: orderData.contact!,
      }),
    ]);

    if (!customerId) {
      throw new Error("Failed to get customer ID");
    }
    if (!customerContactId) {
      throw new Error("Failed to get customer contact ID");
    }

    const { shipmentLocationId, invoiceLocationId } =
      await getCarbonLocationIds(carbon, paperless, {
        company: company.data!,
        customerId,
        billingInfo: orderData.billing_info,
        shippingInfo: orderData.shipping_info,
      });

    console.log({ shipmentLocationId, invoiceLocationId });

    // const [customerPayment, customerShipping, employee, opportunity] =
    //   await Promise.all([
    //     getCustomerPayment(carbon, customerId),
    //     getCustomerShipping(carbon, customerId),
    //     getEmployeeJob(carbon, salesOrder.createdBy, companyId),
    //     carbon
    //       .from("opportunity")
    //       .insert([
    //         {
    //           companyId: companyId,
    //           customerId: customerId,
    //         },
    //       ])
    //       .select("id")
    //       .single(),
    //   ]);

    // if (customerPayment.error) return customerPayment;
    // if (customerShipping.error) return customerShipping;

    // const {
    //   paymentTermId,
    //   invoiceCustomerId,
    //   invoiceCustomerContactId,
    //   invoiceCustomerLocationId,
    // } = customerPayment.data;

    // const { shippingMethodId, shippingTermId } = customerShipping.data;

    // const locationId = employee?.data?.locationId ?? null;

    // let salesOrderInsert: Database["public"]["Tables"]["salesOrder"]["Insert"] =
    //   {
    //     companyId: companyId,
    //     createdBy: employee?.data?.id ?? "system",
    //     currencyCode: company.data?.baseCurrencyCode,
    //     customerId: customerId,
    //     opportunityId: opportunity.data?.id,
    //   };

    // const insertedSalesOrder = await carbon
    //   .from("salesOrder")
    //   .insert([salesOrderInsert])
    //   .select("id, salesOrderId");

    // if (order.error) return order;

    // const salesOrderId = order.data[0].id;

    // const [shipment, payment] = await Promise.all([
    //   carbon.from("salesOrderShipment").insert([
    //     {
    //       id: salesOrderId,
    //       locationId: locationId,
    //       shippingMethodId: shippingMethodId,
    //       shippingTermId: shippingTermId,
    //       companyId: companyId,
    //     },
    //   ]),
    //   carbon.from("salesOrderPayment").insert([
    //     {
    //       id: salesOrderId,
    //       invoiceCustomerId: invoiceCustomerId,
    //       invoiceCustomerContactId: invoiceCustomerContactId,
    //       invoiceCustomerLocationId: invoiceCustomerLocationId,
    //       paymentTermId: paymentTermId,
    //       companyId: companyId,
    //     },
    //   ]),
    // ]);

    // if (shipment.error) {
    //   await deleteSalesOrder(carbon, salesOrderId);
    //   return payment;
    // }
    // if (payment.error) {
    //   await deleteSalesOrder(carbon, salesOrderId);
    //   return payment;
    // }
    // if (opportunity.error) {
    //   await deleteSalesOrder(carbon, salesOrderId);
    //   return opportunity;
    // }
  } else {
    console.error("No order data found");
    return;
  }
})();

async function getNextSequence(
  client: SupabaseClient<Database>,
  table: string,
  companyId: string
) {
  return client.rpc("get_next_sequence", {
    sequence_name: table,
    company_id: companyId,
  });
}

async function getCustomerPayment(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client
    .from("customerPayment")
    .select("*")
    .eq("customerId", customerId)
    .single();
}

async function getCustomerShipping(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client
    .from("customerShipping")
    .select("*")
    .eq("customerId", customerId)
    .single();
}

async function getEmployeeJob(
  client: SupabaseClient<Database>,
  employeeId: string,
  companyId: string
) {
  return client
    .from("employeeJob")
    .select("*")
    .eq("id", employeeId)
    .eq("companyId", companyId)
    .single();
}

async function getCurrencyByCode(
  client: SupabaseClient<Database>,
  companyId: string,
  currencyCode: string
) {
  return client
    .from("currency")
    .select("exchangeRate")
    .eq("companyId", companyId)
    .eq("code", currencyCode)
    .single();
}

async function deleteQuote(client: SupabaseClient<Database>, quoteId: string) {
  return client.from("quote").delete().eq("id", quoteId);
}

async function deleteSalesOrder(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client.from("salesOrder").delete().eq("id", salesOrderId);
}

async function upsertExternalLink(
  client: SupabaseClient<Database>,
  externalLink: {
    documentType: "Quote" | "SupplierQuote" | "Customer";
    documentId: string;
    customerId: string;
    expiresAt?: string;
    companyId: string;
  }
) {
  return client
    .from("externalLink")
    .insert({
      documentType: externalLink.documentType,
      documentId: externalLink.documentId,
      customerId: externalLink.customerId,
      expiresAt: externalLink.expiresAt,
      companyId: externalLink.companyId,
    })
    .select("id")
    .single();
}
