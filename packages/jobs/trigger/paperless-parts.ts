import { getCarbonServiceRole } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { PaperlessPartsClient } from "@carbon/integrations/paperless-parts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { task } from "@trigger.dev/sdk/v3";
import { z } from "zod";

const payloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("quote.created"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
  z.object({
    type: z.literal("quote.status_changed"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
  z.object({
    type: z.literal("quote.sent"),
    created: z.string(),
    object: z.string(),
    data: z.object({
      uuid: z.string(),
      number: z.number(),
      status: z.string(),
      created: z.string(),
      expired: z.boolean(),
      due_date: z.string().nullable(),
      erp_code: z.string().nullable(),
      metadata: z.object({}),
      priority: z.number().nullable(),
      tax_rate: z.string().nullable(),
      estimator: z.string().nullable(),
      sent_date: z.string(),
      contact_id: z.number(),
      rfq_number: z.string().nullable(),
      quote_items: z.array(z.string()),
      quote_notes: z.string().nullable(),
      salesperson: z.string().nullable(),
      expired_date: z.string().nullable(),
      private_notes: z.string().nullable(),
      revision_number: z.number().nullable(),
      supporting_files: z.array(z.string()),
      export_controlled: z.boolean(),
      send_from_facility: z.string(),
      request_for_quote_id: z.string().nullable(),
      digital_last_viewed_on: z.string().nullable(),
      manual_rfq_received_date: z.string().nullable(),
      authenticated_pdf_quote_url: z.string().nullable(),
    }),
  }),
  z.object({
    type: z.literal("order.created"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
  z.object({
    type: z.literal("order.status_changed"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
  z.object({
    type: z.literal("integration_action.requested"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
  z.object({
    type: z.literal("integration.turned_on"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
  z.object({
    type: z.literal("integration.turned_off"),
    created: z.string(),
    object: z.string(),
    data: z.any(),
  }),
]);

const paperlessPartsSchema = z.object({
  apiKey: z.string(),
  companyId: z.string(),
  payload: payloadSchema,
});

export const paperlessPartsTask = task({
  id: "paperless-parts",
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: z.infer<typeof paperlessPartsSchema>) => {
    let result: { success: boolean; message: string };

    console.info(
      `🔰 Paperless Parts webhook received: ${payload.payload.type}`
    );
    console.info(`📦 Payload:`, payload);

    const carbon = getCarbonServiceRole();
    const paperless = new PaperlessPartsClient(payload.apiKey);

    switch (payload.payload.type) {
      case "quote.created":
        console.info(`📫 Processing quote created event`);
        result = {
          success: true,
          message: "Quote created event processed successfully",
        };
        break;
      case "quote.status_changed":
        console.info(`📫 Processing quote status changed event`);
        result = {
          success: true,
          message: "Quote status changed event processed successfully",
        };
        break;
      case "quote.sent":
        console.info(`📫 Processing quote sent event`);
        const quotePayload = payload.payload.data;

        const ppQuoteNumber = quotePayload.number;
        const ppQuoteRevisionNumber = quotePayload.revision_number;

        const ppQuote = await paperless.quotes.quoteDetails(
          ppQuoteNumber,
          ppQuoteRevisionNumber
            ? { revision: ppQuoteRevisionNumber }
            : undefined
        );

        if (ppQuote.error || !ppQuote.data) {
          throw new Error("Failed to fetch quote details from Paperless Parts");
        }

        if (!ppQuote.data.contact) {
          // This should never happen based on the validation rules in Paperless Parts
          throw new Error(
            "Quote contact not found in Paperless Parts - cannot create CarbonOS Quote"
          );
        }

        let customerId: string;
        let customerContactId: string;
        // If the Paperless Parts quote contact has an account, get the customer from Carbon
        // based on the Paperless Parts ID
        // If the customer does not exist, create a new customer in CarbonOS
        if (ppQuote.data.contact?.account) {
          const paperlessPartsCustomerId = ppQuote.data.contact?.account?.id;
          // @ts-expect-error - JSONB column
          const existingCustomer = await carbon
            .from("customer")
            .select("id")
            .eq("companyId", payload.companyId)
            .eq("externalId->paperlessPartsId", paperlessPartsCustomerId)
            .maybeSingle();

          if (existingCustomer.data) {
            customerId = existingCustomer.data.id;
          } else {
            const customerName = ppQuote.data.contact?.account?.name!;
            const newCustomer = await carbon
              .from("customer")
              .insert({
                companyId: payload.companyId,
                name: customerName,
                externalId: {
                  paperlessPartsId: ppQuote.data.contact.account.id,
                },
                currencyCode: "USD",
                createdBy: "system",
              })
              .select()
              .single();

            if (newCustomer.error || !newCustomer.data) {
              throw new Error("Failed to create customer in CarbonOS");
            }

            customerId = newCustomer.data.id;
          }
        } else {
          // If the quote contact does not have an account, we need to create a new customer in CarbonOS
          // and also create a corresponding account in Paperless Parts
          const customerName = `${ppQuote.data.contact?.first_name} ${ppQuote.data.contact?.last_name}`;

          // Create a new account in Paperless Parts
          const newPaperlessPartsAccount =
            await paperless.accounts.createAccount({
              name: customerName,
            });

          if (
            newPaperlessPartsAccount.error ||
            !newPaperlessPartsAccount.data
          ) {
            throw new Error("Failed to create account in Paperless Parts");
          }

          const newPaperlessPartsAccountId = newPaperlessPartsAccount.data.id;

          const newCustomer = await carbon
            .from("customer")
            .insert({
              companyId: payload.companyId,
              name: customerName,
              externalId: {
                paperlessPartsId: newPaperlessPartsAccountId,
              },
              currencyCode: "USD",
              createdBy: "system",
            })
            .select()
            .single();

          if (newCustomer.error || !newCustomer.data) {
            throw new Error("Failed to create customer in CarbonOS");
          }

          console.info("🔰 New CarbonOS customer created");

          customerId = newCustomer.data.id;
        }

        // Get the contact ID from Carbon based on the Paperless Parts ID
        const paperlessPartsContactId = ppQuote.data.contact?.id;
        const existingCustomerContact = await carbon
          .from("customerContact")
          .select(
            `
            id,
            contact!inner (
              id,
              companyId,
              externalId
            )
          `
          )
          .eq("contact.companyId", payload.companyId)
          .eq("contact.externalId->paperlessPartsId", paperlessPartsContactId)
          .maybeSingle();

        if (existingCustomerContact.data) {
          customerContactId = existingCustomerContact.data.id;
        } else {
          // If there is no matching contact in CarbonOS, we need to create a new contact in CarbonOS
          const newContact = await carbon
            .from("contact")
            .insert({
              companyId: payload.companyId,
              firstName: ppQuote.data.contact?.first_name!,
              lastName: ppQuote.data.contact?.last_name!,
              email: ppQuote.data.contact?.email!,
              externalId: {
                paperlessPartsId: ppQuote.data.contact?.id,
              },
            })
            .select()
            .single();

          if (newContact.error || !newContact.data) {
            throw new Error("Failed to create contact in CarbonOS");
          }

          console.info("🔰 New CarbonOS contact created");

          const newCustomerContact = await carbon
            .from("customerContact")
            .insert({
              customerId,
              contactId: newContact.data.id,
            })
            .select()
            .single();

          if (newCustomerContact.error || !newCustomerContact.data) {
            throw new Error("Failed to create customer contact in CarbonOS");
          }

          console.info("🔰 OS customerContact created");

          customerContactId = newCustomerContact.data.id;
        }

        // Create a new quote in CarbonOS
        const nextSequence = await getNextSequence(
          carbon,
          "quote",
          payload.companyId
        );

        if (!nextSequence.data) {
          throw new Error("Failed to get next sequence number for quote");
        }

        // Create a quote object from the Paperless Parts data
        const quote = {
          companyId: payload.companyId,
          customerId: customerId,
          customerContactId: customerContactId,
          quoteId: nextSequence.data.toString(),
          name: `Quote for ${
            ppQuote.data.contact?.account?.name ||
            `${ppQuote.data.contact?.first_name} ${ppQuote.data.contact?.last_name}`
          }`,
          status: "Draft" as const,
          currencyCode: "USD",
          createdBy: "system",
          exchangeRate: 1 as number | undefined,
          exchangeRateUpdatedAt: undefined as string | undefined,
          expirationDate: undefined as string | undefined,
          externalId: {
            paperlessPartsId: quotePayload.uuid,
          },
        };

        const [customerPayment, customerShipping, employee, opportunity] =
          await Promise.all([
            getCustomerPayment(carbon, quote.customerId),
            getCustomerShipping(carbon, quote.customerId),
            getEmployeeJob(carbon, quote.createdBy, quote.companyId),
            carbon
              .from("opportunity")
              .insert([
                { companyId: quote.companyId, customerId: quote.customerId },
              ])
              .select("id")
              .single(),
          ]);

        if (customerPayment.error) return customerPayment;
        if (customerShipping.error) return customerShipping;

        const {
          paymentTermId,
          invoiceCustomerId,
          invoiceCustomerContactId,
          invoiceCustomerLocationId,
        } = customerPayment.data;

        const { shippingMethodId, shippingTermId } = customerShipping.data;

        if (quote.currencyCode) {
          const currency = await getCurrencyByCode(
            carbon,
            quote.companyId,
            quote.currencyCode
          );
          if (currency.data) {
            quote.exchangeRate = currency.data.exchangeRate ?? undefined;
            quote.exchangeRateUpdatedAt = new Date().toISOString();
          }
        } else {
          quote.exchangeRate = 1;
          quote.exchangeRateUpdatedAt = new Date().toISOString();
        }

        const locationId = employee?.data?.locationId ?? null;
        const insert = await carbon
          .from("quote")
          .insert([
            {
              ...quote,
              opportunityId: opportunity.data?.id,
            },
          ])
          .select("id, quoteId");
        if (insert.error) {
          return insert;
        }

        const quoteId = insert.data?.[0]?.id;
        if (!quoteId) return insert;

        const [shipment, payment, externalLink] = await Promise.all([
          carbon.from("quoteShipment").insert([
            {
              id: quoteId,
              locationId: locationId,
              shippingMethodId: shippingMethodId,
              shippingTermId: shippingTermId,
              companyId: quote.companyId,
            },
          ]),
          carbon.from("quotePayment").insert([
            {
              id: quoteId,
              invoiceCustomerId: invoiceCustomerId,
              invoiceCustomerContactId: invoiceCustomerContactId,
              invoiceCustomerLocationId: invoiceCustomerLocationId,
              paymentTermId: paymentTermId,
              companyId: quote.companyId,
            },
          ]),
          upsertExternalLink(carbon, {
            documentType: "Quote" as const,
            documentId: quoteId,
            customerId: quote.customerId,
            expiresAt: quote.expirationDate,
            companyId: quote.companyId,
          }),
        ]);

        if (shipment.error) {
          await deleteQuote(carbon, quoteId);
          return payment;
        }
        if (payment.error) {
          await deleteQuote(carbon, quoteId);
          return payment;
        }
        if (opportunity.error) {
          await deleteQuote(carbon, quoteId);
          return opportunity;
        }
        if (externalLink.data) {
          await carbon
            .from("quote")
            .update({ externalLinkId: externalLink.data.id })
            .eq("id", quoteId);
        }

        console.info("🔰 New CarbonOS quote created from Paperless Parts");

        result = {
          success: true,
          message: "Quote sent event processed successfully",
        };
        break;
      case "order.created":
        console.info(`📫 Processing order created event`);
        result = {
          success: true,
          message: "Order created event processed successfully",
        };
        break;
      case "order.status_changed":
        console.info(`📫 Processing order status changed event`);
        result = {
          success: true,
          message: "Order status changed event processed successfully",
        };
        break;
      case "integration_action.requested":
        console.info(`📫 Processing integration action requested event`);
        result = {
          success: true,
          message: "Integration action requested event processed successfully",
        };
        break;
      case "integration.turned_on":
        console.info(`📫 Processing integration turned on event`);
        result = {
          success: true,
          message: "Integration turned on event processed successfully",
        };
        break;
      case "integration.turned_off":
        console.info(`📫 Processing integration turned off event`);
        result = {
          success: true,
          message: "Integration turned off event processed successfully",
        };
        break;
      default:
        console.error(`❌ Unsupported event type: ${payload.payload}`);
        result = {
          success: false,
          message: `Unsupported event type`,
        };
        break;
    }

    if (result.success) {
      console.info(`✅ Successfully processed ${payload.payload.type} event`);
    } else {
      console.error(
        `❌ Failed to process ${payload.payload.type} event: ${result.message}`
      );
    }

    return result;
  },
});

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
