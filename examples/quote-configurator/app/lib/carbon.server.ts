import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import {
  CARBON_API_KEY,
  CARBON_API_URL,
  CARBON_APP_URL,
  CARBON_COMPANY_ID,
  CARBON_PUBLIC_KEY,
} from "~/config";

export const quoteLineStatusType = [
  "Not Started",
  "In Progress",
  "Complete",
  "No Quote",
] as const;

export const quoteStatusType = [
  "Draft",
  "Sent",
  "Ordered",
  "Partial",
  "Lost",
  "Cancelled",
  "Expired",
] as const;

class CarbonClient {
  private readonly appUrl: string = CARBON_APP_URL;
  private readonly client: SupabaseClient;
  private readonly companyId: string = CARBON_COMPANY_ID;
  constructor() {
    this.client = createClient(CARBON_API_URL, CARBON_PUBLIC_KEY, {
      global: {
        headers: {
          "carbon-key": CARBON_API_KEY,
        },
      },
    });
  }

  async getCustomer(id: string) {
    return this.client.from("customer").select("*").eq("id", id).single();
  }

  async getCustomerByEmail(email: string) {
    const result = await this.client
      .from("customerContact")
      .select("customerId, contact(email, companyId)")
      .eq("contact.email", email)
      .eq("contact.companyId", this.companyId)
      .maybeSingle();

    if (result.error) {
      return result;
    }

    if (!result.data) {
      return {
        data: null,
        error: "Customer not found",
      };
    }

    return {
      data: result.data.customerId,
      error: null,
    };
  }

  async getCustomerPayment(customerId: string) {
    return this.client
      .from("customerPayment")
      .select("*")
      .eq("customerId", customerId)
      .single();
  }

  async getCustomerShipping(customerId: string) {
    return this.client
      .from("customerShipping")
      .select("*")
      .eq("customerId", customerId)
      .single();
  }

  async getNextSequence(table: string) {
    return this.client.rpc("get_next_sequence", {
      sequence_name: table,
      company_id: this.companyId,
    });
  }

  async deleteQuote(id: string) {
    return this.client.from("quote").delete().eq("id", id);
  }

  async getQuote(id: string) {
    return this.client.from("quote").select("*").eq("id", id).single();
  }

  async upsertQuote(
    quote:
      | {
          quoteId: string;
          customerId: string;
          currencyCode: string;
          expirationDate?: string;
          createdBy: string;
        }
      | {
          id: string;
          quoteId: string;
          customerId: string;
          currencyCode: string;
          expirationDate?: string;
          updatedBy: string;
        }
  ) {
    if (!("id" in quote)) {
      const [customerPayment, customerShipping] = await Promise.all([
        this.getCustomerPayment(quote.customerId),
        this.getCustomerShipping(quote.customerId),
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

      const insert = await this.client
        .from("quote")
        .insert([{ ...quote, companyId: this.companyId }])
        .select("id, quoteId")
        .single();
      if (insert.error) {
        console.error(insert.error);
        return insert;
      }

      const quoteId = insert.data?.id;
      if (!quoteId) return insert;

      const [shipment, payment, opportunity, externalLink] = await Promise.all([
        this.client.from("quoteShipment").insert([
          {
            id: quoteId,
            shippingMethodId: shippingMethodId,
            shippingTermId: shippingTermId,
            companyId: this.companyId,
          },
        ]),
        this.client.from("quotePayment").insert([
          {
            id: quoteId,
            invoiceCustomerId: invoiceCustomerId,
            invoiceCustomerContactId: invoiceCustomerContactId,
            invoiceCustomerLocationId: invoiceCustomerLocationId,
            paymentTermId: paymentTermId,
            companyId: this.companyId,
          },
        ]),
        this.client
          .from("opportunity")
          .insert([{ quoteId, companyId: this.companyId }]),
        this.upsertExternalLink({
          documentType: "Quote",
          documentId: quoteId,
          customerId: quote.customerId,
          expiresAt: quote.expirationDate,
          companyId: this.companyId,
        }),
      ]);

      if (shipment.error) {
        await this.deleteQuote(quoteId);
        return payment;
      }
      if (payment.error) {
        await this.deleteQuote(quoteId);
        return payment;
      }
      if (opportunity.error) {
        await this.deleteQuote(quoteId);
        return opportunity;
      }
      if (externalLink.data) {
        await this.client
          .from("quote")
          .update({ externalLinkId: externalLink.data.id })
          .eq("id", quoteId);
      }

      return insert;
    } else {
      return this.client
        .from("quote")
        .update({
          ...this.sanitize(quote),
          updatedAt: new Date().toISOString(),
        })
        .eq("id", quote.id)
        .select("id, quoteId")
        .single();
    }
  }

  async upsertExternalLink(externalLink: {
    documentType: string;
    documentId: string;
    customerId: string;
    expiresAt?: string;
    companyId: string;
  }) {
    return this.client
      .from("externalLink")
      .insert(externalLink)
      .select("id")
      .single();
  }

  async upsertQuoteLine(
    quotationLine:
      | {
          quoteId: string;
          quantity: number[];
          itemId: string;
          description: string;
          methodType: "Buy" | "Make" | "Pick";
          unitOfMeasureCode: string;
          configuration?: Record<string, unknown>;
        }
      | {
          id: string;
          quoteId: string;
          quantity: number[];
          itemId: string;
          description: string;
          methodType: "Buy" | "Make" | "Pick";
          unitOfMeasureCode: string;
          configuration?: Record<string, unknown>;
        }
  ) {
    if ("id" in quotationLine) {
      return this.client
        .from("quoteLine")
        .update(
          this.sanitize({
            ...quotationLine,
            companyId: this.companyId,
            updatedBy: "system",
          })
        )
        .eq("id", quotationLine.id)
        .select("id")
        .single();
    }
    return this.client
      .from("quoteLine")
      .insert([
        { ...quotationLine, companyId: this.companyId, createdBy: "system" },
      ])
      .select("*")
      .single();
  }

  async upsertQuoteLineMethod(lineMethod: {
    itemId: string;
    quoteId: string;
    quoteLineId: string;
    configuration?: Record<string, unknown>;
  }) {
    return this.client.functions.invoke("get-method", {
      body: {
        type: "itemToQuoteLine",
        sourceId: lineMethod.itemId,
        targetId: `${lineMethod.quoteId}:${lineMethod.quoteLineId}`,
        companyId: this.companyId,
        configuration: lineMethod.configuration,
        userId: "system",
      },
    });
  }

  sanitize<T extends Record<string, any>>(
    input: T
  ): {
    [K in keyof T]: T[K] extends undefined ? null : T[K];
  } {
    const output = { ...input } as {
      [K in keyof T]: T[K] extends undefined ? null : T[K];
    };
    Object.keys(output).forEach((key) => {
      if (output[key as keyof T] === undefined && key !== "id") {
        output[key as keyof T] = null as any;
      }
    });
    return output;
  }
}

const carbon = new CarbonClient();

export { carbon };
